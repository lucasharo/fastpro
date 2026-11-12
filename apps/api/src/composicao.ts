// H-009/H-019/H-093 | Ponto de montagem das integracoes da funcao da API. Le o ambiente (um objeto de nomes e
// valores, nunca registrado) e devolve as dependencias que estao completas. Qualquer falta deixa a parte
// undefined: a rota correspondente continua inexistente (404) e a pendencia vai so com o NOME da variavel.
// Nao ha interruptor de envio: o e-mail so existe com o provedor montado; o destinatario fica preso a
// conta cadastrada pelo adaptador (RESEND_ACCOUNT_RECIPIENT).
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createFetchHttpTransport,
  createMinimalRenderer,
  EmailConfigError,
} from '@fastpro/email';
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import type { SqlClient } from '@fastpro/db';
import { PgAdminSessionRepository, PgRetentionAdmin } from '@fastpro/db';
import {
  montarAdministracaoCaso,
  montarPainelOperacional,
  montarConfirmacaoAdmin,
  ADMIN_CASO_ENV_OBRIGATORIAS,
  ADMIN_AUTH_ENV_OBRIGATORIAS,
  ADMIN_LIMITES_ENV_OBRIGATORIAS,
  montarAuthAdmin,
  montarLimitesAdmin,
  type AdminConfirmacaoOpcoes,
} from './admin-composicao.js';
import type { AdminAccessCaseRouteOptions } from './admin-access-case-route.js';
import type { AdminStepUpRouteOptions } from './admin-step-up-route.js';
import type { AdminOpsRouteOptions } from './admin-ops-route.js';
import type { AdminRetentionRouteOptions } from './admin-retention-route.js';
import {
  CATALOG_DATABASE_URL_ENV,
  CATALOG_RATE_KEY_ENV,
  CATALOG_RATE_KEY_MIN_LENGTH,
  CATALOG_SITE_URL_ENV,
  montarCatalogo,
  type CatalogPortsFactory,
  type CatalogEnv,
} from './catalog/compose.js';
import type { CatalogRouteOptions } from './catalog/catalog-route.js';
import { faltantesRascunho, montarRascunho, type DraftPortsFactory } from './drafts/compose.js';
import type { DraftRouteOptions } from './drafts/draft-route.js';
// H-035 | Cadastro do documento do perfil profissional (PUT/GET /v1/professional/profile).
import { montarPerfilProfissional } from './professional-profile-composicao.js';
import type { ProfessionalProfileRouteOptions } from './professional-profile-route.js';

/** Nomes da busca que faltam (so nomes; a chave curta aparece marcada, sem tamanho nem valor). */
function faltantesCatalogo(env: CatalogEnv): readonly string[] {
  const faltam: string[] = [];
  if (!env[CATALOG_DATABASE_URL_ENV]) faltam.push(CATALOG_DATABASE_URL_ENV);
  const chave = env[CATALOG_RATE_KEY_ENV];
  if (!chave) faltam.push(CATALOG_RATE_KEY_ENV);
  else if (chave.length < CATALOG_RATE_KEY_MIN_LENGTH) faltam.push(`${CATALOG_RATE_KEY_ENV} (curta)`);
  if (!env[CATALOG_SITE_URL_ENV]) faltam.push(CATALOG_SITE_URL_ENV);
  return faltam;
}

/** Variaveis exigidas pelo provedor de e-mail (RESEND_VERIFIED_DOMAIN nao e exigido: sem dominio). */
export const EMAIL_ENV_OBRIGATORIAS = [
  'APP_ENV',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'RESEND_ACCOUNT_RECIPIENT',
] as const;

export type ComposicaoEnv = CatalogEnv;

