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
import {
  PgAdminSessionRepository,
  PgOpsPurgeStore,
  PgRetentionAdmin,
  registerOpsPurgeHandlers,
  SupabaseStorageQuarentena,
  type JobRegistry,
} from '@fastpro/db';
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
import { abrirTransacaoSql, montarVerificacao } from './verification/index.js';
import type { AdminVerificationRouteOptions } from './admin-verification-route.js';
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
// Issue 54 (H-041) | Estado visivel e recurso do profissional (GET e POST /v1/professional/verificacao).
import { montarVerificacaoProfissional } from './professional-verification-composicao.js';
import type { ProfessionalVerificationRouteOptions } from './professional-verification-route.js';
// Issue 57 (H-044) | Ativacao do trial (POST /v1/billing/trial/activate).
import { montarAtivacaoTrial } from './professional-trial-composicao.js';
import type { ProfessionalTrialRouteOptions } from './professional-trial-route.js';
// H-036 | Servicos, base e raio do perfil profissional (/v1/professional/profile/services e /area).
import { montarOfertaProfissional } from './professional-offering-composicao.js';
import type { ProfessionalOfferingRouteOptions } from './professional-offering-route.js';
// E3 (Issue 141) | Midia: upload, quarentena e galeria (so liga com MEDIA_UPLOAD_ENABLED=1 e todos os itens; decisao 190).
import { montarMidia, portasGaleriaMidia } from './media/media-composicao.js';
import type { MediaRouteOptions } from './media/media-route.js';
import type { ReduceCounters } from './media/media-reduce-service.js';
import type { ReduceGate } from './media/reduce-gate.js';
import { montarDocumentosDoAmbiente } from './identity-docs/identity-doc-montagem.js';
import type { IdentityDocRouteOptions } from './identity-docs/identity-doc-route.js';
// H-031 (#44) | Publicacao do pedido (POST /v1/requests): so monta com as variaveis completas; sem provedor responde 503.
import { montarPublicacaoPedido } from './requests/publish-composicao.js';
import type { PublishRouteOptions } from './requests/publish-route.js';
// Issue 45 (H-032) | Leitura do pedido por papel: liga so com ADDRESS_ENC_KEY e a fabrica do papel app_system.
import { montarDetalhePedido } from './requests/detail-composicao.js';
import type { RequestDetailRouteOptions } from './requests/detail-route.js';
// Issue 120 (H-111) | Rotas do titular para direitos: liga so com DATABASE_URL_APP_SYSTEM e a fabrica do cliente SQL.
import { montarPrivacidadeTitular } from './privacy/privacy-composicao.js';
import type { PrivacyTitularRouteOptions } from './privacy/titular-route.js';
// Issue 120 (H-111) | Painel do DPO sobre direitos do titular: liga so com DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL.
import { montarPrivacidadeDpo } from './privacy/dpo-composicao.js';
import type { PrivacyDpoRouteOptions } from './privacy/dpo-route.js';
// Issue 47 (H-034) | Lista do painel do cliente (GET /v1/requests): so monta com DATABASE_URL_APP_SYSTEM.
import { montarListaPedidos } from './requests/list-composicao.js';
import type { RequestListRouteOptions } from './requests/list-route.js';
// Issue 68 (H-055) | Descoberta do profissional: so monta com DATABASE_URL_APP_SYSTEM e DISCOVERY_CURSOR_KEY.
import { montarDescoberta } from './requests/discovery-composicao.js';
import type { DiscoveryRouteOptions } from './requests/discovery-route.js';
// Issue 46 (H-033) | Telefone e consentimento de contato: so monta com DATABASE_URL_APP_SYSTEM, SITE_URL e PHONE_ENC_KEY.
import { montarContato } from './contact/contact-composicao.js';
import type { ContactRouteOptions } from './contact/contact-route.js';
// Issue 56 (H-043) | Perfil publico por slug (GET /v1/public/professionals/:slug): so liga com DATABASE_URL_APP_SYSTEM.
import { montarPerfilPublicoRota } from './public-profile/public-profile-composicao.js';
import type { PublicProfileRouteOptions } from './public-profile-route.js';

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
  /** Fabrica do cliente SQL do papel app_system para os documentos de identidade (H-037). Sem ela, as rotas nao ligam (404). */
  readonly abrirClienteSistema?: (connectionString: string) => SqlClient;
  /** Portas da confirmacao recente (step-up, H-073): provedor de login e limites. Hoje sem adaptador. */
  readonly confirmacaoAdmin?: AdminConfirmacaoOpcoes;
  /** fetch do provedor de login admin (Supabase Auth). Padrao: o global. */
  readonly fetchAuth?: typeof fetch;
  /** Fabrica das portas do rascunho sem conta (H-025) sobre o papel app_api. Sem ela, as rotas nao ligam (404). */
  readonly fabricaRascunho?: DraftPortsFactory;
  /** Fabrica do cliente SQL do papel app_api, memoizada por URL na borda (compartilhada com o rascunho). */
  readonly abrirClienteApi?: (connectionString: string) => SqlClient;
  /** Limite de reducoes e contadores da instancia da midia (singletons de modulo na borda). */
  readonly reducaoMidia?: { readonly gate: ReduceGate; readonly contadores: ReduceCounters };
}

