// H-105 (Issue 114, docs/factory/80-DESENHO-H105.md §3 e §4) | Manipuladores das rotas /v1/admin/refund-approvals e
// /v1/admin/suspension-approvals. Ordem: guarda da rota (sessao e permissao, sem banco), decisao pura, depois o
// banco (private.approval_dual_*), que e a autoridade. Erro do banco vira resposta sem detalhe. A negacao de
// voto e gravada na auditoria em transacao propria pela porta (recordDenied); se essa gravacao falhar, a
// resposta 403 nao muda.
import { decideAdminGuard } from './guard.js';
import { isUuid } from './access-case.js';
import {
  codigoDeNegacao,
  decideDualOpen,
  decideDualVote,
  expiracaoDoPedido,
  mapDualDbError,
  permissaoParaPedir,
  permissaoParaVotar,
  projetaListaDual,
  respostaDoVoto,
  votosExigidos,
  type DualAction,
  type DualApprovalListItem,
  type DualDenialCode,
  type DualVoteResult,
} from './dual-approval.js';
import type { AdminGuardRecord } from './ports.js';
import type { AdminPermission } from './roles.js';
import { ADMIN_NOT_FOUND, ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

export interface DualOpenDbInput {
  readonly actorUserId: string;
  readonly secret: string;
  readonly action: DualAction;
  readonly subjectId: string;
  readonly amountCents: number | null;
  readonly reason: string;
  readonly approvalId: string;
  readonly nowMs: number;
}

export interface DualVoteDbInput {
  readonly actorUserId: string;
  readonly secret: string;
  readonly family: DualAction;
  readonly approvalId: string;
  readonly nowMs: number;
}

export interface DualCancelDbInput {
  readonly actorUserId: string;
  readonly family: DualAction;
  readonly approvalId: string;
  readonly nowMs: number;
}

export interface DualListDbInput {
  readonly actorUserId: string;
  readonly family: DualAction;
  readonly nowMs: number;
}

export interface DualDeniedDbInput {
  readonly actorUserId: string;
  readonly family: DualAction;
  readonly approvalId: string;
  readonly reasonCode: DualDenialCode;
  readonly nowMs: number;
}

/**
 * Porta do pedido e do voto (adaptador em @fastpro/db). Cada metodo chama uma funcao private.approval_dual_*.
 * Erro do banco chega com `code` (SQLSTATE ou ADMnn) e `message`; quem traduz e o dominio.
 */
export interface DualApprovalPort {
  open(input: DualOpenDbInput): Promise<void>;
  vote(input: DualVoteDbInput): Promise<DualVoteResult>;
  cancel(input: DualCancelDbInput): Promise<void>;
  list(input: DualListDbInput): Promise<readonly DualApprovalListItem[]>;
  /** Grava approval.vote_denied em transacao propria. Pode falhar; quem chama ignora a falha. */
  recordDenied(input: DualDeniedDbInput): Promise<void>;
}

export interface DualApprovalDeps {
  readonly port: DualApprovalPort;
  /** Gera o id do pedido (uuid). Injetado para o teste ser determinista. */
  readonly newId: () => string;
}

export interface DualApprovalRequest {
  /** Linha da guarda do banco para o segredo do cookie (nula = sem sessao valida). */
  readonly row: AdminGuardRecord | null;
  /** Segredo do cookie; nulo quando ausente. */
  readonly secret: string | null;
  /** Corpo ja lido e parseado (undefined = corpo ausente ou invalido). */
  readonly body?: unknown;
  /** Id do pedido na rota (validado aqui). */
  readonly approvalId?: unknown;
}

type Autorizacao =
  | { readonly ok: true; readonly row: AdminGuardRecord }
  | { readonly ok: false; readonly response: AdminResponse };

/** Guarda da rota: sem sessao, papel ou permissao, a resposta vem da mesma regra da API (54 §3 e §4). */
function autorizar(req: DualApprovalRequest, permissao: AdminPermission | 'sessao', nowMs: number): Autorizacao {
  if (req.secret === null) return { ok: false, response: ADMIN_NOT_FOUND };
  const guarda = decideAdminGuard(req.row, permissao, nowMs);
  if (guarda.kind !== 'autorizada' || req.row === null) {
    return { ok: false, response: guarda.kind === 'recusada' ? guarda.response : ADMIN_NOT_FOUND };
  }
  return { ok: true, row: req.row };
}

const DUAL_INDISPONIVEL_LISTA: AdminResponse = adminReply(503, { code: 'aprovacao_indisponivel' });

/** Id do pedido na rota: UUID canonico. Fora do formato, a resposta e a de negacao (403, sem pista). */
function pedidoDaRota(approvalId: unknown): string | null {
  return isUuid(approvalId) ? approvalId : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** POST /v1/admin/{refund|suspension}-approvals: abre o pedido (pendente). Nao libera nada (80 §1). */
export async function handleDualOpen(
  req: DualApprovalRequest,
  deps: DualApprovalDeps,
  nowMs: number,
  family: DualAction,
): Promise<AdminResponse> {
  const auth = autorizar(req, permissaoParaPedir(family), nowMs);
  if (!auth.ok) return auth.response;
  const corpo = isObject(req.body) ? req.body : {};
  const subject = family === 'estorno' ? corpo.payment_id : corpo.professional_id;
  const amount = family === 'estorno' ? corpo.amount_cents : null;
  const negada = decideDualOpen({
    action: family,
    hasPermission: true,
    totpAtMs: auth.row.totpAtMs,
    nowMs,
    subject,
    amountCents: amount,
    reason: corpo.reason,
  });
  if (negada !== null) return negada;

  const approvalId = deps.newId();
  const amountCents = family === 'estorno' ? (amount as number) : null;
  try {
    await deps.port.open({
      actorUserId: auth.row.userId,
      secret: req.secret as string,
      action: family,
      subjectId: subject as string,
      amountCents,
      reason: (corpo.reason as string).trim(),
      approvalId,
      nowMs,
    });
  } catch (err) {
    return mapDualDbError(err, 'abrir');
  }
  return adminReply(201, {
    id: approvalId,
    status: 'pendente',
    required_approvals: votosExigidos(family, amountCents),
    expires_at: expiracaoDoPedido(nowMs),
  });
}

/** GET /v1/admin/{refund|suspension}-approvals: meus pedidos e os pendentes que posso votar (80 §3). */
export async function handleDualList(
  req: DualApprovalRequest,
  deps: DualApprovalDeps,
  nowMs: number,
  family: DualAction,
): Promise<AdminResponse> {
  const auth = autorizar(req, 'sessao', nowMs);
  if (!auth.ok) return auth.response;
  try {
    const itens = await deps.port.list({ actorUserId: auth.row.userId, family, nowMs });
    return adminReply(200, { pedidos: itens.map(projetaListaDual) });
  } catch {
    return DUAL_INDISPONIVEL_LISTA;
  }
}

/** POST .../{id}/vote: outra pessoa com a permissao da familia e prova recente (80 §1 e §3). */
export async function handleDualVote(
  req: DualApprovalRequest,
  deps: DualApprovalDeps,
  nowMs: number,
  family: DualAction,
): Promise<AdminResponse> {
  const auth = autorizar(req, permissaoParaVotar(family), nowMs);
  if (!auth.ok) return auth.response;
  const negada = decideDualVote({ hasPermission: true, totpAtMs: auth.row.totpAtMs, nowMs });
  if (negada !== null) return negada;
  const approvalId = pedidoDaRota(req.approvalId);
  if (approvalId === null) return ADMIN_PERMISSION_DENIED;

  const actorUserId = auth.row.userId;
  let resultado: DualVoteResult;
  try {
    resultado = await deps.port.vote({ actorUserId, secret: req.secret as string, family, approvalId, nowMs });
  } catch (err) {
    await registrarNegacao(deps, { actorUserId, family, approvalId, nowMs }, codigoDeNegacao(err));
    return mapDualDbError(err, 'votar');
  }
  if (resultado.status === 'expirada') {
    await registrarNegacao(deps, { actorUserId, family, approvalId, nowMs }, 'vencido');
  }
  return respostaDoVoto(resultado);
}

/** POST .../{id}/cancel: so o solicitante, enquanto o pedido estiver aberto (80 §1 e D-7-4). */
export async function handleDualCancel(
  req: DualApprovalRequest,
  deps: DualApprovalDeps,
  nowMs: number,
  family: DualAction,
): Promise<AdminResponse> {
  const auth = autorizar(req, 'sessao', nowMs);
  if (!auth.ok) return auth.response;
  const approvalId = pedidoDaRota(req.approvalId);
  if (approvalId === null) return ADMIN_PERMISSION_DENIED;
  try {
    await deps.port.cancel({ actorUserId: auth.row.userId, family, approvalId, nowMs });
  } catch (err) {
    return mapDualDbError(err, 'cancelar');
  }
  return adminReply(200, { status: 'rejeitada' });
}

/** Negacao de voto: grava a auditoria em transacao propria; falha nao muda a resposta (80 §4). */
async function registrarNegacao(
  deps: DualApprovalDeps,
  base: { readonly actorUserId: string; readonly family: DualAction; readonly approvalId: string; readonly nowMs: number },
  codigo: DualDenialCode | null,
): Promise<void> {
  if (codigo === null) return;
  try {
    await deps.port.recordDenied({ ...base, reasonCode: codigo });
  } catch {
    // Metrica de falha de auditoria fica a cargo da borda; nenhum dado sai aqui.
  }
}
