// Montagem do push. Rotas: DATABASE_URL_APP_SYSTEM, SITE_URL e a fabrica do cliente SQL (faltando algo, 404).
// Web Push liga so com o par VAPID completo e o assunto; Android e iOS nao dependem de chave no servidor.
import { PgPushStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { PushRouteOptions } from './push-route.js';
import type { ChavesVapid } from './web-push.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export function chavesVapid(env: Ambiente): ChavesVapid | undefined {
  const publica = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const privada = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const assunto = (env.VAPID_SUBJECT ?? '').trim();
  if (!publica || !privada || !/^(mailto:|https:\/\/)/.test(assunto)) return undefined;
  return { publica, privada, assunto };
}

export function montarPush(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient; readonly relogio?: { nowMs(): number } } = {},
): PushRouteOptions | undefined {
  const banco = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (!banco || !site || opcoes.abrirCliente === undefined) return undefined;
  const cliente = opcoes.abrirCliente(banco);
  return {
    siteUrl: site,
    webPublicKey: chavesVapid(env)?.publica ?? null,
    sessions: new PgSessionRepository(cliente),
    store: new PgPushStore(cliente),
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}