export interface Integracoes {
  /** Opcoes da busca de servico (H-019), ou undefined (404). */
  readonly catalog: CatalogRouteOptions | undefined;
  /** Provedor de e-mail (Resend). Construido, nunca usado para envio pela composicao. */
  readonly email: EmailProviderPort | undefined;
  /** Rotas do caso de acesso a conversa (H-073), ou undefined (404). */
  readonly accessCase: AdminAccessCaseRouteOptions | undefined;
  /** Rotas da fila de verificacao (H-039), ou undefined (404). */
  readonly verification: AdminVerificationRouteOptions | undefined;
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
  /** Issue 54 (H-041): estado visivel e recurso do profissional, ou undefined (404). */
  readonly professionalVerification?: ProfessionalVerificationRouteOptions;
  readonly professionalTrial: ProfessionalTrialRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas do perfil profissional (H-035) de ligar. */
  readonly pendenciasPerfil: readonly string[];
  /** Rotas de servicos, base e raio do perfil profissional (H-036), ou undefined (404). */
  readonly professionalOffering: ProfessionalOfferingRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de servicos, base e raio (H-036) de ligar. */
  readonly pendenciasOferta: readonly string[];
  /** Opcoes das rotas de midia (E3: upload e galeria), ou undefined (404). */
  readonly media: MediaRouteOptions | undefined;
  /** Nomes (nunca valores) e itens que impedem a midia ou a galeria de ligar. */
  readonly pendenciasMidia: readonly string[];
  /** Opcoes das rotas dos documentos de identidade (H-037), ou undefined (404). */
  readonly identityDocs: IdentityDocRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem os documentos de identidade de ligar (H-037). */
  readonly pendenciasDocumentos: readonly string[];
  /** Opcoes da rota de publicacao do pedido (H-031), ou undefined (404). */
  readonly requestPublish: PublishRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a publicacao do pedido de ligar (H-031). */
  readonly pendenciasPublicacao: readonly string[];
  /** Opcoes das rotas de leitura do pedido (H-032: dono e profissional), ou undefined (404). */
  /** Issue 47 (H-034): opcoes da lista do dono (GET /v1/requests), ou undefined (404). */
  readonly requestList: RequestListRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a lista do dono de ligar (H-034). */
  readonly pendenciasLista: readonly string[];
  readonly requestDetail: RequestDetailRouteOptions | undefined;
  /** Issue 120 (H-111): rotas do titular para direitos, ou undefined (404 uniforme). */
  readonly privacyTitular?: PrivacyTitularRouteOptions;
  /** Nomes (nunca valores) que impedem as rotas do titular para direitos de ligar (H-111). */
  readonly pendenciasPrivacidade?: readonly string[];
  /** Issue 120 (H-111): painel do DPO, ou undefined (404 vazio). */
  readonly privacyDpo?: PrivacyDpoRouteOptions;
  /** Nomes (nunca valores) que impedem o painel do DPO de ligar (H-111). */
  readonly pendenciasPrivacidadeDpo?: readonly string[];
  /** Nomes (nunca valores) que impedem as rotas de leitura do pedido de ligar (H-032). */
  readonly pendenciasDetalhe: readonly string[];
  /** Issue 68 (H-055): opcoes da descoberta do profissional (GET /v1/professional/discovery/requests), ou undefined (404). */
  readonly requestDiscovery: DiscoveryRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem a descoberta do profissional de ligar (H-055). */
  readonly pendenciasDescoberta: readonly string[];
  /** Issue 46 (H-033): rotas de telefone e consentimento, ou undefined (404). */
  readonly requestContact: ContactRouteOptions | undefined;
  /** Issue 56 (H-043): leitura publica do perfil por slug, ou undefined (404). */
  readonly publicProfile: PublicProfileRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de contato de ligar. */
  readonly pendenciasContato: readonly string[];
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
  // H-039: so com as variaveis de VERIFICACAO_ENV_OBRIGATORIAS e a fabrica da borda (sem elas, 404).
  const verification = montarVerificacao(env, {
    abrirCliente: opcoes.abrirClienteSql,
    abrirTransacao: abrirTransacaoSql,
  });
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
  // Issue 54 (H-041): estado visivel e recurso (mesmo cliente app_system; sem opcoes, rotas em 404).
  const verificacao = montarVerificacaoProfissional(env, { abrirCliente: opcoes.abrirClienteSql, relogio: opcoes.clock });
  const trial = montarAtivacaoTrial(env, { abrirCliente: opcoes.abrirClienteSql, relogio: opcoes.clock });