export interface ComposicaoOpcoes {
  /** Fabrica de portas da busca sobre o pool real. Sem ela a busca nao liga (ver fabrica-pg.ts). */
  readonly fabricaCatalogo?: CatalogPortsFactory;
  /** Relogio do provedor de e-mail. Padrao: relogio do sistema. */
  readonly clock?: ClockPort;
  /** Fabrica do cliente SQL do papel app_system (H-073). Sem ela, as rotas do caso nao ligam (404). */
  readonly abrirClienteSql?: (connectionString: string) => SqlClient;
  /** Portas da confirmacao recente (step-up, H-073): provedor de login e limites. Hoje sem adaptador. */
  readonly confirmacaoAdmin?: AdminConfirmacaoOpcoes;
  /** fetch do provedor de login admin (Supabase Auth). Padrao: o global. */
  readonly fetchAuth?: typeof fetch;
  /** Fabrica das portas do rascunho sem conta (H-025) sobre o papel app_api. Sem ela, as rotas nao ligam (404). */
  readonly fabricaRascunho?: DraftPortsFactory;
}

export interface Integracoes {
  /** Opcoes da busca de servico (H-019), ou undefined (404). */
  readonly catalog: CatalogRouteOptions | undefined;
  /** Provedor de e-mail (Resend). Construido, nunca usado para envio pela composicao. */
  readonly email: EmailProviderPort | undefined;
  /** Rotas do caso de acesso a conversa (H-073), ou undefined (404). */
  readonly accessCase: AdminAccessCaseRouteOptions | undefined;
  /** Confirmacao recente do segundo fator (POST /v1/admin/session/step-up), ou undefined (404). */
  readonly adminStepUp: AdminStepUpRouteOptions | undefined;
  /** Painel operacional (H-108, GET /v1/admin/ops/panel), ou undefined (404). */
  readonly adminOps: AdminOpsRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem cada integracao de ligar. */
  readonly pendencias: readonly string[];
  /** Nomes (nunca valores) que impedem as rotas do caso de acesso (H-073) de ligar. */
  readonly pendenciasCaso: readonly string[];
  /** Opcoes das rotas do rascunho sem conta (H-025), ou undefined (404). */
  readonly drafts: DraftRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas do rascunho sem conta (H-025) de ligar. */
  readonly pendenciasRascunho: readonly string[];
  /** Rotas do documento do perfil profissional (H-035), ou undefined (404). */
  readonly professionalProfile: ProfessionalProfileRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas do perfil profissional (H-035) de ligar. */
  readonly pendenciasPerfil: readonly string[];
}

