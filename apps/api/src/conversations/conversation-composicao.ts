// Ciclo central (2026-11-23) | Montagem das rotas de conversa a partir do ambiente: papel app_system
// (DATABASE_URL_APP_SYSTEM), SITE_URL e a fabrica do cliente SQL. Faltando algo, nada monta (404 uniforme).
import { PgConversationStore, PgProfessionalProfile, PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { MeRouteOptions } from './me-route.js';
import type { ConversationRouteOptions } from './conversation-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface ConversaOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: { nowMs(): number };
}

export function montarConversas(
  env: Ambiente,
  opcoes: ConversaOpcoes = {},
): { readonly options: ConversationRouteOptions | undefined; readonly pendencias: readonly string[] } {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (site === '') pendencias.push('SITE_URL');
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL das conversas (ainda nao montada na funcao)');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const cliente = opcoes.abrirCliente(url);
  return {
    options: {
      siteUrl: site,
      sessions: new PgSessionRepository(cliente),
      store: new PgConversationStore(cliente),
      clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    },
    pendencias: [],
  };
}

/** GET /v1/auth/me: mesmas condicoes das conversas (banco app_system e fabrica do cliente). */
export function montarQuemSou(env: Ambiente, opcoes: ConversaOpcoes = {}): MeRouteOptions | undefined {
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  if (url === '' || opcoes.abrirCliente === undefined) return undefined;
  const cliente = opcoes.abrirCliente(url);
  const perfil = new PgProfessionalProfile({ client: cliente });
  return {
    sessions: new PgSessionRepository(cliente),
    profissional: { existe: async (userId) => (await perfil.find(userId)) !== null },
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    renovar: async (hash, nowMs) => {
      const r = await cliente.query('select * from private.app_session_refresh($1, $2::timestamptz)', [hash, new Date(nowMs).toISOString()]);
      const linha = r.rows[0] ?? {};
      const fim = linha.out_absolute_expires_at;
      const fimMs = fim instanceof Date ? fim.getTime() : typeof fim === 'string' ? Date.parse(fim) : null;
      return { renovada: linha.out_renovada === true, fimMs };
    },
  };
}