  // H-036: servicos, base e raio. Sem o provedor permanente (BLQ-EXEC, decisao 116) as rotas seguem 404.
  const oferta = montarOfertaProfissional(env, { abrirCliente: opcoes.abrirClienteSql, relogio: opcoes.clock });

  // H-031 (#44): publicacao do pedido sobre o papel app_system; sem chave, banco ou provedor, a rota nao liga (404; 503 sem provedor).
  const publicacao = montarPublicacaoPedido(env, { abrirCliente: opcoes.abrirClienteSistema });

  // Issue 45 (H-032): leitura do pedido (dono e profissional). Sem ADDRESS_ENC_KEY ou banco, as rotas nao ligam (404).
  const detalhe = montarDetalhePedido(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });
  // Issue 120 (H-111): direitos do titular sobre o papel app_system; sem banco ou fabrica, as rotas nao ligam (404).
  const privacidade = montarPrivacidadeTitular(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });
  // Issue 120 (H-111): painel do DPO; sem banco app_system ou ADMIN_BASE_URL, as rotas nao ligam (404 vazio).
  const privacidadeDpo = montarPrivacidadeDpo(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });
  // Issue 47 (H-034) | Lista do dono: so DATABASE_URL_APP_SYSTEM (sem chave de endereco e sem provedor de mapas).
  const lista = montarListaPedidos(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });
  // Issue 68 (H-055) | Descoberta do profissional: so DATABASE_URL_APP_SYSTEM e DISCOVERY_CURSOR_KEY (32+ caracteres).
  const descoberta = montarDescoberta(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });

  // Issue 46 (H-033): telefone e consentimento. Sem PHONE_ENC_KEY valida, as rotas nao ligam (404).
  const contato = montarContato(env, { abrirCliente: opcoes.abrirClienteSistema, relogio: opcoes.clock });

  // E3: midia. Liga so com MEDIA_UPLOAD_ENABLED=1 e os itens completos (decisao 190); sem isso, 404.
  // A galeria (H-029) entra junto, pelas portas montadas na borda; sem a midia ligada, ela tambem fica 404.
  const galeriaMidia = portasGaleriaMidia(env, opcoes.abrirClienteApi);
  const midia = montarMidia(env, {
    abrirCliente: opcoes.abrirClienteApi,
    reducao: opcoes.reducaoMidia,
    ...(galeriaMidia !== undefined ? { galeria: galeriaMidia } : {}),
  });

  // Issue 56 (H-043): perfil publico; liga so com DATABASE_URL_APP_SYSTEM e a fabrica do papel app_system.
  const perfilPublico = montarPerfilPublicoRota(env, { abrirCliente: opcoes.abrirClienteSql });

  // H-037 (#50): documentos de identidade; fechados por trava (sem pendencias) ou incompletos (com nomes).
  const documentos = montarDocumentosDoAmbiente(env, {
    abrirCliente: opcoes.abrirClienteSistema,
    gate: opcoes.reducaoMidia?.gate,
  });

  return {
    catalog,
    email,
    accessCase,
    verification,
    adminStepUp,
    adminOps,
    drafts,
    professionalProfile: perfil.options,
    professionalVerification: verificacao,
    professionalTrial: trial.options,
    pendencias,
    pendenciasCaso,
    pendenciasRascunho,
    pendenciasPerfil: perfil.pendencias,
    professionalOffering: oferta.options,
    pendenciasOferta: oferta.pendencias,
    media: midia.options,
    pendenciasMidia: midia.pendencias,
    identityDocs: documentos.options,
    pendenciasDocumentos: documentos.pendencias,
    requestPublish: publicacao.options,
    pendenciasPublicacao: publicacao.pendencias,
    requestList: lista.options,
    pendenciasLista: lista.pendencias,
    requestDetail: detalhe.options,
    pendenciasDetalhe: detalhe.pendencias,
    privacyTitular: privacidade.options,
    pendenciasPrivacidade: privacidade.pendencias,
    privacyDpo: privacidadeDpo.options,
    pendenciasPrivacidadeDpo: privacidadeDpo.pendencias,
    requestDiscovery: descoberta.options,
    pendenciasDescoberta: descoberta.pendencias,
    requestContact: contato.options,
    publicProfile: perfilPublico,
    pendenciasContato: contato.pendencias,
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

// H-110 (Issue 119) | Expurgo operacional (job ops.purge, docs/factory/105-DESENHO-H110.md §8). Monta o registro do
// handler so com DATABASE_URL_APP_SYSTEM, SUPABASE_URL, a chave do Storage, a fabrica do cliente SQL da borda e o
// caminho do objeto da quarentena (formato da Issue 141, G-3). A chave do Storage NAO e' lida aqui: a regra de segredos
// so permite o nome do servico em modulos de midia e identidade (decisao 152), entao quem monta a passa pronta.
// Montar nao abre conexao: cliente e Storage nascem dentro de registrar(). Ainda NAO ligado ao tick: a API nao tem
// executor de jobs (vercel.ts nao passa a opcao), entao nada roda em producao por esta funcao. Nomes de variaveis e
// de portas aparecem nas pendencias; valores nunca.
export const EXPURGO_ENV_OBRIGATORIAS = ['DATABASE_URL_APP_SYSTEM', 'SUPABASE_URL'] as const;

export interface ExpurgoOperacionalOpcoes {
  /** Fabrica do cliente SQL do papel app_system (memoizada por URL na borda). Sem ela, o registro nao existe. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Caminho do objeto de uma foto na quarentena (formato definido pela Issue 141). Sem ele, o registro nao existe. */
  readonly caminhoDoObjeto?: (assetId: string) => string;
  /** Chave de servico do Storage (lida pelo modulo de midia, nunca aqui). Sem ela, o registro nao existe. */
  readonly chaveDoStorage?: string;
  /** fetch do Storage. Padrao: o global. */
  readonly fetchImpl?: typeof fetch;
  /** Relogio do job. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface ExpurgoOperacional {
  /** Registra o handler ops.purge num JobRegistry do tick; undefined enquanto faltar alguma porta. */
  readonly registrar: ((registry: JobRegistry) => void) | undefined;
  /** Nomes (nunca valores) e portas que impedem o registro. */
  readonly pendencias: readonly string[];
}

/** Rotulo fixo do cliente do expurgo: a chave do Map nunca e a connection string (achado 3 do Code Review). */
const ROTULO_CLIENTE_EXPURGO = 'expurgo:app_system';

/** Um cliente por montagem (mapa proprio), reaproveitado nos registros; o rotulo e fixo, a URL so abre a conexao. */
function clienteDoExpurgo(clientes: Map<string, SqlClient>, abrir: (connectionString: string) => SqlClient, url: string): SqlClient {
  let cliente = clientes.get(ROTULO_CLIENTE_EXPURGO);
  if (cliente === undefined) {
    cliente = abrir(url);
    clientes.set(ROTULO_CLIENTE_EXPURGO, cliente);
  }
  return cliente;
}

export function montarExpurgoOperacional(env: ComposicaoEnv, opcoes: ExpurgoOperacionalOpcoes = {}): ExpurgoOperacional {
  const pendencias: string[] = EXPURGO_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  const abrir = opcoes.abrirCliente;
  const caminho = opcoes.caminhoDoObjeto;
  const chave = opcoes.chaveDoStorage ?? '';
  if (abrir === undefined) pendencias.push('fabrica do cliente SQL do expurgo (ainda nao montada na funcao)');
  if (caminho === undefined) pendencias.push('caminho do objeto da quarentena (formato da Issue 141, ainda nao definido)');
  if (chave.trim() === '') pendencias.push('chave do Storage da quarentena (lida pelo modulo de midia, decisao 152)');
  if (pendencias.length > 0 || abrir === undefined || caminho === undefined) return { registrar: undefined, pendencias };

  const url = env.DATABASE_URL_APP_SYSTEM ?? '';
  const baseUrl = env.SUPABASE_URL ?? '';
  const relogio = opcoes.relogio ?? RELOGIO_PADRAO;
  const fetchImpl = opcoes.fetchImpl;
  const clientes = new Map<string, SqlClient>();
  return {
    pendencias: [],
    registrar: (registry) => {
      registerOpsPurgeHandlers(registry, {
        store: new PgOpsPurgeStore(clienteDoExpurgo(clientes, abrir, url)),
        arquivos: new SupabaseStorageQuarentena({ baseUrl, serviceKey: chave, ...(fetchImpl ? { fetchImpl } : {}) }),
        caminhoDoObjeto: caminho,
        now: () => relogio.nowMs(),
      });
    },
  };
}
