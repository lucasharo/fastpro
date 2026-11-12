// H-030 (Issue #43) | Revisao e confirmacao expressa do pedido (docs/factory/90-DESENHO-H030.md, §2 e §4).
// Logica pura, sem I/O. A autoridade sobre o banco e a funcao private.draft_confirm; a regra de campos
// faltando para a revisao usa draftMissingForReview (H-025), com a mesma ordem de DRAFT_REVIEW_FIELDS.
import {
  DRAFT_CURRENT_PATH,
  draftMissingForReview,
  type DraftRatePolicy,
  type DraftReviewField,
  type DraftStatus,
  type DraftUrgency,
} from './request-draft.js';

export const DRAFT_REVIEW_PATH = `${DRAFT_CURRENT_PATH}/review` as const;
export const DRAFT_CONFIRM_PATH = `${DRAFT_CURRENT_PATH}/confirm` as const;
/** Corpo do POST de confirmacao: no maximo 1 KB (90 §2.2). */
export const DRAFT_CONFIRM_BODY_LIMIT_BYTES = 1024;
/** Maior versao de conteudo aceita (coluna integer). */
export const DRAFT_CONTENT_REV_MAX = 2147483647;

/** Limite da confirmacao: 10 por 60 s por rascunho (chave = hash do segredo) e 30 por 60 s por IP-HMAC. */
export const DRAFT_RATE_CONFIRMAR_RASCUNHO: DraftRatePolicy = {
  id: 'confirmar_rascunho',
  spanS: 60,
  bucketS: 10,
  limit: 10,
};
export const DRAFT_RATE_CONFIRMAR_IP: DraftRatePolicy = { id: 'confirmar_ip', spanS: 60, bucketS: 10, limit: 30 };

export type DraftConfirmBodyErrorCode = 'corpo_grande' | 'corpo_invalido';

export type DraftConfirmBodyResult =
  | { readonly ok: true; readonly contentRev: number }
  | { readonly ok: false; readonly status: 413 | 422; readonly code: DraftConfirmBodyErrorCode };

/**
 * Confere o corpo ja lido do POST /confirm: uma unica chave, content_rev, inteiro de 0 a DRAFT_CONTENT_REV_MAX.
 * Acima de 1 KB: 413. Qualquer outra forma (outra chave, tipo, JSON invalido, objeto vazio): 422.
 */
export function parseConfirmBody(text: string, byteLength: number): DraftConfirmBodyResult {
  if (byteLength > DRAFT_CONFIRM_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const obj = raw as Record<string, unknown>;
  const chaves = Object.keys(obj);
  if (chaves.length !== 1 || chaves[0] !== 'content_rev') return { ok: false, status: 422, code: 'corpo_invalido' };
  const valor = obj['content_rev'];
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0 || valor > DRAFT_CONTENT_REV_MAX) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  return { ok: true, contentRev: valor };
}

/** Dados do rascunho vivo para a revisao (so o dono os recebe; nada de coordenada, hash ou IP). */
export interface DraftReviewRecord {
  readonly id: string;
  readonly status: DraftStatus;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly serviceActive: boolean;
  readonly addressText: string | null;
  readonly urgency: DraftUrgency | null;
  readonly description: string | null;
  readonly firstName: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly confirmedAt: string | null;
  readonly contentRev: number;
  readonly expiresAt: string;
}

/** Corpo de 200 da revisao (lista fechada de chaves, 90 §2.1). */
export interface DraftReviewView {
  readonly id: string;
  readonly content_rev: number;
  readonly confirmed_at: string | null;
  readonly service: { readonly id: string; readonly name: string };
  readonly address_text: string;
  readonly urgency: DraftUrgency;
  readonly description: string;
  readonly first_name: string;
  readonly email: string;
  readonly expires_at: string;
}

export type DraftReviewDecision =
  | { readonly kind: 'pronto'; readonly view: DraftReviewView }
  | { readonly kind: 'campos_faltando'; readonly missing: readonly DraftReviewField[] }
  | { readonly kind: 'email_nao_confirmado' };

/**
 * Decide a resposta da revisao, na ordem do desenho: campos faltando (422) -> e-mail nao confirmado (409)
 * -> pronto (200). Servico inativo conta como servico faltando.
 */
export function decideReview(r: DraftReviewRecord): DraftReviewDecision {
  const missing = draftMissingForReview({
    serviceId: r.serviceActive ? r.serviceId : null,
    addressText: r.addressText,
    urgency: r.urgency,
    description: r.description,
    firstName: r.firstName,
    email: r.email,
  });
  if (missing.length > 0) return { kind: 'campos_faltando', missing };
  if (!r.emailVerified || r.status !== 'aberto') return { kind: 'email_nao_confirmado' };
  return {
    kind: 'pronto',
    view: {
      id: r.id,
      content_rev: r.contentRev,
      confirmed_at: r.confirmedAt,
      service: { id: r.serviceId ?? '', name: r.serviceName ?? '' },
      address_text: r.addressText ?? '',
      urgency: r.urgency as DraftUrgency,
      description: r.description ?? '',
      first_name: r.firstName ?? '',
      email: r.email ?? '',
      expires_at: r.expiresAt,
    },
  };
}

/** Resultado da confirmacao, como o banco o decide (ordem fixa de recusas, 90 §2.2). */
export type DraftConfirmResult =
  | { readonly kind: 'ok'; readonly confirmedAt: string; readonly contentRev: number }
  | { readonly kind: 'nao_encontrado' }
  | { readonly kind: 'campos_faltando'; readonly missing: readonly DraftReviewField[] }
  | { readonly kind: 'email_nao_confirmado' }
  | { readonly kind: 'conteudo_alterado' };

export interface DraftConfirmInput {
  readonly secretHash: string;
  readonly nowMs: number;
  readonly contentRev: number;
  readonly ttlDays: number;
}

/** Porta do banco para revisao e confirmacao (implementada em @fastpro/db, PgDraftStore). */
export interface DraftReviewStorePort {
  /** Rascunho vivo do segredo para a revisao; null quando nao existe (404 uniforme). Nao altera nada. */
  reviewGet(secretHash: string, nowMs: number): Promise<DraftReviewRecord | null>;
  /** Confirma o conteudo visto (content_rev). Idempotente na mesma versao. Nunca publica. */
  confirm(input: DraftConfirmInput): Promise<DraftConfirmResult>;
}
