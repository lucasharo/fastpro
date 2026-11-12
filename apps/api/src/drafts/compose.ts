// H-025 | Montagem do rascunho sem conta na composicao (docs/factory/74-DESENHO-H025.md, §1, §2; R1, R3).
// Liga as rotas /v1/drafts SO se as tres variaveis existirem com valor: URL do papel app_api, chave HMAC
// propria do IP (>= 32 caracteres) e SITE_URL. Qualquer falta, ou ausencia da fabrica do pool, devolve
// undefined: as rotas continuam inexistentes (404). Nenhum valor e registrado; so os nomes sao citados.
import { PgDraftRate, PgDraftStore, type SqlClient } from '@fastpro/db';
import type { DraftRatePort, DraftStorePort } from '@fastpro/domain';
import { createDraftHasher, DRAFT_IP_KEY_MIN_LENGTH, newDraftSecret } from './draft-hash.js';
import type { DraftClockPort } from './draft-service.js';
import type { DraftRouteOptions } from './draft-route.js';

/** Papel app_api (menor privilegio): so executa as funcoes private.draft_* e private.rl_*. */
export const DRAFT_DATABASE_URL_ENV = 'DATABASE_URL_APP_API' as const;
/** Chave propria do HMAC do IP do rascunho (nunca reutiliza PEPPER_* nem a chave da busca). */
export const DRAFT_IP_KEY_ENV = 'DRAFT_IP_HMAC_KEY' as const;
/** Origem do site: a unica aceita em Origin (mesmo nome da busca e da composicao). */
export const DRAFT_SITE_URL_ENV = 'SITE_URL' as const;

export type DraftEnv = Readonly<Record<string, string | undefined>>;

/** Fabrica das portas do rascunho sobre um pool injetado. Em producao, usa o SqlClient real. */
export interface DraftPortsFactory {
  criar(databaseUrl: string): { readonly store: DraftStorePort; readonly rate: DraftRatePort };
}

const RELOGIO_RASCUNHO: DraftClockPort = { nowMs: () => Date.now() };

/** Nomes (nunca valores) que faltam para o rascunho ligar. Chave curta aparece marcada, sem tamanho. */
export function faltantesRascunho(env: DraftEnv): string[] {
  const faltam: string[] = [];
  if (!(env[DRAFT_DATABASE_URL_ENV] ?? '').trim()) faltam.push(DRAFT_DATABASE_URL_ENV);
  const chave = env[DRAFT_IP_KEY_ENV] ?? '';
  if (!chave.trim()) faltam.push(DRAFT_IP_KEY_ENV);
  else if (chave.length < DRAFT_IP_KEY_MIN_LENGTH) faltam.push(`${DRAFT_IP_KEY_ENV} (curta)`);
  if (!(env[DRAFT_SITE_URL_ENV] ?? '').trim()) faltam.push(DRAFT_SITE_URL_ENV);
  return faltam;
}

/**
 * Opcoes das rotas do rascunho, ou undefined (404). So liga com as tres variaveis completas, a chave
 * com tamanho minimo e uma fabrica de portas. Sem fabrica, nunca liga.
 */
export function montarRascunho(
  env: DraftEnv,
  fabrica: DraftPortsFactory | undefined,
  relogio: DraftClockPort = RELOGIO_RASCUNHO,
): DraftRouteOptions | undefined {
  if (faltantesRascunho(env).length > 0 || fabrica === undefined) return undefined;
  const databaseUrl = env[DRAFT_DATABASE_URL_ENV] ?? '';
  const ipKey = env[DRAFT_IP_KEY_ENV] ?? '';
  const siteUrl = env[DRAFT_SITE_URL_ENV] ?? '';
  const { store, rate } = fabrica.criar(databaseUrl);
  return {
    deps: {
      store,
      rate,
      hasher: createDraftHasher(ipKey),
      newSecret: newDraftSecret,
      clock: relogio,
    },
    siteUrl,
  };
}

/**
 * Fabrica real sobre um cliente SQL do papel app_api. O cliente e aberto uma vez por URL (memoizado),
 * para cada pedido nao abrir pool novo. Criar as portas nao consulta o banco.
 */
export function criarFabricaRascunho(abrirCliente: (connectionString: string) => SqlClient): DraftPortsFactory {
  const clientes = new Map<string, SqlClient>();
  return {
    criar(databaseUrl) {
      let cliente = clientes.get(databaseUrl);
      if (cliente === undefined) {
        cliente = abrirCliente(databaseUrl);
        clientes.set(databaseUrl, cliente);
      }
      return { store: new PgDraftStore(cliente), rate: new PgDraftRate(cliente) };
    },
  };
}
