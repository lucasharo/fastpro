// Issue 56 (H-043) | Montagem da leitura publica do perfil por slug a partir do ambiente. Liga so com
// DATABASE_URL_APP_SYSTEM e a fabrica de cliente SQL da borda (papel app_system). Sem qualquer um deles devolve
// undefined e a rota segue inexistente (404). Nunca le nem registra o valor da string de conexao.
// O limitador e unico por processo: a montagem roda a cada chamada, e o contador precisa sobreviver a ela.
import type { SqlClient } from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import { criarLimiteMemoria, type PublicProfileRouteOptions } from '../public-profile-route.js';
import { PgPublicProfileStore } from './pg-public-profile-store.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PerfilPublicoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
}

const limiteDoProcesso = criarLimiteMemoria();

/** Opcoes da rota publica do perfil, ou undefined quando faltar a conexao ou a fabrica. */
export function montarPerfilPublicoRota(
  env: Ambiente,
  opcoes: PerfilPublicoOpcoes = {},
): PublicProfileRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  if (url === undefined || url.trim() === '' || opcoes.abrirCliente === undefined) return undefined;
  const cliente = clienteDe(url, opcoes.abrirCliente);
  return { port: new PgPublicProfileStore(cliente), limite: limiteDoProcesso };
}
