// H-058 (Issue #71) | Adaptador Pg do aceite idempotente (docs/factory/162-DESENHO-H058.md, §1, §5, §8 fatia 4).
// Uma transacao curta por requisicao, numa conexao dedicada: begin; set local lock_timeout; idempotency_begin;
// acceptance_create (ou acceptance_read no replay); idempotency_complete; commit. Rejeicao de negocio faz rollback
// (a chave nao fica gravada em erro 4xx, A-3). 55P03 vira 409 contencao_temporaria; outra falha de banco vira 503.
// Nenhum texto de driver, cookie, chave completa ou PII sai daqui: erros viram codigos fixos.
import {
  ACCEPTANCE_OPERATION,
  acceptanceOutcomeResponse,
  montarEnvelopeAceite,
  requestAcceptanceHash,
  type AcceptanceEnvelope,
  type AcceptanceErrorCode,
  type AcceptanceOutcome,
  type AcceptanceRecord,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Lock de linha do pedido e da chave: no maximo 3 s (decisao 868). */
export const ACCEPTANCE_LOCK_TIMEOUT = "set local lock_timeout = '3s'";
export const SQL_BEGIN_TX = 'begin';
export const SQL_COMMIT_TX = 'commit';
export const SQL_ROLLBACK_TX = 'rollback';

export const SQL_IDEMPOTENCY_BEGIN =
  'select outcome, response_status, response_body_ref from private.idempotency_begin($1::text, $2::text, $3::text, $4::text)';
export const SQL_IDEMPOTENCY_COMPLETE =
  'select private.idempotency_complete($1::text, $2::text, $3::text, $4::integer, $5::text) as ok';
export const SQL_ACCEPTANCE_CREATE =
  'select * from private.acceptance_create($1::uuid, $2::uuid, $3::timestamptz)';
export const SQL_ACCEPTANCE_READ = 'select * from private.acceptance_read($1::uuid, $2::uuid)';

/** Referencia gravada na chave concluida (A-8): so o id do aceite, sem PII. */
export const ACCEPTANCE_RESPONSE_REF_PREFIX = 'acceptance:';

/** Conexao dedicada da transacao: SqlClient com liberacao ao final. */
export interface AcceptanceConnection extends SqlClient {
  release(): void;
}

export interface AcceptanceRequest {
  /** Id do pedido (UUID canonico, ja validado pelo servico). */
  readonly requestId: string;
  /** Id do profissional = id do usuario autenticado (professional_id e o user_id do perfil). */
  readonly professionalId: string;
  /** Chave de idempotencia (UUID v4 em minusculas, validada pelo dominio). */
  readonly key: string;
  /** Instante unico da requisicao (relogio da API, A-5/§1). */
  readonly now: Date;
}

export type AcceptanceResult =
  | { readonly ok: true; readonly status: 200 | 201; readonly envelope: AcceptanceEnvelope }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: AcceptanceErrorCode;
      readonly message?: string;
      readonly retryAfterSeconds?: number;
    };

export interface PgAcceptanceStoreDeps {
  /** Abre uma conexao dedicada do papel app_system (uma por transacao). */
  readonly connect: () => Promise<AcceptanceConnection>;
}

interface AcceptanceRow {
  out_outcome: string;
  out_acceptance_id: string | null;
  out_request_id: string | null;
  out_slot_no: number | null;
  out_wave: number | null;
  out_status: string | null;
  out_accepted_at: Date | string | null;
  out_conversation_id: string | null;
  out_conversation_state: string | null;
  out_first_name: string | null;
}

const ISO_ERRO_CODE_LOCK = '55P03';
const ISO_ERRO_CODE_UNIQUE = '23505';

/** Valor de erro fixo para qualquer falha de banco fora do lock (sem texto de driver). */
export const ACCEPTANCE_BANCO_INDISPONIVEL: AcceptanceResult = {
  ok: false,
  status: 503,
  code: 'servico_indisponivel',
};

export class PgAcceptanceStore {
  constructor(private readonly deps: PgAcceptanceStoreDeps) {}

