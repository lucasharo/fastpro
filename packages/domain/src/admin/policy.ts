// H-102 | Politicas puras da area admin: e-mail, senha, formato do token, limites de login e
// validade de convite/sessao (docs/factory/54-DESENHO-H102.md §1 a §3). Sem I/O.

import { ADMIN_INVITE_MAX_CODE_ATTEMPTS } from './responses.js';

/** Senha: 12 a 128 caracteres, sem regra de composicao, diferente do e-mail (54 §2 [PROPOSTA]). */
export const ADMIN_PASSWORD_MIN = 12;
export const ADMIN_PASSWORD_MAX = 128;

/** Limites de login (H-015): 5 falhas por e-mail e 20 por IP na janela de 15 min. */
export const ADMIN_LOGIN_EMAIL_LIMIT = 5;
export const ADMIN_LOGIN_IP_LIMIT = 20;

/** Token de convite: 256 bits em base64url (43 caracteres). Malformado nunca e aceito. */
const FORMATO_CONVITE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAdminTokenFormat(token: string): boolean {
  return FORMATO_CONVITE.test(token);
}

/** E-mail normalizado (aparar, minusculas). Nulo se invalido. */
export function normalizeAdminEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_FORMAT.test(email)) return null;
  return email;
}

export type AdminPasswordProblem = 'curta' | 'longa' | 'igual_email';

export function adminPasswordProblem(password: unknown, email: string): AdminPasswordProblem | null {
  if (typeof password !== 'string') return 'curta';
  if (password.length < ADMIN_PASSWORD_MIN) return 'curta';
  if (password.length > ADMIN_PASSWORD_MAX) return 'longa';
  if (password.toLowerCase() === email.toLowerCase()) return 'igual_email';
  return null;
}

/** Recusa de login por limite: basta um dos dois contadores estar no teto. */
export function adminLoginBlocked(counts: { readonly email: number; readonly ip: number }): boolean {
  return counts.email >= ADMIN_LOGIN_EMAIL_LIMIT || counts.ip >= ADMIN_LOGIN_IP_LIMIT;
}

/** Consultas a auditoria por admin (H-104, 63 R-2 e D-H104-9): 30 consultas em 5 min, mesmo padrao do H-015. */
export const AUDIT_QUERY_RATE_LIMIT = 30;
export const AUDIT_QUERY_RATE_WINDOW_MS = 5 * 60 * 1000;

/** Recusa de consulta por limite: ao atingir o teto a consulta nao e feita e nao entra na trilha. */
export function auditQueryBlocked(count: number): boolean {
  return count >= AUDIT_QUERY_RATE_LIMIT;
}

/** Convite em uso: depois de quantas tentativas erradas o convite e invalidado. */
export function adminCodeAttemptsExhausted(attempts: number): boolean {
  return attempts >= ADMIN_INVITE_MAX_CODE_ATTEMPTS;
}

/** Convite vivo: estado de espera ou de emissao, dentro dos 72 h. */
export function isLiveInvite(state: string, expiresAtMs: number, nowMs: number): boolean {
  return (state === 'emitido' || state === 'aguardando_totp') && expiresAtMs > nowMs;
}
