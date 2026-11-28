// Issue 47 (H-034) | Montagem da lista do painel a partir do ambiente (docs/factory/133-DESENHO-H034.md, §6.1, D-07).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system) e a fabrica do cliente SQL, decidida na borda.
// NAO exige ADDRESS_ENC_KEY: a lista nao decifra endereco. Nunca le, grava nem registra o valor da conexao.
import { PgRequestListStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { RequestListRouteOptions } from './list-route.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface ListaPedidosOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface ListaPedidosMontagem {
  /** Opcoes da rota, ou undefined quando faltar algum item fixo. */
  readonly options: RequestListRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a lista de ligar. */
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

export function montarListaPedidos(env: Ambiente, opcoes: ListaPedidosOpcoes = {}): ListaPedidosMontagem {
  const pendencias: string[] = [];
  const url = (env[DATABASE_URL_NOME] ?? '').trim();
  if (url === '') pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da lista (ainda nao montada na funcao)');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };

  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = opcoes.abrirCliente(url);
    clientes.set(url, cliente);
  }
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      service: { store: new PgRequestListStore(cliente), clock: relogio },
    },
    pendencias,
  };
}
