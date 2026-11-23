// H-037 (Issue #50, fase 2) | Montagem real dos documentos de identidade a partir do ambiente (107-DESENHO-H037 §9 e §10).
// Sem interruptor: so monta com TODOS os itens (faltando algum, sem opcoes e a borda responde 404 uniforme): papel app_system
// (DATABASE_URL_APP_SYSTEM), Storage (SUPABASE_URL e SUPABASE_SECRET_KEY), chave do IP com tamanho minimo
// (DRAFT_IP_HMAC_KEY), SITE_URL valida, fabrica do cliente SQL, reducao compartilhada com a midia (ReduceGate).
// Pendencias saem so com NOMES de variaveis ou nomes de itens, nunca com valores. Construir nao consulta banco nem Storage.
import { createHmac } from 'node:crypto';
import {
  PgIdentityDocProfile,
  PgIdentityDocRateLimit,
  PgIdentityDocStore,
  PgSessionRepository,
  SupabaseIdentityDocFinalStorage,
  SupabaseIdentityDocStagingStorage,
  type SqlClient,
} from '@fastpro/db';
import { siteOriginOf, type ImageReducerPort } from '@fastpro/domain';
import { DRAFT_IP_KEY_MIN_LENGTH } from '../drafts/draft-hash.js';
import { SharpImageReducer } from '../media/image-reducer-sharp.js';
import type { IdentityDocRouteOptions } from './identity-doc-route.js';
import type { IdentityDocReduceGate, IdentityDocServiceDeps } from './identity-doc-service.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface IdentityDocMontagemOpcoes {
  /** Fabrica do cliente SQL do papel app_system, memoizada por URL na borda. Sem ela, nada monta. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Limite de reducoes simultaneas da instancia (o mesmo da midia, para somar fotos e documentos). */
  readonly gate?: IdentityDocReduceGate;
  /** Redutor de imagem. Padrao: redutor com sharp (o mesmo da midia, sem alteracao). */
  readonly reducer?: ImageReducerPort;
  /** fetch do Storage. Padrao: o global. */
  readonly fetchImpl?: typeof fetch;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface IdentityDocMontagem {
  /** Opcoes da rota, ou undefined quando incompleta (a borda responde 404 uniforme). */
  readonly options: IdentityDocRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a montagem. Vazio quando montada. */
  readonly pendencias: readonly string[];
}

/** Nomes que faltam ou estao invalidos para os documentos (nunca valores). */
export function pendenciasDocumentos(env: Ambiente, opcoes: IdentityDocMontagemOpcoes = {}): string[] {
  const faltam: string[] = [];
  for (const nome of ['DATABASE_URL_APP_SYSTEM', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const) {
    if ((env[nome] ?? '').trim() === '') faltam.push(nome);
  }
  const chave = env.DRAFT_IP_HMAC_KEY ?? '';
  if (chave === '') faltam.push('DRAFT_IP_HMAC_KEY');
  else if (chave.length < DRAFT_IP_KEY_MIN_LENGTH) faltam.push('DRAFT_IP_HMAC_KEY (curta)');
  try {
    siteOriginOf(env.SITE_URL ?? '');
  } catch {
    faltam.push('SITE_URL (invalida)');
  }
  if (opcoes.abrirCliente === undefined) faltam.push('fabrica do cliente SQL dos documentos (ainda nao montada na funcao)');
  if (opcoes.gate === undefined) faltam.push('limite de reducoes dos documentos (ainda nao montado na funcao)');
  return faltam;
}

/**
 * Ponto de montagem dos documentos. Incompleta devolve as pendencias com nomes; completa devolve as opcoes das rotas.
 */
export function montarDocumentosDoAmbiente(env: Ambiente, opcoes: IdentityDocMontagemOpcoes = {}): IdentityDocMontagem {
  const faltam = pendenciasDocumentos(env, opcoes);
  if (faltam.length > 0 || opcoes.abrirCliente === undefined || opcoes.gate === undefined) {
    return { options: undefined, pendencias: faltam };
  }

  const cliente = opcoes.abrirCliente(env.DATABASE_URL_APP_SYSTEM ?? '');
  const baseUrl = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SECRET_KEY ?? '';
  const fetchImpl = opcoes.fetchImpl;
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const chaveIp = env.DRAFT_IP_HMAC_KEY ?? '';

  const deps: IdentityDocServiceDeps = {
    store: new PgIdentityDocStore(cliente, relogio),
    staging: new SupabaseIdentityDocStagingStorage({ baseUrl, serviceKey, ...(fetchImpl ? { fetchImpl } : {}) }),
    final: new SupabaseIdentityDocFinalStorage({ baseUrl, serviceKey, ...(fetchImpl ? { fetchImpl } : {}) }),
    reducer: opcoes.reducer ?? new SharpImageReducer(),
    gate: opcoes.gate,
    rate: new PgIdentityDocRateLimit(cliente, relogio),
    ipHmac: (ip: string) => createHmac('sha256', chaveIp).update(ip, 'utf8').digest('hex'),
    clock: relogio,
  };

  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      perfis: new PgIdentityDocProfile(cliente),
      deps,
      siteUrl: siteOriginOf(env.SITE_URL ?? ''),
    },
    pendencias: [],
  };
}
