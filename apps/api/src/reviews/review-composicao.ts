// Pacote B (2026-11-23) | Montagem das rotas de avaliacao a partir do ambiente: papel app_system
// (DATABASE_URL_APP_SYSTEM), SITE_URL e a fabrica do cliente SQL. Faltando algo, nada monta (404 uniforme).
// O limite da rota publica e unico por processo: a montagem roda a cada chamada, e o contador precisa sobreviver a ela.
import { PgReviewStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { criarLimiteMemoria } from '../public-profile-route.js';
import type { ReviewRouteOptions } from './review-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface AvaliacoesOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: { nowMs(): number };
}

const limiteDoProcesso = criarLimiteMemoria();

export function montarAvaliacoes(
  env: Ambiente,
  opcoes: AvaliacoesOpcoes = {},
): { readonly options: ReviewRouteOptions | undefined; readonly pendencias: readonly string[] } {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (site === '') pendencias.push('SITE_URL');
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL das avaliacoes (ainda nao montada na funcao)');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const cliente = opcoes.abrirCliente(url);
  return {
    options: {
      siteUrl: site,
      sessions: new PgSessionRepository(cliente),
      store: new PgReviewStore(cliente),
      clock: opcoes.relogio ?? { nowMs: () => Date.now() },
      limitePublico: limiteDoProcesso,
    },
    pendencias: [],
  };
}
