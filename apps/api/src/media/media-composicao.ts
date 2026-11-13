// E3 (Issue 141) | Montagem das rotas de midia (upload, quarentena, reducao e galeria) a partir do ambiente.
// So liga com MEDIA_UPLOAD_ENABLED com o valor exato 1 (decisao 190; ausente = fechada em todos os ambientes) e
// com TODOS os itens presentes: papel app_api (DATABASE_URL_APP_API), chave do IP do rascunho (DRAFT_IP_HMAC_KEY,
// com tamanho minimo), SITE_URL, SUPABASE_URL e SUPABASE_SECRET_KEY, e a fabrica do cliente SQL da borda.
// Nunca le, grava nem registra valores: so os nomes aparecem nas pendencias (a chave curta vai marcada).
// A galeria (decisao 191) so monta com as portas injetadas em opcoes; sem elas, a pendencia da galeria fica
// visivel e as rotas da galeria seguem 404 uniforme. Nunca usa DATABASE_URL_APP_SYSTEM.
import {
  PgDraftRate,
  PgMediaGallery,
  PgMediaStore,
  SupabaseMediaReduceStorage,
  SupabaseQuarantineStorage,
  SupabaseReducedPhotoReader,
  type SqlClient,
} from '@fastpro/db';
import { siteOriginOf, type DraftRatePort, type MediaStorePort, type QuarantineStoragePort } from '@fastpro/domain';
import { faltantesRascunho } from '../drafts/compose.js';
import { createDraftHasher } from '../drafts/draft-hash.js';
import type { GalleryDeps } from './media-gallery-service.js';
import type { MediaRouteOptions } from './media-route.js';
import type { MediaDeps } from './media-service.js';
import { ReduceCounters, type ReduceDeps } from './media-reduce-service.js';
import { SharpImageReducer } from './image-reducer-sharp.js';
import { ReduceGate } from './reduce-gate.js';

/** Liberacao explicita da midia (decisao 190): so o valor exato liga. */
export const MEDIA_LIBERACAO_ENV = 'MEDIA_UPLOAD_ENABLED' as const;
export const MEDIA_LIBERACAO_VALOR = '1' as const;
/** Nomes do Storage que a midia reaproveita do ambiente (mesmos do restante da API). */
export const MEDIA_ENV_STORAGE = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const;
/** Pendencias fixas (sem valor). */
export const MEDIA_FABRICA_PENDENCIA = 'fabrica do cliente SQL da midia (ainda nao montada na funcao)';
export const MEDIA_GALERIA_PENDENCIA = 'portas da galeria (ainda nao montadas na funcao)';

type Ambiente = Readonly<Record<string, string | undefined>>;

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Nomes (nunca valores) que faltam para a midia ligar. Reusa a regra do rascunho (mesmo papel e mesma chave). */
export function faltantesMidia(env: Ambiente): string[] {
  const faltam = faltantesRascunho(env);
  for (const nome of MEDIA_ENV_STORAGE) {
    if (!preenchida(env, nome)) faltam.push(nome);
  }
  return faltam;
}

/** Portas da galeria que a composicao ainda nao monta sozinha (adaptadores ficam na borda ou em teste). */
export type MediaGaleriaPortas = Pick<GalleryDeps, 'gallery' | 'reader' | 'contador'>;

/** Portas substitutas (somente testes): ausentes = adaptadores reais sobre o cliente do papel app_api. */
export interface MediaPortasSubstitutas {
  readonly store?: MediaStorePort;
  readonly rate?: DraftRatePort;
  readonly storage?: QuarantineStoragePort;
  readonly reduceStorage?: ReduceDeps['storage'];
}

export interface MediaOpcoes {
  /** Fabrica do cliente SQL do papel app_api, ja memoizada por URL na borda. Sem ela, nada monta. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** fetch do Storage. Padrao: o global. */
  readonly fetchImpl?: typeof fetch;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Redutor da foto. Padrao: redutor com sharp (carregado sob demanda). */
  readonly reducer?: ReduceDeps['reducer'];
  /** Limite de reducoes simultaneas e contadores da instancia (criados uma vez no modulo da borda). */
  readonly reducao?: { readonly gate: ReduceGate; readonly contadores: ReduceCounters };
  /** Portas da galeria (H-029). Omissao = pendencia e rotas da galeria em 404; o upload segue ligado. */
  readonly galeria?: MediaGaleriaPortas;
  /** Substitutas das portas de banco e Storage (testes). */
  readonly portas?: MediaPortasSubstitutas;
}

