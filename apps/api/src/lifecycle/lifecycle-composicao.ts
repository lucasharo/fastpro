// Pacote A (H-061, H-077, H-078, H-080) | Montagem das rotas de ciclo a partir do ambiente: papel app_system
// (DATABASE_URL_APP_SYSTEM), SITE_URL e a fabrica do cliente SQL. Faltando algo, nada monta (404 uniforme).
import { PgRequestLifecycleStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { LifecycleRouteOptions } from './lifecycle-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface LifecycleOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: { nowMs(): number };
}

export function montarLifecycle(
  env: Ambiente,
  opcoes: LifecycleOpcoes = {},
): { readonly options: LifecycleRouteOptions | undefined; readonly pendencias: readonly string[] } {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (site === '') pendencias.push('SITE_URL');
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL do ciclo (ainda nao montada na funcao)');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const cliente = opcoes.abrirCliente(url);
  return {
    options: {
      siteUrl: site,
      sessions: new PgSessionRepository(cliente),
      store: new PgRequestLifecycleStore(cliente),
      clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    },
    pendencias: [],
  };
}
