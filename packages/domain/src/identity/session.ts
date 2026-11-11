// H-014 | Sessao de 7 dias: cookie, Max-Age, decisao de conversao e de guarda (docs/factory/52-DESENHO-H014.md
// §1 a §3). Logica pura, sem I/O. A conversao, o consulta e a revogacao ficam em @fastpro/db
// (funcoes private.app_session_*); aqui ficam so as regras que a API aplica sobre a linha lida.
import { IDENT_COOKIE_NAME, SESSION_ABSOLUTE_SECONDS } from './consume.js';

export const SESSION_COOKIE_NAME = '__Host-fp_sess';
/** Teto absoluto da sessao, sem renovacao deslizante (08 §5.1 item 6; CA-H014-04). */
export const SESSION_MAX_AGE_SECONDS = SESSION_ABSOLUTE_SECONDS;
/** Janela do step-up: 30 min, nao deslizante (08 §5.4; CA-H014-15). */
export const STEP_UP_WINDOW_SECONDS = 30 * 60;

const SEGREDO_RE = /^[A-Za-z0-9_-]{43}$/;

/** Corpo fixo da negacao de conversao (52 §1.1). Nao diz qual condicao falhou. */
export const ACCESS_EXPIRED_BODY = { code: 'acesso_expirado' } as const;
/** Corpo fixo de qualquer falha do guarda de sessao em rota de recurso (52 §2). */
export const UNAUTHENTICATED_BODY = { code: 'nao_autenticado' } as const;

/** Metodo de entrada da sessao. 'link' = acesso por e-mail; 'password' = H-016. */
export type AuthMethod = 'link' | 'password';
/** Metodo de prova exigido pelo step-up (52 §4.2). */
export type StepUpMethod = 'code' | 'password';

/** Atributos do Set-Cookie da sessao ativa: SameSite=Lax (D-H014-7; links de e-mail). */
export function sessionCookieHeader(secret: string, maxAgeSeconds: number): string {
  if (!SEGREDO_RE.test(secret)) throw new RangeError('segredo_invalido');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > SESSION_MAX_AGE_SECONDS) {
    throw new RangeError('max_age_invalido');
  }
  return `${SESSION_COOKIE_NAME}=${secret}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * Apaga um cookie. A etapa de identificacao sai com SameSite=Strict (como foi gravada, 46 §3); a
 * sessao, com SameSite=Lax (52 §1.2).
 */
export function clearCookieHeader(cookie: 'identificacao' | 'sessao'): string {
  if (cookie === 'identificacao') {
    return `${IDENT_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
  }
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Max-Age = absolute_expires_at - agora, em segundos inteiros, limitado a [0, 604800] (52 §1.2). */
export function maxAgeSecondsFor(absoluteExpiresAtMs: number, nowMs: number): number {
  const restante = Math.floor((absoluteExpiresAtMs - nowMs) / 1000);
  return Math.min(Math.max(restante, 0), SESSION_MAX_AGE_SECONDS);
}

/** Linha de app.app_session como a API a enxerga (ms desde a epoca). */
export interface SessionRow {
  readonly stage: 'identificacao' | 'ativa';
  readonly revokedAtMs: number | null;
  readonly expiresAtMs: number;
  readonly absoluteExpiresAtMs: number;
  /** app_user.status = 'ativo' (52 §2; a conta bloqueada derruba a sessao). */
  readonly userActive: boolean;
}

export type ConversionDecision = { readonly ok: true } | { readonly ok: false };

/**
 * Conversao da etapa (52 §1): so a etapa 'identificacao', nao revogada, nao vencida (agora < expires_at,
 * no instante exato ja e vencida) e de usuario ativo. Qualquer outro caso e negado sem Set-Cookie.
 */
export function decideConversion(row: SessionRow | null, nowMs: number): ConversionDecision {
  if (row === null) return { ok: false };
  if (row.stage !== 'identificacao') return { ok: false };
  if (row.revokedAtMs !== null) return { ok: false };
  if (!(nowMs < row.expiresAtMs)) return { ok: false };
  if (!row.userActive) return { ok: false };
  return { ok: true };
}

/**
 * Guarda de sessao (52 §2): so a sessao 'ativa', nao revogada, com expires_at e absolute_expires_at
 * depois de agora e usuario ativo. Estado vem do banco, nunca do token; sem renovacao deslizante.
 */
export function isSessionUsable(row: SessionRow, nowMs: number): boolean {
  if (row.stage !== 'ativa') return false;
  if (row.revokedAtMs !== null) return false;
  if (!(nowMs < row.expiresAtMs)) return false;
  if (!(nowMs < row.absoluteExpiresAtMs)) return false;
  return row.userActive;
}
