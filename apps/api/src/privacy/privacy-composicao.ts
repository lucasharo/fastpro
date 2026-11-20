// Issue 120 (H-111) | Montagem das rotas do titular a partir do ambiente (147-DESENHO-H111 §3, §5.1).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system) e a fabrica do cliente SQL. Sem eles, a rota nao e montada
// (404 uniforme). Nunca le, grava nem registra o valor da URL: a pendencia leva so o nome.
import { PgSessionRepository, type SqlClient } from '@fastpro/db';
import type { PrivacyTitularRouteOptions } from './titular-route.js';
import { PgDsrTitularSql, ServicoDsrTitular } from './titular-service.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PrivacidadeTitularOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface PrivacidadeTitularMontagem {
  readonly options: PrivacyTitularRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de ligar. */
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

function clienteDe(url: string, abrirCliente: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrirCliente(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

export function montarPrivacidadeTitular(
  env: Ambiente,
  opcoes: PrivacidadeTitularOpcoes = {},
): PrivacidadeTitularMontagem {
  const pendencias: string[] = [];
  const url = (env[DATABASE_URL_NOME] ?? '').trim();
  if (url === '') pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) {
    pendencias.push('fabrica do cliente SQL das rotas do titular (ainda nao montada na funcao)');
  }
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      service: new ServicoDsrTitular(new PgDsrTitularSql(cliente)),
      relogio,
    },
    pendencias,
  };
}
