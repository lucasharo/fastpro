// Montagem da entrada do admin por codigo: banco app_system, ADMIN_BASE_URL e o provedor de e-mail (o mesmo do
// codigo do cliente; em DEV o envio e redirecionado para a conta de teste). Faltando algo, a rota nao existe (404).
import { createHash } from 'node:crypto';
import type { SqlClient } from '@fastpro/db';
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import { createAuthAwareRenderer, createEmailProvider, createFetchHttpTransport, createMinimalRenderer } from '@fastpro/email';
import type { AdminCodeRouteOptions } from './admin-code-route.js';
import type { AdminModerationRouteOptions } from './admin-moderation-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

const RELOGIO: ClockPort = {
  nowMs: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export function montarEntradaAdmin(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient } = {},
): AdminCodeRouteOptions | undefined {
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const adminUrl = (env.ADMIN_BASE_URL ?? '').trim();
  if (url === '' || adminUrl === '' || opcoes.abrirCliente === undefined) return undefined;
  let provider: EmailProviderPort;
  try {
    provider = createEmailProvider(env, {
      http: createFetchHttpTransport(),
      renderer: createAuthAwareRenderer(createMinimalRenderer()),
      clock: RELOGIO,
    });
  } catch {
    return undefined;
  }
  const cliente = opcoes.abrirCliente(url);
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    adminUrl,
    clock: RELOGIO,
    emitir: async (email, codeHash, nowMs) => {
      const r = await cliente.query('select private.admin_code_issue($1, $2, $3::timestamptz) as u', [email, codeHash, iso(nowMs)]);
      return typeof r.rows[0]?.u === 'string';
    },
    enviar: async (email, code) => {
      await provider.send({
        to: email,
        templateKey: 'acesso_login',
        params: { code, minutos: 10 },
        idempotencyKey: createHash('sha256').update(`admin-login|${email}|${code}`).digest('hex'),
      });
    },
    conferir: async (i) => {
      const r = await cliente.query('select private.admin_code_verify($1, $2, $3::uuid, $4, $5::timestamptz) as r', [
        i.email,
        i.codeHash,
        i.sessionId,
        i.secretHash,
        iso(i.nowMs),
      ]);
      const v = String(r.rows[0]?.r ?? 'invalido');
      return v === 'ok' || v === 'bloqueado' ? v : 'invalido';
    },
    revogar: async (secretHash, nowMs) => {
      await cliente.query('select private.admin_session_revoke($1, $2::timestamptz)', [secretHash, iso(nowMs)]);
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
