// Issue 45 (H-032) | Montagem das rotas de leitura do pedido a partir do ambiente (docs/factory/127-DESENHO-H032.md, §3, §7).
// Liga so com os itens fixos: DATABASE_URL_APP_SYSTEM (papel app_system, mesma fabrica da publicacao), ADDRESS_ENC_KEY
// (cofre de endereco, minimo de 32 caracteres) e a fabrica do cliente SQL. Sem a chave, a rota nao e montada (404 uniforme).
// Nunca le, grava nem registra o valor da chave: a pendencia leva so o nome.
import { createHmac } from 'node:crypto';
import { PgCoverageStore, PgRequestVisibilityStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { createAddressVault, type AddressVault } from './address-crypto.js';
import type { CoverageReaderPort } from './detail-service.js';
import type { RequestDetailRouteOptions } from './detail-route.js';

const ADDRESS_ENC_KEY_NOME = 'ADDRESS_ENC_KEY';
const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface DetalhePedidoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface DetalhePedidoMontagem {
  /** Opcoes das rotas, ou undefined quando faltar qualquer item fixo. */
  readonly options: RequestDetailRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de leitura de ligar. */
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

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

export function montarDetalhePedido(env: Ambiente, opcoes: DetalhePedidoOpcoes = {}): DetalhePedidoMontagem {
  const pendencias: string[] = [];
  if (!preenchida(env, DATABASE_URL_NOME)) pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da leitura do pedido (ainda nao montada na funcao)');
  let cofre: AddressVault | undefined;
  if (!preenchida(env, ADDRESS_ENC_KEY_NOME)) {
    pendencias.push(ADDRESS_ENC_KEY_NOME);
  } else {
    try {
      cofre = createAddressVault(env.ADDRESS_ENC_KEY ?? '');
    } catch {
      pendencias.push(`${ADDRESS_ENC_KEY_NOME} (tamanho minimo)`);
    }
  }
  const url = env[DATABASE_URL_NOME];
  if (pendencias.length > 0 || url === undefined || cofre === undefined || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      service: {
        store: new PgRequestVisibilityStore(cliente),
        addressVault: cofre,
        clock: relogio,
        ...opcionalCobertura(env, cliente),
      },
    },
    pendencias,
  };
}

/**
 * Porta da cobertura do dono (Issue 37, H-024), sobre o mesmo papel app_system. Sem PEPPER_IP_HMAC o IP nao pode
 * virar chave (ADR-014): a porta fica ausente e o campo `cobertura` do pedido aberto sai null, sem consulta.
 */
/** Acrescenta a chave `cobertura` ao servico so quando a porta existe (sem pepper, a chave nao e montada). */
function opcionalCobertura(env: Ambiente, cliente: SqlClient): { readonly cobertura?: CoverageReaderPort } {
  const porta = coberturaDoDono(env, cliente);
  return porta === undefined ? {} : { cobertura: porta };
}

function coberturaDoDono(env: Ambiente, cliente: SqlClient): CoverageReaderPort | undefined {
  const pepper = (env.PEPPER_IP_HMAC ?? '').trim();
  if (pepper === '') return undefined;
  const loja = new PgCoverageStore(cliente);
  return {
    coverageFor: (entrada) => loja.coverageFor(entrada),
    ipKey: (ip) => createHmac('sha256', pepper).update(ip).digest('hex'),
  };
}
