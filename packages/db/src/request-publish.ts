// H-031 (Issue #44) | Adaptador Pg da publicacao idempotente do pedido (docs/factory/110-DESENHO-H031.md, §2, §4.4, §5).
// So chama private.request_publish_begin / _commit / _abort (papel app_system, migracao 20261113010000).
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao, nao le variavel de ambiente, nao importa apps/*.
//   - Nenhuma coordenada, ponto, hash ou endereco volta ao chamador (begin devolve so o texto do endereco, que a
//     API usa para geocodificar fora de transacao; o resto e o contrato de §3.2).
//   - Erro do banco nunca e repassado: vira um codigo fixo (PUBLISH_CHAVE_PERDIDA ou PUBLISH_BANCO_FALHOU).
//   - A chave de limite de taxa e o hash do corpo chegam ja calculados pela API (HMAC); o banco nunca ve o IP em claro.

import type { SqlClient } from './jobs-tick.js';

export const SQL_PUBLISH_BEGIN =
  'select * from private.request_publish_begin($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::integer, $7::text, $8::text, $9::timestamptz)';
export const SQL_PUBLISH_COMMIT =
  'select * from private.request_publish_commit($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::integer, $7::uuid, $8::boolean, $9::timestamptz)';
export const SQL_PUBLISH_ABORT = 'select private.request_publish_abort($1::uuid, $2::text, $3::text) as ok';

/** Erro fixo: a chave deixou de ser nossa antes do commit (o banco faz rollback; a API responde 503). */
export const PUBLISH_CHAVE_PERDIDA = 'publicacao_chave_perdida';
/** Erro fixo para qualquer falha do banco que nao seja a chave perdida (inclui lock_timeout). */
export const PUBLISH_BANCO_FALHOU = 'publicacao_banco_falhou';

/** Recusas que o banco devolve sem dados extras (110 §3.1). */
export const PUBLISH_RECUSAS = [
  'sessao_necessaria',
  'nao_encontrado',
  'conflito',
  'em_andamento',
  'email_nao_confirmado',
  'email_divergente',
  'conteudo_alterado',
  'nao_confirmado',
  'fotos_em_processamento',
] as const;
export type PublishRecusa = (typeof PUBLISH_RECUSAS)[number];

export interface PublishedRequest {
  readonly id: string;
  readonly publishedAt: string;
  readonly acceptanceDeadlineAt: string;
}

export interface PublishSimilar {
  readonly id: string;
  readonly publishedAt: string;
  readonly serviceName: string;
}

export type PublishBeginOutcome =
  | { readonly status: 'ok'; readonly addressText: string }
  | { readonly status: 'repetida' | 'ja_publicado'; readonly pedido: PublishedRequest }
  | { readonly status: 'campos_faltando'; readonly missing: readonly string[] }
  | { readonly status: 'limite'; readonly retryAfter: number }
  | { readonly status: PublishRecusa };

export type PublishCommitOutcome =
  | { readonly status: 'criado' | 'ja_publicado'; readonly pedido: PublishedRequest }
  | { readonly status: 'duplicidade'; readonly similar: PublishSimilar }
  | { readonly status: 'campos_faltando'; readonly missing: readonly string[] }
  | { readonly status: 'ponto_invalido' | PublishRecusa };

export interface PublishBeginInput {
  readonly userId: string;
  readonly draftId: string;
  /** Hash do segredo do cookie do rascunho (o mesmo que draft-route compara com browser_nonce_hash). */
  readonly secretHash: string;
  readonly idemKey: string;
  readonly bodyHash: string;
  readonly contentRev: number;
  /** Chaves HMAC de taxa, ja calculadas pela API (ops.rate_counter.key_hmac, 64 hex). */
  readonly userRateKey: string;
  readonly ipRateKey: string;
  readonly nowMs: number;
}

export interface PublishCommitInput {
  readonly userId: string;
  readonly draftId: string;
  readonly secretHash: string;
  readonly idemKey: string;
  readonly bodyHash: string;
  readonly contentRev: number;
  /** Id do ponto em app.geocode_point, devolvido por ensurePermanentPoint (assunto = id do rascunho). */
  readonly pointId: string;
  /** true quando o cliente reenviou com token de duplicidade valido (decisao 229). */
  readonly ack: boolean;
  readonly nowMs: number;
}

export interface PublishAbortInput {
  readonly userId: string;
  readonly idemKey: string;
  readonly bodyHash: string;
}

type Linha = Record<string, unknown>;

