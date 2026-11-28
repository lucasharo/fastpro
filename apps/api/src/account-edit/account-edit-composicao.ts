// Montagem dos dados editaveis do profissional: mesmas variaveis da galeria (faltando algo, 404).
import { PgProfessionalAccountEditStore, type SqlClient } from '@fastpro/db';
import { montarGaleria } from '../modules/media/gallery-composicao.js';
import type { AccountEditRouteOptions } from './account-edit-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export function montarEdicaoDaConta(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient; readonly relogio?: { nowMs(): number } } = {},
): AccountEditRouteOptions | undefined {
  const galeria = montarGaleria(env, opcoes);
  if (galeria === undefined || opcoes.abrirCliente === undefined) return undefined;
  const { siteUrl, sessions, storage, preparar, clock } = galeria;
  const store = new PgProfessionalAccountEditStore(opcoes.abrirCliente((env.DATABASE_URL_APP_SYSTEM ?? '').trim()));
  return { siteUrl, sessions, storage, preparar, clock, store };
}
