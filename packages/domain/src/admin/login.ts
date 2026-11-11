// H-102 | Login da conta admin (docs/factory/54-DESENHO-H102.md §3; CA-H102-05/06/07/08). Um unico pedido:
// senha + TOTP. Toda falha (e-mail inexistente, nao-admin, pendente, sem papel, senha ou codigo) devolve o
// MESMO 401 credenciais_invalidas. Limite excedido = 429 antes de qualquer tentativa.
// O cookie __Host-fp_admin nao tem Domain e carrega so o segredo opaco (sem dado do provedor).

import { adminLoginBlocked, normalizeAdminEmail } from './policy.js';
import type { AdminAuthPort, AdminLogger, AdminLoginLimits, AdminRepository } from './ports.js';
import {
  ADMIN_CREDENTIALS_INVALID,
  ADMIN_RATE_LIMITED,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminReply,
  type AdminResponse,
} from './responses.js';

export interface AdminLoginDeps {
  readonly repo: AdminRepository;
  readonly auth: AdminAuthPort;
  readonly limits: AdminLoginLimits;
  readonly log: AdminLogger;
}

export interface AdminLoginRequest {
  readonly email: unknown;
  readonly password: unknown;
  readonly code: unknown;
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

  const counts = await deps.limits.counts(key, nowMs);
  if (adminLoginBlocked(counts)) {
    deps.log({ evento: 'login_admin', resultado: 'bloqueado', motivo: 'limite' });
    return ADMIN_RATE_LIMITED;
  }

  const fail = async (motivo: string): Promise<AdminResponse> => {
    await deps.limits.recordFailure(key, nowMs);
    deps.log({ evento: 'login_admin', resultado: 'recusado', motivo });
    return ADMIN_CREDENTIALS_INVALID;
  };

  if (email === null || typeof req.password !== 'string' || typeof req.code !== 'string') {
    return fail('entrada');
  }

  const auth = await deps.auth.signInWithPasswordAndTotp(email, req.password, req.code);
  if (auth === null) return fail('provedor');

  const staff = await deps.repo.findActiveStaff(auth.authUserId);
  if (staff === null || staff.roles.length === 0) return fail('sem_conta_ativa');

  const session = await deps.repo.openSession(staff.userId, nowMs);
  deps.log({ evento: 'login_admin', resultado: 'ok' });
  return adminReply(
    200,
    { autenticado: true, papeis: [...staff.roles], expira_em: nowMs + ADMIN_SESSION_MAX_AGE_SECONDS * 1000 },
    { setCookie: adminSessionCookieHeader(session.secret) },
  );
}
