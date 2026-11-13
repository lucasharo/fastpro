// H-037 (Issue #50, fase 2) | Montagem real dos documentos de identidade a partir do ambiente (107-DESENHO-H037 §9 e §10).
// Trava 1: IDENTITY_DOCS_ENABLED com o valor exato 1 (ausente = fechado). Trava 2: com VERCEL_ENV=production, tambem
// IDENTITY_DOCS_L1_PARECER=1 (dado C3 sem prazo; so depois do parecer L1). Fechado = sem opcoes (a borda responde 404
// uniforme, zero chamadas a banco ou Storage). Com a trava aberta, so monta com TODOS os itens: papel app_system
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

export const IDOC_LIBERACAO_ENV = 'IDENTITY_DOCS_ENABLED' as const;
export const IDOC_LIBERACAO_VALOR = '1' as const;
export const IDOC_PARECER_ENV = 'IDENTITY_DOCS_L1_PARECER' as const;

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
  /** Opcoes da rota, ou undefined quando fechada ou incompleta (a borda responde 404 uniforme). */
  readonly options: IdentityDocRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a montagem. Vazio quando fechada por trava ou montada. */
  readonly pendencias: readonly string[];
}

/** Nomes que faltam ou estao invalidos para os documentos (nunca valores). */
export function pendenciasDocumentos(env: Ambiente, opcoes: IdentityDocMontagemOpcoes = {}): string[] {
  const faltam: string[] = [];
  if (env.VERCEL_ENV === 'production' && env[IDOC_PARECER_ENV] !== IDOC_LIBERACAO_VALOR) faltam.push(IDOC_PARECER_ENV);
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
 * Ponto de montagem dos documentos. Fechada por trava devolve options undefined sem pendencias (404 uniforme).
 * Aberta e incompleta devolve as pendencias com nomes. Aberta e completa devolve as opcoes das rotas.
 */
export function montarDocumentosDoAmbiente(env: Ambiente, opcoes: IdentityDocMontagemOpcoes = {}): IdentityDocMontagem {
  if (env[IDOC_LIBERACAO_ENV] !== IDOC_LIBERACAO_VALOR) return { options: undefined, pendencias: [] };
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