const RELOGIO_PADRAO: ClockPort = {
  nowMs: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

function preenchida(env: ComposicaoEnv, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Monta o e-mail so com as variaveis completas. Configuracao invalida vira pendencia, sem detalhe. */
function montarEmail(
  env: ComposicaoEnv,
  relogio: ClockPort,
): { readonly email: EmailProviderPort | undefined; readonly pendencias: readonly string[] } {
  const faltam = EMAIL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (faltam.length > 0) return { email: undefined, pendencias: faltam };
  try {
    const email = createEmailProvider(env, {
      http: createFetchHttpTransport(),
      renderer: createAuthAwareRenderer(createMinimalRenderer()),
      clock: relogio,
    });
    return { email, pendencias: [] };
  } catch (erro) {
    if (erro instanceof EmailConfigError) {
      return { email: undefined, pendencias: ['EMAIL (configuracao recusada pelo adaptador)'] };
    }
    throw erro;
  }
}

/**
 * Ponto de montagem. Funcao pura sobre o ambiente recebido: nao abre conexao, nao envia nada e nao
 * registra valores. Sem fabrica de pool, a busca nao liga mesmo com as variaveis completas.
 */
export function montarIntegracoes(env: ComposicaoEnv, opcoes: ComposicaoOpcoes = {}): Integracoes {
  const pendencias: string[] = [];

  const catalogFaltantes = faltantesCatalogo(env);
  pendencias.push(...catalogFaltantes);
  if (catalogFaltantes.length === 0 && opcoes.fabricaCatalogo === undefined) {
    pendencias.push('fabrica do pool da busca (ainda nao montada na funcao)');
  }
  const catalog = montarCatalogo(env, opcoes.fabricaCatalogo);

  const { email, pendencias: pendenciasEmail } = montarEmail(env, opcoes.clock ?? RELOGIO_PADRAO);
  pendencias.push(...pendenciasEmail);

  // H-073: so com os nomes ADMIN_CASO_ENV_OBRIGATORIAS presentes e a fabrica SQL da borda.
  const pendenciasCaso: string[] = ADMIN_CASO_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (pendenciasCaso.length === 0 && opcoes.abrirClienteSql === undefined) {
    pendenciasCaso.push('fabrica do cliente SQL do caso de acesso (ainda nao montada na funcao)');
  }
  const accessCase = montarAdministracaoCaso(env, { abrirCliente: opcoes.abrirClienteSql });
  // H-108: so com DATABASE_URL_APP_SYSTEM e a fabrica da borda (sem eles, o painel segue 404).
  const adminOps = montarPainelOperacional(env, { abrirCliente: opcoes.abrirClienteSql });

  // H-073 (60 §4): confirmacao recente. Provedor (Supabase Auth) e limites (Pg) montados pela propria
  // composicao quando os nomes existem; as portas injetadas em opcoes tem precedencia (testes).
  const confirmacao = opcoes.confirmacaoAdmin ?? {};
  const auth = confirmacao.auth ?? montarAuthAdmin(env, opcoes.fetchAuth);
  const limits = confirmacao.limits ?? montarLimitesAdmin(env, opcoes.abrirClienteSql);
  const adminStepUp = montarConfirmacaoAdmin(env, {
    abrirCliente: opcoes.abrirClienteSql,
    auth,
    limits,
    log: confirmacao.log ?? (() => undefined),
    relogio: confirmacao.relogio,
  });
  if (adminStepUp === undefined) {
    // Nomes (nunca valores) que faltam para a confirmacao recente ligar.
    const faltantes = [
      ...(auth === undefined ? ADMIN_AUTH_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome)) : []),
      ...(limits === undefined ? ADMIN_LIMITES_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome)) : []),
    ];
    pendenciasCaso.push(...faltantes);
  }

  // H-025: rascunho sem conta. Pendencias proprias (so nomes), separadas das da busca e do caso.
  const pendenciasRascunho = faltantesRascunho(env);
  if (pendenciasRascunho.length === 0 && opcoes.fabricaRascunho === undefined) {
    pendenciasRascunho.push('fabrica do pool do rascunho (ainda nao montada na funcao)');
  }
  const drafts = montarRascunho(env, opcoes.fabricaRascunho);

  // H-035: perfil profissional. Pendencias proprias (so nomes), separadas das demais integracoes.
  const perfil = montarPerfilProfissional(env, { abrirCliente: opcoes.abrirClienteSql, relogio: opcoes.clock });

  return {
    catalog,
    email,
    accessCase,
    adminStepUp,
    adminOps,
    drafts,
    professionalProfile: perfil.options,
    pendencias,
    pendenciasCaso,
    pendenciasRascunho,
    pendenciasPerfil: perfil.pendencias,
  };
}

// H-109 | Rotas de retencao (cadastro de politica e hold). So monta com DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL;
// sem eles, a rota nao existe (404). Um cliente por URL, reaproveitado entre chamadas.
const clientesRetencao = new Map<string, SqlClient>();

export function montarRetencaoAdmin(
  env: Readonly<Partial<Record<'DATABASE_URL_APP_SYSTEM' | 'ADMIN_BASE_URL', string>>>,
  opcoes: {
    readonly abrirCliente?: (connectionString: string) => SqlClient;
    readonly relogio?: { nowMs(): number };
  } = {},
): AdminRetentionRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  if (!url || !baseUrl || opcoes.abrirCliente === undefined) return undefined;
  let cliente = clientesRetencao.get(url);
  if (cliente === undefined) {
    cliente = opcoes.abrirCliente(url);
    clientesRetencao.set(url, cliente);
  }
  const sessao = new PgAdminSessionRepository(cliente);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    port: new PgRetentionAdmin(cliente),
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}
