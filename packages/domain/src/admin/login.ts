// Login da conta admin por e-mail e senha (decisao do dono, 2026-11-27; substitui o codigo no e-mail e o desenho
// de senha + TOTP do H-102). Toda falha (e-mail inexistente, nao-admin, desativado, sem papel, sem senha ou senha
// errada) devolve o MESMO 401 credenciais_invalidas. Limite excedido = 429 antes de conferir a senha.
// O cookie __Host-fp_admin nao tem Domain e carrega so o segredo opaco.

import { ADMIN_PASSWORD_MAX, normalizeAdminEmail } from './policy.js';
import type { AdminLogger, AdminLoginAttempts, AdminPasswordAccounts } from './ports.js';
import {
  ADMIN_CREDENTIALS_INVALID,
  ADMIN_RATE_LIMITED,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminReply,
  type AdminResponse,
} from './responses.js';

export interface AdminLoginDeps {
  readonly accounts: AdminPasswordAccounts;
  readonly limits: AdminLoginAttempts;
  readonly log: AdminLogger;
}

export interface AdminLoginRequest {
  readonly email: unknown;
  readonly password: unknown;
  readonly ip: string;
}

/** Cabecalho Set-Cookie da sessao admin. Valor so com o segredo opaco (base64url de 43 caracteres). */
export function adminSessionCookieHeader(secret: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error('segredo de sessao admin com formato invalido');
  }
  return [
    `${ADMIN_SESSION_COOKIE}=${secret}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`,
  ].join('; ');
}

export async function loginAdmin(
  req: AdminLoginRequest,
  deps: AdminLoginDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const email = normalizeAdminEmail(req.email);
  const key = { email: email ?? '', ip: req.ip };

  // A vaga e consumida antes da conferencia (pedidos simultaneos nao furam o teto) e devolvida no acerto.
  if (!(await deps.limits.reserve(key, nowMs))) {
    deps.log({ evento: 'login_admin', resultado: 'bloqueado', motivo: 'limite' });
    return ADMIN_RATE_LIMITED;
  }

  const fail = (motivo: string): AdminResponse => {
    deps.log({ evento: 'login_admin', resultado: 'recusado', motivo });
    return ADMIN_CREDENTIALS_INVALID;
  };

  const password = req.password;
  if (email === null || typeof password !== 'string' || password === '' || password.length > ADMIN_PASSWORD_MAX) {
    return fail('entrada');
  }

  const conta = await deps.accounts.verify(email, password);
  if (conta === null) return fail('credencial');

  const session = await deps.accounts.openSession(conta.userId, nowMs);
  if (session === null) return fail('sem_conta_ativa');

  await deps.limits.release(key, nowMs);
  deps.log({ evento: 'login_admin', resultado: 'ok' });
  return adminReply(
    200,
    { autenticado: true, expira_em: nowMs + ADMIN_SESSION_MAX_AGE_SECONDS * 1000 },
    { setCookie: adminSessionCookieHeader(session.secret) },
  );
}
