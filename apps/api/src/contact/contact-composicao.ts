// Issue 46 (H-033) | Montagem das rotas de contato a partir do ambiente (docs/factory/129-DESENHO-H033.md, §3, §5, §11).
// Liga so com os itens fixos: DATABASE_URL_APP_SYSTEM (papel app_system), SITE_URL (origem das mutacoes) e
// PHONE_ENC_KEY (cofre do telefone, minimo de 32 caracteres, chave propria, nao a do endereco).
// Sem a chave, as rotas nao sao montadas (404 uniforme). Nunca le, grava nem registra o valor da chave: a pendencia
// leva so o nome. Sem Mapbox, sem servico externo.
import { PgContactStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { createPhoneVault, type PhoneVault } from './phone-crypto.js';
import type { ContactRouteOptions } from './contact-route.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';
const SITE_URL_NOME = 'SITE_URL';
const PHONE_ENC_KEY_NOME = 'PHONE_ENC_KEY';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface ContatoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface ContatoMontagem {
  /** Opcoes das rotas, ou undefined quando faltar qualquer item fixo. */
  readonly options: ContactRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de contato de ligar. */
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

/** Cofre do telefone a partir do ambiente, ou undefined com a chave ausente ou curta (sem detalhe do valor). */
export function cofreDoTelefone(env: Ambiente): PhoneVault | undefined {
  if (!preenchida(env, PHONE_ENC_KEY_NOME)) return undefined;
  try {
    return createPhoneVault(env[PHONE_ENC_KEY_NOME] ?? '');
  } catch {
    return undefined;
  }
}

export function montarContato(env: Ambiente, opcoes: ContatoOpcoes = {}): ContatoMontagem {
  const pendencias: string[] = [];
  if (!preenchida(env, DATABASE_URL_NOME)) pendencias.push(DATABASE_URL_NOME);
  if (!preenchida(env, SITE_URL_NOME)) pendencias.push(SITE_URL_NOME);
  let cofre: PhoneVault | undefined;
  if (!preenchida(env, PHONE_ENC_KEY_NOME)) {
    pendencias.push(PHONE_ENC_KEY_NOME);
  } else {
    cofre = cofreDoTelefone(env);
    if (cofre === undefined) pendencias.push(`${PHONE_ENC_KEY_NOME} (tamanho minimo)`);
  }
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL do contato (ainda nao montada na funcao)');
  const url = env[DATABASE_URL_NOME];
  const siteUrl = env[SITE_URL_NOME];
  if (pendencias.length > 0 || url === undefined || siteUrl === undefined || cofre === undefined || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    options: {
      siteUrl,
      sessions: new PgSessionRepository(cliente),
      service: {
        store: new PgContactStore(cliente),
        vault: cofre,
        clock: relogio,
      },
    },
    pendencias,
  };
}
