// Montagem da leitura do proprio arquivo: DATABASE_URL_APP_SYSTEM, SUPABASE_URL, IDENTITY_DOCS_READER_KEY e a fabrica
// do cliente SQL. Faltando algo, nada monta (404 uniforme).
import { PgIdentityDocStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { storageLeituraFinal } from '../verification/verification-composicao.js';
import type { OwnFileRouteOptions } from './own-file-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export function montarArquivoProprio(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient; readonly relogio?: { nowMs(): number } } = {},
): OwnFileRouteOptions | undefined {
  const banco = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const supabase = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const leitor = env.IDENTITY_DOCS_READER_KEY ?? '';
  if (!banco || !supabase || !leitor || opcoes.abrirCliente === undefined) return undefined;
  const cliente = opcoes.abrirCliente(banco);
  const clock = opcoes.relogio ?? { nowMs: () => Date.now() };
  return {
    sessions: new PgSessionRepository(cliente),
    lista: new PgIdentityDocStore(cliente, clock),
    storage: storageLeituraFinal(supabase, leitor),
    clock,
  };
}