export interface MediaMontagem {
  /** Opcoes das rotas de midia, ou undefined quando algum item faltar (nada monta). */
  readonly options: MediaRouteOptions | undefined;
  /** Nomes (nunca valores) e itens que impedem a midia ou a galeria de ligar. */
  readonly pendencias: readonly string[];
}

/**
 * Ponto de montagem da midia. Funcao sobre o ambiente recebido: nao abre conexao, nao faz I/O e nao registra
 * valores. Construir os adaptadores nao consulta o banco nem o Storage.
 */
/** Pendencias (so nomes, nunca valores) que mantem a midia fechada: liberacao, itens e SITE_URL valida. */
export function pendenciasDaMidia(env: Ambiente): string[] {
  const pendencias: string[] = [];
  if (env[MEDIA_LIBERACAO_ENV] !== MEDIA_LIBERACAO_VALOR) {
    pendencias.push(`${MEDIA_LIBERACAO_ENV} (liberacao explicita)`);
  }
  pendencias.push(...faltantesMidia(env));
  if (pendencias.length === 0) {
    try {
      siteOriginOf(env.SITE_URL ?? '');
    } catch {
      pendencias.push('SITE_URL (invalida)');
    }
  }
  return pendencias;
}

/** Ambiente do Storage da midia (mesmos nomes da quarentena e da reducao). So o construtor recebe a chave. */
function storageDaMidia(env: Ambiente, fetchImpl: typeof fetch | undefined) {
  return {
    baseUrl: (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
    serviceKey: env.SUPABASE_SECRET_KEY ?? '',
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  };
}

/**
 * Portas da galeria (H-029) para a borda: galeria do dono sobre o papel app_api e leitor do bucket reduzido.
 * Undefined enquanto a midia nao liga (liberacao, item ou SITE_URL): a galeria segue 404 uniforme.
 * Nao consulta banco nem Storage; so constroi os adaptadores sobre o cliente memoizado da borda.
 */
export function portasGaleriaMidia(
  env: Ambiente,
  abrirCliente: ((connectionString: string) => SqlClient) | undefined,
  fetchImpl?: typeof fetch,
): MediaGaleriaPortas | undefined {
  if (abrirCliente === undefined || pendenciasDaMidia(env).length > 0) return undefined;
  const cliente = abrirCliente(env.DATABASE_URL_APP_API ?? '');
  return {
    gallery: new PgMediaGallery(cliente),
    reader: new SupabaseReducedPhotoReader(storageDaMidia(env, fetchImpl)),
  };
}

export function montarMidia(env: Ambiente, opcoes: MediaOpcoes = {}): MediaMontagem {
  const pendencias = pendenciasDaMidia(env);
  if (pendencias.length > 0) return { options: undefined, pendencias };
  if (opcoes.abrirCliente === undefined) return { options: undefined, pendencias: [MEDIA_FABRICA_PENDENCIA] };

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = opcoes.abrirCliente(env.DATABASE_URL_APP_API ?? '');
  const storage = storageDaMidia(env, opcoes.fetchImpl);
  const store = opcoes.portas?.store ?? new PgMediaStore(cliente);
  const reduceStorage = opcoes.portas?.reduceStorage ?? new SupabaseMediaReduceStorage(storage);
  const reducao = opcoes.reducao ?? { gate: new ReduceGate(), contadores: new ReduceCounters() };
  const deps: MediaDeps = {
    store,
    storage: opcoes.portas?.storage ?? new SupabaseQuarantineStorage(storage),
    rate: opcoes.portas?.rate ?? new PgDraftRate(cliente),
    hasher: createDraftHasher(env.DRAFT_IP_HMAC_KEY ?? ''),
    clock: relogio,
    reduce: {
      store,
      storage: reduceStorage,
      reducer: opcoes.reducer ?? new SharpImageReducer(),
      gate: reducao.gate,
      contadores: reducao.contadores,
    },
  };
  const siteUrl = (env.SITE_URL ?? '').trim();
  if (opcoes.galeria === undefined) {
    return { options: { deps, siteUrl }, pendencias: [MEDIA_GALERIA_PENDENCIA] };
  }
  const galeria: GalleryDeps = {
    ...opcoes.galeria,
    storage: reduceStorage,
    store,
    rate: deps.rate,
    hasher: deps.hasher,
    clock: relogio,
  };
  return { options: { deps, siteUrl, galeria }, pendencias: [] };
}
