// Ciclo central (2026-11-23) | Montagem das rotas de conversa a partir do ambiente: papel app_system
// (DATABASE_URL_APP_SYSTEM), SITE_URL e a fabrica do cliente SQL. Faltando algo, nada monta (404 uniforme).
import { PgConversationStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
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
