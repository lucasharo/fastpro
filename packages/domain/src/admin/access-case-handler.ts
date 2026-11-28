// H-073 (#83, docs/factory/60-DESENHO-H073.md §1 a §4) | Manipuladores das rotas /v1/admin/access-cases.
// Ordem: sessao e permissao da rota (guarda, 404/403, sem banco); decisoes puras (403 step_up_required,
// 422); depois o banco (private.access_case_*), que e a autoridade. Erro do banco vira resposta sem
// detalhe: negacoes de caso saem todas como 403 permission_denied (D-H073-5). Justificativa e texto de
// mensagem nunca voltam em resposta de erro.

import { decideAdminGuard } from './guard.js';
import {
  CONVERSA_INVALIDA,
  JUSTIFICATIVA_INVALIDA,
  STEP_UP_REQUIRED,
  decideAccessCaseOpen,
  isUuid,
} from './access-case.js';
import { isTotpRecent } from './session.js';
import type { AdminGuardRecord } from './ports.js';
import type { AdminPermission } from './roles.js';
import { ADMIN_NOT_FOUND, ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

/** Codigos do banco que significam "negado" para quem pede (sem diferenciar a causa). */
const NEGADO_PELO_BANCO = new Set([
  'ADM20', // gate: sem caso, vencido, fechado, outra conversa ou sessao invalida
  '42501', // permissao_negada e autoaprovacao do voto
  'ADM25', // caso nao pendente
  '23503', // pedido de aprovacao inexistente
  '23514', // pedido nao pendente
  '23505', // voto repetido do mesmo aprovador
  'ADM08', // pedido de aprovacao inexistente (H-102)
  'ADM09', // pedido de aprovacao nao pendente (H-102)
]);

export interface AccessCaseOpenInput {
  readonly actorUserId: string;
  readonly secret: string;
  readonly caseId: string;
  readonly conversationId: string;
  readonly justification: string;
  readonly nowMs: number;
}

export interface AccessCaseActionInput {
  readonly actorUserId: string;
  readonly secret: string;
  readonly caseId: string;
  readonly nowMs: number;
}

export interface AccessCaseListInput {
  readonly actorUserId: string;
  readonly secret: string;
  /** Quem tem case.authorize_sensitive tambem ve os pendentes de outras pessoas (60 §1). */
  readonly canAuthorize: boolean;
  readonly nowMs: number;
}

/** Linha da lista. Os campos de fora da projecao (participantes, conteudo) nunca saem na resposta. */
export interface AccessCaseListItem {
  readonly id: string;
  readonly estado: string;
  readonly scope_id: string;
  readonly justificativa: string;
  readonly expires_at: string | null;
}

/**
 * Porta do caso (adaptador em @fastpro/db, a fazer). Cada metodo chama uma funcao private.access_case_*
 * do banco. Erro do banco chega com `code` (SQLSTATE ou ADMnn) e `message`.
 */
export interface AccessCasePort {
  open(input: AccessCaseOpenInput): Promise<void>;
  /** Devolve o instante de vencimento da janela de 30 min (approved_at + 30 min, no banco). */
  approve(input: AccessCaseActionInput): Promise<{ readonly expiresAtMs: number }>;
  close(input: AccessCaseActionInput): Promise<void>;
  list(input: AccessCaseListInput): Promise<readonly AccessCaseListItem[]>;
}

/** Leitura da conversa (H-065/H-066). Chama private.access_case_gate na mesma transacao da leitura. */
export interface AccessCaseReadInput {
  readonly actorUserId: string;
  readonly secret: string;
  readonly caseId: string;
  readonly cursor: number | null;
  readonly nowMs: number;
}

export interface AccessCaseConversationPort {
  read(input: AccessCaseReadInput): Promise<Readonly<Record<string, unknown>>>;
}

export interface AccessCaseDeps {
  readonly cases: AccessCasePort;
  /** Gera o id do caso (uuid). Injetado para o teste ser determinista. */
  readonly newCaseId: () => string;
  /** Sem esta porta a leitura nao existe ainda (501): a conversa nasce com H-065/H-066. */
  readonly conversation?: AccessCaseConversationPort;
}

export interface AccessCaseRequest {
  /** Linha da guarda do banco para o segredo do cookie (nula = sem sessao valida). */
  readonly row: AdminGuardRecord | null;
  /** Segredo do cookie; nulo quando ausente. */
  readonly secret: string | null;
  /** Corpo ja lido e parseado (undefined = corpo ausente ou invalido). */
  readonly body?: unknown;
  /** Id do caso na rota (validado aqui). */
  readonly caseId?: unknown;
}

export const ACCESS_CASE_CONFLICT: AdminResponse = adminReply(409, { code: 'caso_ja_existe' });
export const ACCESS_CASE_TOO_MANY: AdminResponse = adminReply(429, { code: 'muitos_casos_pendentes' });
export const ACCESS_CASE_UNAVAILABLE: AdminResponse = adminReply(503, { code: 'casos_indisponivel' });
export const ACCESS_READ_UNAVAILABLE: AdminResponse = adminReply(501, { code: 'leitura_indisponivel' });
export const PAGINACAO_INVALIDA: AdminResponse = adminReply(422, { code: 'paginacao_invalida' });

/** Erro do banco para resposta. Nada da mensagem do banco sai, exceto a validacao conhecida (ADM22). */
export function mapAccessCaseDbError(err: unknown): AdminResponse {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
  const message = typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : '';
  if (NEGADO_PELO_BANCO.has(code)) return ADMIN_PERMISSION_DENIED;
  if (code === 'ADM21') return STEP_UP_REQUIRED;
  if (code === 'ADM22') return message.includes('conversa_invalida') ? CONVERSA_INVALIDA : JUSTIFICATIVA_INVALIDA;
  if (code === 'ADM23') return ACCESS_CASE_CONFLICT;
  if (code === 'ADM24') return ACCESS_CASE_TOO_MANY;
  return ACCESS_CASE_UNAVAILABLE;
}

type Autorizacao =
  | { readonly ok: true; readonly row: AdminGuardRecord }
  | { readonly ok: false; readonly response: AdminResponse };

/** Guarda da rota: sem sessao, papel ou permissao, a resposta vem da mesma regra da API (54 §3 e §4). */
function autorizar(req: AccessCaseRequest, permissao: AdminPermission | 'sessao', nowMs: number): Autorizacao {
  if (req.secret === null) return { ok: false, response: ADMIN_NOT_FOUND };
  const guarda = decideAdminGuard(req.row, permissao, nowMs);
  if (guarda.kind !== 'autorizada' || req.row === null) {
    return { ok: false, response: guarda.kind === 'recusada' ? guarda.response : ADMIN_NOT_FOUND };
  }
  return { ok: true, row: req.row };
}

/** Id da rota: UUID canonico. Fora do formato, a resposta e a de caso inexistente (403 permission_denied). */
function casoDaRota(caseId: unknown): string | null {
  return isUuid(caseId) ? caseId : null;
}

/** POST /v1/admin/access-cases: abre o pedido (pendente). Nao libera nada (CA-H073-02). */
export async function handleAccessCaseOpen(
  req: AccessCaseRequest,
  deps: AccessCaseDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const auth = autorizar(req, 'case.open_sensitive', nowMs);
  if (!auth.ok) return auth.response;
  const corpo = isObject(req.body) ? req.body : {};
  const justificativa = corpo.justification;
  const negada = decideAccessCaseOpen({
    hasOpenPermission: true,
    totpAtMs: auth.row.totpAtMs,
    nowMs,
    conversationId: corpo.conversation_id,
    justification: justificativa,
  });
  if (negada !== null) return negada;
  const caseId = deps.newCaseId();
  try {
    await deps.cases.open({
      actorUserId: auth.row.userId,
      secret: req.secret as string,
      caseId,
      conversationId: corpo.conversation_id as string,
      justification: (justificativa as string).trim(),
      nowMs,
    });
  } catch (err) {
    return mapAccessCaseDbError(err);
  }
  return adminReply(201, { id: caseId, status: 'pendente' });
}

/** GET /v1/admin/access-cases: meus casos e, se tiver case.authorize_sensitive, os pendentes de outros. */
export async function handleAccessCaseList(req: AccessCaseRequest, deps: AccessCaseDeps, nowMs: number): Promise<AdminResponse> {
  const auth = autorizar(req, 'sessao', nowMs);
  if (!auth.ok) return auth.response;
  const canAuthorize = auth.row.permissions.includes('case.authorize_sensitive');
  try {
    const itens = await deps.cases.list({ actorUserId: auth.row.userId, secret: req.secret as string, canAuthorize, nowMs });
    return adminReply(200, { casos: itens.map(projetaItem) });
  } catch {
    return ACCESS_CASE_UNAVAILABLE;
  }
}

/** POST /v1/admin/access-cases/{id}/approve: outra pessoa, com permissao e prova recente (CA-H073-03). */
export async function handleAccessCaseApprove(
  req: AccessCaseRequest,
  deps: AccessCaseDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const auth = autorizar(req, 'case.authorize_sensitive', nowMs);
  if (!auth.ok) return auth.response;
  if (!isTotpRecent(auth.row.totpAtMs, nowMs)) return STEP_UP_REQUIRED;
  const caseId = casoDaRota(req.caseId);
  if (caseId === null) return ADMIN_PERMISSION_DENIED;
  try {
    const { expiresAtMs } = await deps.cases.approve({
      actorUserId: auth.row.userId,
      secret: req.secret as string,
      caseId,
      nowMs,
    });
    return adminReply(200, { status: 'ativo', expires_at: new Date(expiresAtMs).toISOString() });
  } catch (err) {
    return mapAccessCaseDbError(err);
  }
}

/** POST /v1/admin/access-cases/{id}/close: solicitante (encerrado) ou autorizador (revogado). Idempotente no banco. */
export async function handleAccessCaseClose(req: AccessCaseRequest, deps: AccessCaseDeps, nowMs: number): Promise<AdminResponse> {
  const auth = autorizar(req, 'sessao', nowMs);
  if (!auth.ok) return auth.response;
  const caseId = casoDaRota(req.caseId);
  if (caseId === null) return ADMIN_PERMISSION_DENIED;
  try {
    await deps.cases.close({ actorUserId: auth.row.userId, secret: req.secret as string, caseId, nowMs });
    return adminReply(200, { status: 'fechado' });
  } catch (err) {
    return mapAccessCaseDbError(err);
  }
}

/** POST /v1/admin/access-cases/{id}/conversation/read: uma pagina, com registro na mesma transacao (CA-H073-06). */
export async function handleAccessCaseRead(req: AccessCaseRequest, deps: AccessCaseDeps, nowMs: number): Promise<AdminResponse> {
  const auth = autorizar(req, 'case.open_sensitive', nowMs);
  if (!auth.ok) return auth.response;
  const caseId = casoDaRota(req.caseId);
  if (caseId === null) return ADMIN_PERMISSION_DENIED;
  const corpo = isObject(req.body) ? req.body : {};
  const cursor = corpo.cursor === undefined ? null : corpo.cursor;
  if (cursor !== null && !(Number.isSafeInteger(cursor) && (cursor as number) >= 0)) return PAGINACAO_INVALIDA;
  if (deps.conversation === undefined) return ACCESS_READ_UNAVAILABLE;
  try {
    const pagina = await deps.conversation.read({
      actorUserId: auth.row.userId,
      secret: req.secret as string,
      caseId,
      cursor: cursor as number | null,
      nowMs,
    });
    return adminReply(200, { ...pagina });
  } catch (err) {
    return mapAccessCaseDbError(err);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Projecao fechada: so os cinco campos de 60 §1; o resto da linha do banco nao sai. */
function projetaItem(item: AccessCaseListItem): AccessCaseListItem {
  return {
    id: item.id,
    estado: item.estado,
    scope_id: item.scope_id,
    justificativa: item.justificativa,
    expires_at: item.expires_at,
  };
}
