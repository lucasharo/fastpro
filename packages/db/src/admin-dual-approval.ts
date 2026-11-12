// H-105 (Issue 114, docs/factory/80-DESENHO-H105.md §1 a §4) | Adaptador Pg da dupla aprovacao de estorno e de suspensao
// permanente. O segredo do cookie vira hash SHA-256 antes do banco (so abrir e votar usam sessao). So chama funcoes
// private.approval_dual_* (role app_system). Regras de tipo, prova recente, votos e efeito estao no SQL; o
// dominio traduz o erro. O motivo (texto livre) so entra na chamada de abrir e nunca volta em resposta.
import type {
  DualApprovalListItem,
  DualApprovalPort,
  DualCancelDbInput,
  DualDeniedDbInput,
  DualListDbInput,
  DualOpenDbInput,
  DualVoteDbInput,
  DualVoteResult,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';

const iso = (ms: number): string => new Date(ms).toISOString();

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw new Error(`${campo}_invalido`);
  return valor;
}

function inteiro(valor: unknown, campo: string): number {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`${campo}_invalido`);
  return n;
}

function instante(valor: unknown, campo: string): string {
  const ms = valor instanceof Date ? valor.getTime() : typeof valor === 'string' ? Date.parse(valor) : Number.NaN;
  if (!Number.isFinite(ms)) throw new Error(`${campo}_invalido`);
  return iso(ms);
}

const SQL_OPEN =
  'select private.approval_dual_open($1::uuid, $2::text, $3::text, $4::uuid, $5::integer, $6::text, $7::uuid, $8::timestamptz) as id';
const SQL_VOTE = 'select private.approval_dual_vote($1::uuid, $2::text, $3::text, $4::uuid, $5::timestamptz) as resultado';
const SQL_CANCEL = 'select private.approval_dual_cancel($1::uuid, $2::text, $3::uuid, $4::timestamptz) as status';
const SQL_LIST = 'select * from private.approval_dual_list($1::uuid, $2::text, $3::timestamptz)';
const SQL_DENIED =
  'select private.approval_dual_denied_record($1::uuid, $2::text, $3::uuid, $4::text, $5::timestamptz) as id';

/**
 * Porta da dupla aprovacao. Erros do banco sobem como estao (code = SQLSTATE ou ADMnn; message = nome curto da
 * causa). Quem traduz para 403/409/422/429/503 e o dominio (mapDualDbError), sem eco de dado.
 */
export class PgDualApprovalPort implements DualApprovalPort {
  constructor(private readonly client: SqlClient) {}

  async open(input: DualOpenDbInput): Promise<void> {
    await this.client.query(SQL_OPEN, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      input.action,
      input.subjectId,
      input.amountCents,
      input.reason,
      input.approvalId,
      iso(input.nowMs),
    ]);
  }

  /** Vota e devolve o estado gravado pelo banco (status, votos e exigidas). Vencido vem como 'expirada'. */
  async vote(input: DualVoteDbInput): Promise<DualVoteResult> {
    const res = await this.client.query(SQL_VOTE, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      input.family,
      input.approvalId,
      iso(input.nowMs),
    ]);
    const row = res.rows[0] as { resultado?: unknown } | undefined;
    const r = (row?.resultado ?? {}) as Record<string, unknown>;
    return {
      status: texto(r.status, 'estado'),
      votes: inteiro(r.votes, 'votos'),
      required: inteiro(r.required, 'exigidas'),
    };
  }

  async cancel(input: DualCancelDbInput): Promise<void> {
    await this.client.query(SQL_CANCEL, [input.actorUserId, input.family, input.approvalId, iso(input.nowMs)]);
  }

  /** Lista que o banco filtra (meus pedidos e pendentes que posso votar). Nenhum motivo sai daqui. */
  async list(input: DualListDbInput): Promise<readonly DualApprovalListItem[]> {
    const res = await this.client.query(SQL_LIST, [input.actorUserId, input.family, iso(input.nowMs)]);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: texto(row.out_id, 'pedido'),
        tipo: input.family,
        estado: texto(row.out_estado, 'estado'),
        valor_centavos: row.out_valor_centavos === null || row.out_valor_centavos === undefined
          ? null
          : inteiro(row.out_valor_centavos, 'valor'),
        subject_ref: texto(row.out_subject_ref, 'alvo'),
        votos: inteiro(row.out_votos, 'votos'),
        required_approvals: inteiro(row.out_required_approvals, 'exigidas'),
        expires_at: instante(row.out_expires_at, 'expira'),
        solicitado_por_mim: row.out_solicitado_por_mim === true,
      };
    });
  }

  /** Grava approval.vote_denied em transacao propria (chamada apos a negacao, nunca na mesma transacao). */
  async recordDenied(input: DualDeniedDbInput): Promise<void> {
    await this.client.query(SQL_DENIED, [
      input.actorUserId,
      input.family,
      input.approvalId,
      input.reasonCode,
      iso(input.nowMs),
    ]);
  }
}
