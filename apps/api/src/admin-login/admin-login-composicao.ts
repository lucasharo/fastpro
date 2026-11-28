// Montagem da entrada do admin por e-mail e senha e do console. Banco app_system e ADMIN_BASE_URL; o login exige
// tambem PEPPER_EMAIL_HMAC e PEPPER_IP_HMAC (limite de tentativas). Faltando algo, a rota nao existe (404).
import { challengeHmacHex, PgAdminLoginAttempts, PgAdminPasswordAccounts, type SqlClient } from '@fastpro/db';
import type { AdminModerationRouteOptions } from './admin-moderation-route.js';
import type { AdminPasswordRouteOptions } from './admin-password-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

const RELOGIO = { nowMs: () => Date.now() };

export function montarEntradaAdmin(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient } = {},
): AdminPasswordRouteOptions | undefined {
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const adminUrl = (env.ADMIN_BASE_URL ?? '').trim();
  const pepperEmail = (env.PEPPER_EMAIL_HMAC ?? '').trim();
  const pepperIp = (env.PEPPER_IP_HMAC ?? '').trim();
  if (url === '' || adminUrl === '' || pepperEmail === '' || pepperIp === '' || opcoes.abrirCliente === undefined) {
    return undefined;
  }
  const cliente = opcoes.abrirCliente(url);
  return {
    adminUrl,
    clock: RELOGIO,
    accounts: new PgAdminPasswordAccounts(cliente),
    limits: new PgAdminLoginAttempts(cliente, {
      email: (email) => challengeHmacHex(pepperEmail, `admin-login-email:${email}`),
      ip: (ip) => challengeHmacHex(pepperIp, `admin-login-ip:${ip}`),
    }),
    log: () => undefined,
    revogar: async (secretHash, nowMs) => {
      await cliente.query('select private.admin_session_revoke($1, $2::timestamptz)', [
        secretHash,
        new Date(nowMs).toISOString(),
      ]);
    },
  };
}

/** Console admin (moderacao, auditoria recente e equipe): banco app_system e ADMIN_BASE_URL. */
export function montarModeracaoAdmin(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient } = {},
): AdminModerationRouteOptions | undefined {
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const adminUrl = (env.ADMIN_BASE_URL ?? '').trim();
  if (url === '' || adminUrl === '' || opcoes.abrirCliente === undefined) return undefined;
  return { adminUrl, client: opcoes.abrirCliente(url), clock: RELOGIO };
}
