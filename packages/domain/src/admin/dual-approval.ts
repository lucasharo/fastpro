// H-105 (Issue 114, docs/factory/80-DESENHO-H105.md §1 a §3) | Regras puras da dupla aprovacao de estorno e de
// suspensao permanente. A autoridade e o banco (private.approval_dual_*); aqui so se decide a resposta antes
// do banco e se traduz o resultado. Negacoes usam SEMPRE 403 permission_denied (mesmo corpo), salvo a prova
// recente (403 step_up_required), a entrada invalida (422) e o pedido vencido ou nao pendente (409).
import { STEP_UP_REQUIRED, isUuid } from './access-case.js';
import { isTotpRecent } from './session.js';
import type { AdminPermission } from './roles.js';
import { ADMIN_APPROVAL_TTL_MS, ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

/** Tipos de acao com dupla aprovacao nesta etapa (o tipo e a familia da rota). */
export const DUAL_ACTIONS = ['estorno', 'suspensao_permanente'] as const;
export type DualAction = (typeof DUAL_ACTIONS)[number];

/** Estorno ate este valor (inclusive, R$ 200,00) exige 1 aprovacao; acima, 2 (RF-151, 78 §2). */
export const REFUND_SINGLE_APPROVAL_MAX_CENTS = 20000;
/** Motivo: 10 a 500 caracteres depois de aparar. Fica so no pedido (80 R-7). */
export const DUAL_REASON_MIN = 10;
export const DUAL_REASON_MAX = 500;
/** Valor em centavos: inteiro positivo que cabe em integer do banco. */
export const DUAL_AMOUNT_MAX_CENTS = 2147483647;
/** Pedidos pendentes por solicitante (ADM24 no banco). */
export const DUAL_PENDING_LIMIT = 5;

export const DUAL_VALOR_INVALIDO: AdminResponse = adminReply(422, { code: 'valor_invalido' });
export const DUAL_MOTIVO_INVALIDO: AdminResponse = adminReply(422, { code: 'motivo_invalido' });
export const DUAL_ALVO_INVALIDO: AdminResponse = adminReply(422, { code: 'alvo_invalido' });
export const DUAL_STEP_UP_REQUIRED: AdminResponse = STEP_UP_REQUIRED;
export const DUAL_PEDIDO_JA_ABERTO: AdminResponse = adminReply(409, { code: 'pedido_ja_aberto' });
export const DUAL_MUITOS_PENDENTES: AdminResponse = adminReply(429, { code: 'muitos_pedidos_pendentes' });
export const DUAL_APROVACAO_EXPIRADA: AdminResponse = adminReply(409, { code: 'aprovacao_expirada' });
export const DUAL_NAO_PENDENTE: AdminResponse = adminReply(409, { code: 'aprovacao_nao_pendente' });
export const DUAL_INDISPONIVEL: AdminResponse = adminReply(503, { code: 'aprovacao_indisponivel' });

/** Votos exigidos pelo valor (80 §1): estorno 1 ate R$ 200,00 e 2 acima; suspensao sempre 2. */
export function votosExigidos(action: DualAction, amountCents: number | null): 1 | 2 {
  if (action === 'suspensao_permanente') return 2;
  return amountCents !== null && amountCents > REFUND_SINGLE_APPROVAL_MAX_CENTS ? 2 : 1;
}

/** Permissao de pedir: Financeiro (estorno) ou Suporte (suspensao). Superadmin nao herda nenhuma. */
export function permissaoParaPedir(action: DualAction): AdminPermission {
  return action === 'estorno' ? 'finance.refund.request' : 'account.suspend.request';
}

/** Permissao de votar: Financeiro (estorno) ou Moderador (suspensao). */
export function permissaoParaVotar(action: DualAction): AdminPermission {
  return action === 'estorno' ? 'finance.refund.approve' : 'account.suspend.approve';
}

export function isDualAction(raw: unknown): raw is DualAction {
  return typeof raw === 'string' && (DUAL_ACTIONS as readonly string[]).includes(raw);
}

/** Valor do estorno: inteiro seguro, positivo e dentro do tipo do banco. Qualquer outra coisa e invalida. */
export function isDualAmountValid(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 && raw <= DUAL_AMOUNT_MAX_CENTS;
}

/** Motivo valido depois de aparar: texto de 10 a 500 caracteres. */
export function isDualReasonValid(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const n = raw.trim().length;
  return n >= DUAL_REASON_MIN && n <= DUAL_REASON_MAX;
}

export interface DualOpenInput {
  readonly action: DualAction;
  readonly hasPermission: boolean;
  /** totp_at da sessao, ou nulo se a sessao nao e valida. */
  readonly totpAtMs: number | null;
  readonly nowMs: number;
  /** Alvo: payment_id (estorno) ou professional_id (suspensao). */
  readonly subject: unknown;
  readonly amountCents: unknown;
  readonly reason: unknown;
}

/** Pedido: permissao, prova recente, alvo, valor (so estorno), motivo, nesta ordem. Nao decide o banco. */
export function decideDualOpen(input: DualOpenInput): AdminResponse | null {
  if (!input.hasPermission || input.totpAtMs === null) return ADMIN_PERMISSION_DENIED;
  if (!isTotpRecent(input.totpAtMs, input.nowMs)) return DUAL_STEP_UP_REQUIRED;
  if (!isUuid(input.subject)) return DUAL_ALVO_INVALIDO;
  if (input.action === 'estorno' && !isDualAmountValid(input.amountCents)) return DUAL_VALOR_INVALIDO;
  if (!isDualReasonValid(input.reason)) return DUAL_MOTIVO_INVALIDO;
  return null;
}

export interface DualVoteInput {
  readonly hasPermission: boolean;
  readonly totpAtMs: number | null;
  readonly nowMs: number;
}

/**
 * Voto: permissao da familia e prova recente. Autoaprovacao, voto repetido, pedido vencido ou nao pendente
 * dependem do pedido e sao decididos pelo banco (gatilho e funcao); o adaptador traduz esses erros.
 */
export function decideDualVote(input: DualVoteInput): AdminResponse | null {
  if (!input.hasPermission || input.totpAtMs === null) return ADMIN_PERMISSION_DENIED;
  if (!isTotpRecent(input.totpAtMs, input.nowMs)) return DUAL_STEP_UP_REQUIRED;
  return null;
}

/** Cancelamento: so o solicitante (o banco confere). Aqui so a checagem local de quem pede. */
export function decideDualCancel(requesterId: string, actorId: string): AdminResponse | null {
  return requesterId === actorId ? null : ADMIN_PERMISSION_DENIED;
}

/** Resultado do voto (banco) para resposta. Pedido vencido vira 409 aprovacao_expirada (CA-H105-08). */
export interface DualVoteResult {
  readonly status: string;
  readonly votes: number;
  readonly required: number;
}

export function respostaDoVoto(result: DualVoteResult): AdminResponse {
  if (result.status === 'expirada') return DUAL_APROVACAO_EXPIRADA;
  return adminReply(200, {
    status: result.status,
    votes: result.votes,
    required_approvals: result.required,
  });
}

/** Motivo de negacao de voto para a auditoria (approval.vote_denied, reason_code). Null = nao registrar. */
export type DualDenialCode = 'autoaprovacao' | 'voto_repetido' | 'sem_permissao' | 'inativo' | 'vencido' | 'nao_pendente';

/** Codigo de auditoria a partir do erro do banco (mensagem ou SQLSTATE). Nada do texto livre sai. */
export function codigoDeNegacao(err: unknown): DualDenialCode | null {
  const code = erroCodigo(err);
  const message = erroMensagem(err);
  if (message.includes('aprovacao_propria')) return 'autoaprovacao';
  if (message.includes('aprovador_nao_ativo')) return 'inativo';
  if (code === '23505') return 'voto_repetido';
  if (code === 'ADM27' || code === '23514') return 'nao_pendente';
  if (code === '42501' && message.includes('permissao')) return 'sem_permissao';
  return null;
}

/**
 * Erro do banco para resposta. Causas de negacao saem todas como 403 permission_denied, sem diferenciar
 * (80 §3). Contexto 'abrir' trata a duplicidade como 409; no voto, o mesmo codigo e negacao.
 */
export function mapDualDbError(err: unknown, contexto: 'abrir' | 'votar' | 'cancelar'): AdminResponse {
  const code = erroCodigo(err);
  const message = erroMensagem(err);
  if (code === 'ADM21') return DUAL_STEP_UP_REQUIRED;
  if (code === 'ADM22') {
    if (message.includes('valor_invalido')) return DUAL_VALOR_INVALIDO;
    if (message.includes('motivo_invalido')) return DUAL_MOTIVO_INVALIDO;
    return DUAL_ALVO_INVALIDO;
  }
  if (code === 'ADM23' || (code === '23505' && contexto === 'abrir')) return DUAL_PEDIDO_JA_ABERTO;
  if (code === 'ADM24') return DUAL_MUITOS_PENDENTES;
  if (code === 'ADM27' || code === '23514') return DUAL_NAO_PENDENTE;
  if (code === '42501' || code === '23505' || code === '23503' || code === 'ADM08') return ADMIN_PERMISSION_DENIED;
  return DUAL_INDISPONIVEL;
}

/** Item da listagem. Motivo (texto livre) nunca sai; so o que a lista precisa (80 §3). */
export interface DualApprovalListItem {
  readonly id: string;
  readonly tipo: DualAction;
  readonly estado: string;
  readonly valor_centavos: number | null;
  readonly subject_ref: string;
  readonly votos: number;
  readonly required_approvals: number;
  readonly expires_at: string;
  readonly solicitado_por_mim: boolean;
}

/** Projecao fechada do item: campos fora desta lista nunca saem na resposta. */
export function projetaListaDual(item: DualApprovalListItem): DualApprovalListItem {
  return {
    id: item.id,
    tipo: item.tipo,
    estado: item.estado,
    valor_centavos: item.valor_centavos,
    subject_ref: item.subject_ref,
    votos: item.votos,
    required_approvals: item.required_approvals,
    expires_at: item.expires_at,
    solicitado_por_mim: item.solicitado_por_mim,
  };
}

/** Validade do pedido: 24 h a partir do pedido (80 §1). */
export function expiracaoDoPedido(nowMs: number): string {
  return new Date(nowMs + ADMIN_APPROVAL_TTL_MS).toISOString();
}

function erroCodigo(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

function erroMensagem(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}