function linha(rows: Linha[]): Linha {
  const primeira = rows[0];
  if (typeof primeira !== 'object' || primeira === null) throw new Error(PUBLISH_BANCO_FALHOU);
  return primeira;
}

/** Datas podem vir como Date (driver pg) ou texto; sempre saem em ISO. */
function iso(valor: unknown): string {
  const data = valor instanceof Date ? valor : new Date(String(valor));
  const ms = data.getTime();
  if (Number.isNaN(ms)) throw new Error(PUBLISH_BANCO_FALHOU);
  return data.toISOString();
}

function texto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(PUBLISH_BANCO_FALHOU);
  return valor;
}

function faltando(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map((v) => String(v)) : [];
}

function pedido(r: Linha): PublishedRequest {
  return {
    id: texto(r.out_request_id),
    publishedAt: iso(r.out_published_at),
    acceptanceDeadlineAt: iso(r.out_deadline_at),
  };
}

const RECUSAS = new Set<string>(PUBLISH_RECUSAS);

async function executar(client: SqlClient, sql: string, params: unknown[]): Promise<Linha> {
  let codigoFalha: string | null = null;
  let resultado: Linha | null = null;
  try {
    resultado = linha((await client.query(sql, params)).rows);
  } catch (erro) {
    // So a mensagem fixa da funcao do banco e aproveitada; o texto do driver e descartado.
    const mensagem = erro instanceof Error ? erro.message : '';
    codigoFalha = mensagem === PUBLISH_CHAVE_PERDIDA ? PUBLISH_CHAVE_PERDIDA : PUBLISH_BANCO_FALHOU;
  }
  if (codigoFalha !== null) throw new Error(codigoFalha);
  if (resultado === null) throw new Error(PUBLISH_BANCO_FALHOU);
  return resultado;
}

export class PgRequestPublishStore {
  constructor(private readonly client: SqlClient) {}

  /** Passo 2 (110 §2): trava o rascunho, abre a chave e confere o barato. Sem chamada paga. */
  async begin(input: PublishBeginInput): Promise<PublishBeginOutcome> {
    const r = await executar(this.client, SQL_PUBLISH_BEGIN, [
      input.userId,
      input.draftId,
      input.secretHash,
      input.idemKey,
      input.bodyHash,
      input.contentRev,
      input.userRateKey,
      input.ipRateKey,
      new Date(input.nowMs).toISOString(),
    ]);
    const status = texto(r.out_status);
    if (status === 'ok') return { status, addressText: texto(r.out_address_text) };
    if (status === 'repetida' || status === 'ja_publicado') return { status, pedido: pedido(r) };
    if (status === 'campos_faltando') return { status, missing: faltando(r.out_missing) };
    if (status === 'limite') return { status, retryAfter: Number(r.out_retry_after ?? 0) };
    if (RECUSAS.has(status)) return { status: status as PublishRecusa };
    throw new Error(PUBLISH_BANCO_FALHOU);
  }

  /** Passo 4 (110 §2): uma transacao; reconfere tudo, cria o pedido ou devolve duplicidade. Tudo ou nada. */
  async commit(input: PublishCommitInput): Promise<PublishCommitOutcome> {
    const r = await executar(this.client, SQL_PUBLISH_COMMIT, [
      input.userId,
      input.draftId,
      input.secretHash,
      input.idemKey,
      input.bodyHash,
      input.contentRev,
      input.pointId,
      input.ack,
      new Date(input.nowMs).toISOString(),
    ]);
    const status = texto(r.out_status);
    if (status === 'criado' || status === 'ja_publicado') return { status, pedido: pedido(r) };
    if (status === 'duplicidade') {
      return {
        status,
        similar: {
          id: texto(r.out_similar_id),
          publishedAt: iso(r.out_similar_published_at),
          serviceName: texto(r.out_similar_service_name),
        },
      };
    }
    if (status === 'campos_faltando') return { status, missing: faltando(r.out_missing) };
    if (status === 'ponto_invalido') return { status };
    if (RECUSAS.has(status)) return { status: status as PublishRecusa };
    throw new Error(PUBLISH_BANCO_FALHOU);
  }

  /** Libera a chave que a propria API abriu (idempotente). Usado em todo desfecho sem criacao. */
  async abort(input: PublishAbortInput): Promise<boolean> {
    const r = await executar(this.client, SQL_PUBLISH_ABORT, [input.userId, input.idemKey, input.bodyHash]);
    return r.ok === true;
  }
}
