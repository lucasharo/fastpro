// H-073 (#83, docs/factory/60-DESENHO-H073.md §1 a §4) | Decisoes puras do caso de acesso excepcional a
// conversa. A autoridade e o banco (private.access_case_*); aqui so se decide a resposta, para a API e os
// testes. Negacoes de caso usam SEMPRE a mesma resposta (403 permission_denied, D-H073-5), salvo a prova
// recente (403 step_up_required) e a entrada invalida (422). Nenhuma decisao devolve justificativa ou texto.

import { ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';
import { isTotpRecent } from './session.js';

/** Justificativa: 20 a 500 caracteres depois de aparar (60 §1). */
export const ACCESS_JUSTIFICATION_MIN = 20;
export const ACCESS_JUSTIFICATION_MAX = 500;
/** Janela do caso: 30 min a partir da aprovacao, sem renovacao (60 §2). */
export const ACCESS_WINDOW_MS = 30 * 60 * 1000;
/** Pedido de aprovacao: 24 h (dupla aprovacao de H-102). */
export const ACCESS_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export const STEP_UP_REQUIRED: AdminResponse = adminReply(403, { code: 'step_up_required' });
export const CONVERSA_INVALIDA: AdminResponse = adminReply(422, { code: 'conversa_invalida' });
export const JUSTIFICATIVA_INVALIDA: AdminResponse = adminReply(422, { code: 'justificativa_invalida' });

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID no formato canonico. Qualquer outra coisa e recusada antes do banco (inclusive id de caso na rota). */
export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_FORMAT.test(raw);
}

/** Identificador de conversa: UUID no formato canonico. */
export function isConversationId(raw: unknown): raw is string {
  return isUuid(raw);
}

/** Justificativa valida (apos trim): 20 a 500 caracteres. Qualquer outro tipo e invalido. */
export function isAccessJustificationValid(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const n = raw.trim().length;
  return n >= ACCESS_JUSTIFICATION_MIN && n <= ACCESS_JUSTIFICATION_MAX;
}

export interface AccessOpenInput {
  readonly hasOpenPermission: boolean;
  /** totp_at da sessao, ou nulo se a sessao nao e valida. */
  readonly totpAtMs: number | null;
  readonly nowMs: number;
  readonly conversationId: unknown;
  readonly justification: unknown;
}

/** Abrir caso: permissao, sessao, prova recente, conversa e justificativa, nesta ordem (60 §1). */
export function decideAccessCaseOpen(input: AccessOpenInput): AdminResponse | null {
  if (!input.hasOpenPermission || input.totpAtMs === null) return ADMIN_PERMISSION_DENIED;
  if (!isTotpRecent(input.totpAtMs, input.nowMs)) return STEP_UP_REQUIRED;
  if (!isConversationId(input.conversationId)) return CONVERSA_INVALIDA;
  if (!isAccessJustificationValid(input.justification)) return JUSTIFICATIVA_INVALIDA;
  return null;
}

export interface AccessApproveInput {
  readonly hasAuthorizePermission: boolean;
  readonly totpAtMs: number | null;
  readonly nowMs: number;
  readonly requesterId: string;
  readonly approverId: string;
  /** Caso pendente: nao aprovado, nao fechado e com pedido dentro das 24 h. */
  readonly pendente: boolean;
  /** Aprovadores que ja votaram neste pedido (um voto por pessoa). */
  readonly votaram: readonly string[];
}

/** Aprovar caso: outra pessoa, com permissao propria, prova recente, pendente e sem voto repetido. */
export function decideAccessCaseApprove(input: AccessApproveInput): AdminResponse | null {
  if (!input.hasAuthorizePermission || input.totpAtMs === null) return ADMIN_PERMISSION_DENIED;
  if (!isTotpRecent(input.totpAtMs, input.nowMs)) return STEP_UP_REQUIRED;
  if (input.approverId === input.requesterId) return ADMIN_PERMISSION_DENIED;
  if (input.votaram.includes(input.approverId)) return ADMIN_PERMISSION_DENIED;
  if (!input.pendente) return ADMIN_PERMISSION_DENIED;
  return null;
}

export interface AccessReadInput {
  readonly hasOpenPermission: boolean;
  readonly caseFound: boolean;
  /** O solicitante do caso e quem le (admin nao herda caso de outra pessoa). */
  readonly openedByActor: boolean;
  readonly scopeMatches: boolean;
  readonly approvedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly closed: boolean;
  readonly nowMs: number;
}

/** Leitura: so com caso ativo do proprio solicitante para a conversa, dentro de [aprovado, expira). */
export function decideAccessCaseRead(input: AccessReadInput): AdminResponse | null {
  if (!input.hasOpenPermission || !input.caseFound || !input.openedByActor || !input.scopeMatches) {
    return ADMIN_PERMISSION_DENIED;
  }
  if (input.closed || input.approvedAtMs === null || input.expiresAtMs === null) {
    return ADMIN_PERMISSION_DENIED;
  }
  if (!isAccessWindowOpen(input.approvedAtMs, input.expiresAtMs, input.nowMs)) {
    return ADMIN_PERMISSION_DENIED;
  }
  return null;
}

/** Janela: aprovado <= agora < expira. No instante exato de expira ja e negada (limite estrito). */
export function isAccessWindowOpen(approvedAtMs: number, expiresAtMs: number, nowMs: number): boolean {
  return approvedAtMs <= nowMs && nowMs < expiresAtMs;
}
