// H-102 | Respostas padronizadas da area admin (54 §2, §3, §4). Logica pura, sem I/O.
// Causas que devem ser indistinguiveis (404 de sessao/papel e 404 de rota inexistente) devolvem o
// MESMO objeto. Todas as respostas admin levam Cache-Control: no-store e nosniff.

export interface AdminResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly setCookie?: string;
}

export const ADMIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

export const ADMIN_SESSION_COOKIE = '__Host-fp_admin';
/** 8 h absolutas, sem renovacao (D-H102-4). */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
/** Validade do convite: 72 h, uso unico (D-H102-3). */
export const ADMIN_INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Aprovacao de dupla validade: 24 h (54 §1). */
export const ADMIN_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
/** Codigos TOTP errados por convite antes de invalidar (54 §2). */
export const ADMIN_INVITE_MAX_CODE_ATTEMPTS = 5;

export function adminReply(
  status: number,
  body: Readonly<Record<string, unknown>>,
  extra?: { readonly setCookie?: string },
): AdminResponse {
  return extra?.setCookie !== undefined
    ? { status, body, headers: ADMIN_HEADERS, setCookie: extra.setCookie }
    : { status, body, headers: ADMIN_HEADERS };
}

/** Rota inexistente, sem sessao, sessao vencida ou revogada, conta sem papel: a mesma resposta. */
export const ADMIN_NOT_FOUND: AdminResponse = adminReply(404, { code: 'not_found' });
/** Convite inexistente, vencido, usado ou invalidado: mesmo 400 byte a byte, sem Set-Cookie. */
export const ADMIN_INVITE_INVALID: AdminResponse = adminReply(400, { code: 'convite_invalido' });
/** Login: e-mail inexistente, nao-admin, pendente, sem papel, senha ou codigo errados. */
export const ADMIN_CREDENTIALS_INVALID: AdminResponse = adminReply(401, {
  code: 'credenciais_invalidas',
});
export const ADMIN_PERMISSION_DENIED: AdminResponse = adminReply(403, { code: 'permission_denied' });
export const ADMIN_ORIGIN_INVALID: AdminResponse = adminReply(403, { code: 'origem_invalida' });
export const ADMIN_RATE_LIMITED: AdminResponse = adminReply(429, { code: 'muitas_tentativas' });
