// H-025 | Adaptadores Pg do rascunho sem conta (docs/factory/74-DESENHO-H025.md, §2, §3; D-10).
// Recebem um SqlClient injetado (sem abrir conexao, sem ler variavel de ambiente). A escrita passa so
// pelas funcoes private.draft_* (migracao 20261111440000). O IP nunca vai ao banco em claro: so o HMAC.
import {
  DRAFT_STATUSES,
  DRAFT_TTL_DAYS,
  type DraftCreateInput,
  type DraftPatchInput,
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftRateCheck,
  type DraftRecord,
  type DraftStatus,
  type DraftStoreError,
  type DraftStorePort,
  type DraftUrgency,
  type DraftWriteResult,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_DRAFT_GET = 'select * from private.draft_get($1, $2::timestamptz)';
export const SQL_DRAFT_CREATE =
  'select * from private.draft_create($1, $2, $3::timestamptz, $4::integer, $5, $6::jsonb)';
export const SQL_DRAFT_PATCH = 'select * from private.draft_patch($1, $2::timestamptz, $3::integer, $4::jsonb)';
export const SQL_DRAFT_DISCARD = 'select private.draft_discard($1, $2::timestamptz) as ok';
export const SQL_DRAFT_RL_CHECK =
  'select out_ok, out_retry_after from private.rl_check($1, $2, $3, $4, $5::timestamptz)';
export const SQL_DRAFT_RL_HIT = 'select private.rl_hit($1, $2, $3::timestamptz)';

/** Prefixo das chaves do limite de rascunho: separa do limite de busca e do de login. */
export const DRAFT_RATE_KEY_PREFIX = 'draft' as const;

const iso = (ms: number): string => new Date(ms).toISOString();

/** Linha de private.draft_* (colunas out_*). Datas podem vir como Date ou texto, conforme o driver. */
interface LinhaRascunho {
  readonly out_id: string;
  readonly out_status: string;
  readonly out_service_id: string | null;
  readonly out_address_text: string | null;
  readonly out_urgency: string | null;
  readonly out_description: string | null;
  readonly out_expires_at: Date | string;
  readonly out_updated_at: Date | string;
}

function isStatus(value: string): value is DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value);
}

function paraRegistro(row: Record<string, unknown>): DraftRecord {
  const l = row as unknown as LinhaRascunho;
  if (typeof l.out_id !== 'string' || typeof l.out_status !== 'string' || !isStatus(l.out_status)) {
    throw new Error('rascunho_resposta_invalida');
  }
  return {
    id: l.out_id,
    status: l.out_status,
    serviceId: l.out_service_id,
    addressText: l.out_address_text,
    urgency: l.out_urgency as DraftUrgency | null,
    description: l.out_description,
    expiresAt: new Date(l.out_expires_at).toISOString(),
    updatedAt: new Date(l.out_updated_at).toISOString(),
  };
}

/** Codigos fixos que o banco pode levantar (mensagem da funcao). Qualquer outra falha sobe como erro. */
function codigoDoBanco(erro: unknown): DraftStoreError | null {
  const msg = erro instanceof Error ? erro.message : '';
  return msg === 'servico_invalido' ? 'servico_invalido' : null;
}

/** Rascunho no banco: leitura, criacao, salvamento e descarte, todos por funcao. */
export class PgDraftStore implements DraftStorePort {
  constructor(private readonly client: SqlClient) {}

  async find(secretHash: string, nowMs: number): Promise<DraftRecord | null> {
    const res = await this.client.query(SQL_DRAFT_GET, [secretHash, iso(nowMs)]);
    const row = res.rows[0];
    return row === undefined ? null : paraRegistro(row);
  }

  async create(input: DraftCreateInput): Promise<DraftWriteResult> {
    return this.escrever(
      SQL_DRAFT_CREATE,
      [
        input.secretHash,
        input.ipHmac,
        iso(input.nowMs),
        DRAFT_TTL_DAYS,
        input.expiredSecretHash,
        JSON.stringify(input.fields),
      ],
      false,
    );
  }

  async patch(input: DraftPatchInput): Promise<DraftWriteResult> {
    return this.escrever(
      SQL_DRAFT_PATCH,
      [input.secretHash, iso(input.nowMs), DRAFT_TTL_DAYS, JSON.stringify(input.fields)],
      true,
    );
  }

  async discard(secretHash: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_DRAFT_DISCARD, [secretHash, iso(nowMs)]);
    return res.rows[0]?.['ok'] === true;
  }

  /**
   * Executa uma funcao de escrita. Sem linha: 'nao_encontrado' quando a ausencia e esperada (patch);
   * em criacao, sem linha e erro interno. 'servico_invalido' vira codigo; o resto sobe.
   */
  private async escrever(sql: string, params: unknown[], ausenciaEhNaoEncontrado: boolean): Promise<DraftWriteResult> {
    let rows: Record<string, unknown>[];
    try {
      rows = (await this.client.query(sql, params)).rows;
    } catch (erro) {
      const codigo = codigoDoBanco(erro);
      if (codigo !== null) return { ok: false, code: codigo };
      throw erro;
    }
    const row = rows[0];
    if (row === undefined) {
      if (ausenciaEhNaoEncontrado) return { ok: false, code: 'nao_encontrado' };
      throw new Error('rascunho_criacao_sem_linha');
    }
    return { ok: true, draft: paraRegistro(row) };
  }
}

/**
 * Limite de taxa do rascunho via private.rl_check / rl_hit (desenho §3, R1). A chave do balde e
 * 'draft:' + politica + ':' + valor, onde o valor ja vem em HMAC (IP) ou em hash (segredo).
 */
export class PgDraftRate implements DraftRatePort {
  constructor(private readonly client: SqlClient) {}

  private chave(policy: DraftRatePolicy, key: string): string {
    return `${DRAFT_RATE_KEY_PREFIX}:${policy.id}:${key}`;
  }

  async check(policy: DraftRatePolicy, key: string, nowMs: number): Promise<DraftRateCheck> {
    const res = await this.client.query(SQL_DRAFT_RL_CHECK, [
      this.chave(policy, key),
      policy.spanS,
      policy.bucketS,
      policy.limit,
      iso(nowMs),
    ]);
    const row = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof row?.out_ok !== 'boolean') throw new Error('rl_resposta_invalida');
    if (row.out_ok) return { ok: true };
    const espera = typeof row.out_retry_after === 'number' ? row.out_retry_after : policy.spanS;
    return { ok: false, retryAfterS: espera };
  }

  async hit(policy: DraftRatePolicy, key: string, nowMs: number): Promise<void> {
    await this.client.query(SQL_DRAFT_RL_HIT, [this.chave(policy, key), policy.bucketS, iso(nowMs)]);
  }
}