  /** Executa o aceite inteiro numa transacao. Nunca lanca: devolve o resultado HTTP ja decidido. */
  async aceitar(input: AcceptanceRequest): Promise<AcceptanceResult> {
    const conn = await this.deps.connect();
    let emTransacao = false;
    try {
      await conn.query(SQL_BEGIN_TX);
      emTransacao = true;
      await conn.query(ACCEPTANCE_LOCK_TIMEOUT);

      const hash = requestAcceptanceHash(input.requestId);
      const inicio = await conn.query(SQL_IDEMPOTENCY_BEGIN, [
        input.professionalId,
        ACCEPTANCE_OPERATION,
        input.key,
        hash,
      ]);
      const linha = inicio.rows[0] as { outcome?: unknown; response_body_ref?: unknown } | undefined;
      const resultado = typeof linha?.outcome === 'string' ? linha.outcome : '';

      if (resultado === 'repetida') {
        const aceiteId = referenciaDoAceite(linha?.response_body_ref);
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        if (aceiteId === null) return erroInterno();
        const leitura = await conn.query(SQL_ACCEPTANCE_READ, [aceiteId, input.professionalId]);
        const registro = registroDaLinha(leitura.rows[0] as AcceptanceRow | undefined);
        if (registro === null) return erroInterno();
        return { ok: true, status: 200, envelope: montarEnvelopeAceite(registro) };
      }
      if (resultado === 'em_andamento') {
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        return { ok: false, status: 409, code: 'operacao_em_andamento', retryAfterSeconds: 1 };
      }
      if (resultado === 'conflito') {
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        return { ok: false, status: 422, code: 'chave_reutilizada_com_corpo_diferente' };
      }
      if (resultado !== 'nova') {
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        return erroInterno();
      }

      const criacao = await conn.query(SQL_ACCEPTANCE_CREATE, [
        input.requestId,
        input.professionalId,
        input.now.toISOString(),
      ]);
      const linhaCriacao = criacao.rows[0] as AcceptanceRow | undefined;
      const desfecho = linhaCriacao?.out_outcome as AcceptanceOutcome | undefined;
      if (desfecho !== 'criado' && desfecho !== 'existente') {
        // Rejeicao de negocio: nada foi escrito; a chave nao fica gravada (A-3).
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        if (desfecho === undefined) return erroInterno();
        const resp = acceptanceOutcomeResponse(desfecho);
        return {
          ok: false,
          status: resp.status,
          code: resp.code ?? 'erro_interno',
          ...(resp.message !== undefined ? { message: resp.message } : {}),
        };
      }

      const registro = registroDaLinha(linhaCriacao);
      if (registro === null) {
        await conn.query(SQL_ROLLBACK_TX);
        emTransacao = false;
        return erroInterno();
      }
      const status = desfecho === 'criado' ? 201 : 200;
      await conn.query(SQL_IDEMPOTENCY_COMPLETE, [
        input.professionalId,
        ACCEPTANCE_OPERATION,
        input.key,
        status,
        `${ACCEPTANCE_RESPONSE_REF_PREFIX}${registro.id}`,
      ]);
      await conn.query(SQL_COMMIT_TX);
      emTransacao = false;
      return { ok: true, status, envelope: montarEnvelopeAceite(registro) };
    } catch (err) {
      if (emTransacao) await conn.query(SQL_ROLLBACK_TX).catch(() => undefined);
      return erroDeBanco(err);
    } finally {
      conn.release();
    }
  }
}

function erroInterno(): AcceptanceResult {
  return { ok: false, status: 500, code: 'erro_interno' };
}

function erroDeBanco(err: unknown): AcceptanceResult {
  const codigo = (err as { code?: unknown } | null)?.code;
  if (codigo === ISO_ERRO_CODE_LOCK) {
    return { ok: false, status: 409, code: 'contencao_temporaria', retryAfterSeconds: 1 };
  }
  if (codigo === ISO_ERRO_CODE_UNIQUE) return erroInterno();
  return ACCEPTANCE_BANCO_INDISPONIVEL;
}

/** Extrai o id do aceite da referencia gravada (acceptance:<uuid>). Formato invalido = null. */
export function referenciaDoAceite(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(ACCEPTANCE_RESPONSE_REF_PREFIX)) return null;
  const id = ref.slice(ACCEPTANCE_RESPONSE_REF_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** Converte a linha do banco no registro do dominio. Linha ausente ou incompleta = null. */
export function registroDaLinha(linha: AcceptanceRow | undefined): AcceptanceRecord | null {
  if (linha === undefined || linha.out_acceptance_id === null || linha.out_conversation_id === null) return null;
  if (linha.out_request_id === null || linha.out_slot_no === null || linha.out_wave === null) return null;
  if (linha.out_status === null || linha.out_accepted_at === null || linha.out_conversation_state === null) return null;
  const acceptedAt =
    linha.out_accepted_at instanceof Date ? linha.out_accepted_at.toISOString() : new Date(linha.out_accepted_at).toISOString();
  return {
    id: linha.out_acceptance_id,
    requestId: linha.out_request_id,
    slotNo: Number(linha.out_slot_no),
    wave: Number(linha.out_wave),
    status: linha.out_status as AcceptanceRecord['status'],
    acceptedAt,
    conversationId: linha.out_conversation_id,
    conversationState: linha.out_conversation_state as AcceptanceRecord['conversationState'],
    firstName: linha.out_first_name ?? null,
  };
}
