// H-031 (Issue 44) | Montagem da rota de publicacao a partir do ambiente (docs/factory/110-DESENHO-H031.md, §7; D-12).
// Liga com os itens fixos presentes: papel app_system (DATABASE_URL_APP_SYSTEM), SITE_URL, chave de hash do endereco
// (ADDRESS_HASH_KEY, com tamanho minimo) e a chave dos baldes e do token (REQUEST_PUBLISH_HMAC_KEY, >= 32).
// Provedor real (Mapbox, permanente): liga so com MAPBOX_ACCESS_TOKEN, APP_ENV de desenvolvimento e VERCEL_ENV
// ausente ou development (decisao 239, Rodada 66 do quadro). Em preview, producao, ou sem a chave, a rota responde 503 (D-12).
// Nunca le, grava nem registra o valor das variaveis: so o nome aparece nas pendencias.
import { createHmac } from 'node:crypto';
import { PgGeoPointStore, PgRequestPublishStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { parseBreakerCaps } from '@fastpro/domain';
import { createDraftHasher } from '../drafts/draft-hash.js';
import { createAddressHasher } from '../geo/address-hash.js';
import { MAPBOX_TOKEN_ENV } from '../geo/composicao-sugestao.js';
import { createMapboxPermanentAdapter } from '../geo/mapbox-permanent-adapter.js';
import type { GeocodingPermanentPort } from '../geo/permanent-ports.js';
import type { PublishRouteOptions } from './publish-route.js';

/** APP_ENV em que o provedor real pode ligar (decisao 239: so desenvolvimento). Sem APP_ENV, nao liga. */
const AMBIENTES_COM_PROVEDOR_REAL: readonly string[] = ['development', 'dev', 'test'];

/** VERCEL_ENV em que o provedor real pode ligar: ausente (ambiente local) ou development. Preview e producao nunca ligam. */
const VERCEL_AMBIENTES_COM_PROVEDOR_REAL: readonly string[] = ['', 'development'];

/** Variaveis fixas exigidas (nomes). */
export const PUBLICACAO_PEDIDO_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'SITE_URL',
  'ADDRESS_HASH_KEY',
  'REQUEST_PUBLISH_HMAC_KEY',
] as const;

/** Tamanho minimo da chave HMAC da publicacao (decisao 254). */
export const REQUEST_PUBLISH_HMAC_KEY_MIN_LENGTH = 32;

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PublicacaoPedidoOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio da rota. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Provedor de geocodificacao permanente. Ausente = rota responde 503 (D-12, decisao 239). */
  readonly provedor?: GeocodingPermanentPort;
}

export interface PublicacaoPedidoMontagem {
  /** Opcoes da rota, ou undefined quando faltar qualquer item fixo. */
  readonly options: PublishRouteOptions | undefined;
  /** Nomes (nunca valores) e itens que impedem a rota de ligar ou de publicar. */
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

/**
 * Provedor real da Mapbox para a publicacao: so com a chave no ambiente, APP_ENV de desenvolvimento e
 * VERCEL_ENV ausente ou development. Fora disso (preview, producao, ambiente desconhecido ou chave ausente)
 * devolve undefined e a rota segue 503.
 */
function provedorMapboxDesenvolvimento(env: Ambiente): GeocodingPermanentPort | undefined {
  const ambiente = (env.APP_ENV ?? '').trim().toLowerCase();
  if (!AMBIENTES_COM_PROVEDOR_REAL.includes(ambiente)) return undefined;
  const ambienteVercel = (env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (!VERCEL_AMBIENTES_COM_PROVEDOR_REAL.includes(ambienteVercel)) return undefined;
  const token = (env[MAPBOX_TOKEN_ENV] ?? '').trim();
  if (token === '') return undefined;
  return createMapboxPermanentAdapter({ token, fetchImpl: globalThis.fetch });
}

export function montarPublicacaoPedido(env: Ambiente, opcoes: PublicacaoPedidoOpcoes = {}): PublicacaoPedidoMontagem {
  const pendencias: string[] = PUBLICACAO_PEDIDO_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da publicacao (ainda nao montada na funcao)');
  const chave = env.REQUEST_PUBLISH_HMAC_KEY ?? '';
  if (preenchida(env, 'REQUEST_PUBLISH_HMAC_KEY') && chave.length < REQUEST_PUBLISH_HMAC_KEY_MIN_LENGTH) {
    pendencias.push('REQUEST_PUBLISH_HMAC_KEY (tamanho minimo)');
  }
  let hashEndereco: ((texto: string) => string) | undefined;
  if (preenchida(env, 'ADDRESS_HASH_KEY')) {
    try {
      hashEndereco = createAddressHasher(env.ADDRESS_HASH_KEY ?? '');
    } catch {
      pendencias.push('ADDRESS_HASH_KEY (tamanho minimo)');
    }
  }
  const url = env.DATABASE_URL_APP_SYSTEM;
  const siteUrl = env.SITE_URL;
  if (pendencias.length > 0 || !url || !siteUrl || hashEndereco === undefined || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }
  const provedor = opcoes.provedor ?? provedorMapboxDesenvolvimento(env);
  if (provedor === undefined) {
    pendencias.push(`${MAPBOX_TOKEN_ENV} com APP_ENV de desenvolvimento (provedor de geocodificacao, decisao 239)`);
  }

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  const geoStore = new PgGeoPointStore({ client: cliente, subjectKind: 'request', clock: () => relogio.nowMs() });
  const caps = parseBreakerCaps(env.MAPBOX_PERMANENT_SOFT_LIMIT, env.MAPBOX_PERMANENT_HARD_LIMIT);
  const servico =
    provedor === undefined
      ? undefined
      : {
          store: new PgRequestPublishStore(cliente),
          geo: {
            store: geoStore,
            provider: provedor,
            hashAddress: hashEndereco,
            caps,
            clock: () => relogio.nowMs(),
          },
          hasher: createDraftHasher(chave),
          chave,
          rateKey: (finalidade: string, identificador: string) =>
            createHmac('sha256', chave).update(`${finalidade}:${identificador}`, 'utf8').digest('hex'),
          clock: relogio,
        };
  return {
    options: {
      siteUrl,
      sessions: new PgSessionRepository(cliente),
      service: servico,
    },
    pendencias,
  };
}
