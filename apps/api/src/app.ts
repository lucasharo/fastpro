// H-009 | Esqueleto da API da hospedagem (uma funcao, desenho 42 §1.1). Sem framework: node:http puro.
// Reaproveita so o nucleo de autenticacao do tick (H-008, @fastpro/db): segredo com pelo menos 32
// caracteres, comparacao em tempo constante e limite de 1 KB do corpo. Nao ha acesso ao banco aqui.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isTickAuthorized, TICK_BODY_LIMIT_BYTES, TICK_PATH } from '@fastpro/db';
import {
  ADDRESS_SUGGEST_PATH,
  ADMIN_ACCESS_CASES_PATH,
  ADMIN_AUDIT_QUERY_PATH,
  ADMIN_AUTH_SESSION_PATH,
  ADMIN_CONSOLE_MENU_PATH,
  ADMIN_OPS_PANEL_PATH,
  ADMIN_REFUND_APPROVALS_PATH,
  ADMIN_STEP_UP_PATH,
  ADMIN_SUSPENSION_APPROVALS_PATH,
  CATALOG_SEARCH_PATH,
  CONSUME_PATH,
  PROFESSIONAL_LOGIN_PATH,
  PROFESSIONAL_REGISTER_PATH,
  PROFESSIONAL_VERIFY_CONFIRM_PATH,
} from '@fastpro/domain';
import {
  handleAdminAccessCaseRoute,
  type AdminAccessCaseRouteOptions,
} from './admin-access-case-route.js';
import {
  VERIFICACAO_CASOS_PATH,
  handleAdminVerificationRoute,
  type AdminVerificationRouteOptions,
} from './admin-verification-route.js';
import { handleAdminStepUpRoute, type AdminStepUpRouteOptions } from './admin-step-up-route.js';
import { handleAdminAuditQuery, type AdminAuditRouteOptions } from './admin-audit-route.js';
import { handleAdminConsoleMenu, type AdminConsoleRouteOptions } from './admin-console-route.js';
import { handleAdminOpsPanel, type AdminOpsRouteOptions } from './admin-ops-route.js';
import {
  handleAdminRetentionRoute,
  RETENTION_BASE_PATH,
  type AdminRetentionRouteOptions,
} from './admin-retention-route.js';
import {
  handleAdminDualApprovalRoute,
  type AdminDualApprovalRouteOptions,
} from './admin-dual-approval-route.js';
import { handleAdminCatalogRoute, type AdminCatalogRouteOptions } from './admin-catalog-route.js';
import {
  handleAdminAuthSessionRoute,
  type AdminAuthSessionRouteOptions,
} from './admin-auth-session-route.js';
import { handleCatalogSearch, type CatalogRouteOptions } from './catalog/catalog-route.js';
import { handleConsume, type ConsumeRouteOptions } from './consume-route.js';
// H-097 (Issue 107) | Pedido de login por link ou codigo (POST /v1/auth/challenges).
import {
  CHALLENGE_REQUEST_PATH,
  handleChallengeRequest,
  type ChallengeRequestRouteOptions,
} from './challenge-request-route.js';
// H-097 (Issue 107) | Verificacao do codigo de 6 digitos (POST /v1/auth/challenges/verify, PROPOSTA).
import {
  CHALLENGE_VERIFY_PATH,
  handleChallengeVerify,
  type ChallengeVerifyRouteOptions,
} from './challenge-verify-route.js';
import {
  handleProfessionalLogin,
  handleProfessionalRegister,
  handleProfessionalVerifyConfirm,
  isProfessionalPath,
  type ProfessionalRouteOptions,
} from './professional-route.js';
import {
  handleProfessionalProfileGet,
  handleProfessionalProfilePut,
  PROFESSIONAL_PROFILE_PATH,
  type ProfessionalProfileRouteOptions,
} from './professional-profile-route.js';
// Issue 54 (H-041) | Estado visivel e recurso do profissional (GET e POST /v1/professional/verificacao).
import {
  handleProfessionalVerificationAppeal,
  handleProfessionalVerificationGet,
  PROFESSIONAL_VERIFICATION_APPEAL_PATH,
  PROFESSIONAL_VERIFICATION_PATH,
  type ProfessionalVerificationRouteOptions,
} from './professional-verification-route.js';
// E5 (Issues 60 a 67) | Cobranca pelo Mercado Pago: planos, situacao, checkout, retorno, cancelamento e webhook.
import { BILLING_PATHS, handleBillingRoute, type BillingRouteOptions } from './billing/billing-route.js';
import type { BillingService } from './billing/billing-service.js';
// Issue 57 (H-044) | Ativacao do trial de 14 dias (POST /v1/billing/trial/activate).
import { handleProfessionalTrialRoute, TRIAL_ACTIVATE_PATH, type ProfessionalTrialRouteOptions } from './professional-trial-route.js';
// H-036 | Servicos, base e raio do perfil profissional (GET/PUT /v1/professional/profile/services e /area).
import {
  handleProfessionalOfferingRoute,
  PROFESSIONAL_AREA_PATH,
  PROFESSIONAL_SERVICES_PATH,
  type ProfessionalOfferingRouteOptions,
} from './professional-offering-route.js';
// H-016 | Conta do profissional (GET /v1/professional/me), recuperacao, reenvio e troca de senha.
import {
  handleProfessionalMe,
  PROFESSIONAL_ME_PATH,
  type ProfessionalAccountRouteOptions,
} from './professional-account-route.js';
import {
  handlePasswordRecovery,
  handlePasswordReset,
  handleVerificationResend,
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RESET_PATH,
  PROFESSIONAL_RESEND_PATH,
  type ProfessionalRecoveryRouteOptions,
} from './professional-recovery-route.js';
import {
  handleProfessionalPasswordChange,
  PROFESSIONAL_PASSWORD_CHANGE_PATH,
  type ProfessionalPasswordRouteOptions,
} from './professional-password-route.js';
import { handleAddressSuggest, type GeoRouteOptions } from './geo/address-suggest-route.js';
import { handleDraftRoute, isDraftRoute, type DraftRouteOptions } from './drafts/draft-route.js';
import { handleMediaRoute, isMediaRoute, type MediaRouteOptions } from './media/media-route.js';
import { handleIdentityDocRoute, isIdentityDocRoute, type IdentityDocRouteOptions } from './identity-docs/identity-doc-route.js';
// H-031 (#44) | Publicacao idempotente do pedido (POST /v1/requests).
import { handleRequestPublishRoute, REQUEST_PUBLISH_PATH, type PublishRouteOptions } from './requests/publish-route.js';
// Issue 45 (H-032) | Leitura do pedido: dono (GET /v1/requests/:id) e profissional elegivel (GET /v1/professional/requests/:id).
import { handleRequestDetailRoute, isRequestDetailRoute, type RequestDetailRouteOptions } from './requests/detail-route.js';
import { handleConversationRoute, isConversationRoute, type ConversationRouteOptions } from './conversations/conversation-route.js';
// Pacote C (H-060, H-082, H-083): segunda onda e republicacao do pedido.
import { handleWaveRoute, isWaveRoute, type WaveRouteOptions } from './waves/wave-route.js';
// Issue 120 (H-111) | Direitos do titular: POST/GET /v1/privacy/dsr-requests e detalhe/cancelamento do proprio caso.
import {
  handlePrivacyTitularRoute,
  isPrivacyTitularRoute,
  type PrivacyTitularRouteOptions,
} from './privacy/titular-route.js';
// Issue 120 (H-111) | Painel do DPO: abertura assistida, listagem, detalhe e decisao (/v1/admin/privacy/dsr-cases).
import { handlePrivacyDpoRoute, isPrivacyDpoRoute, type PrivacyDpoRouteOptions } from './privacy/dpo-route.js';
// Issue 47 (H-034): lista do dono (GET /v1/requests); a publicacao (POST) segue na mesma URL.
import { handleRequestListRoute, isRequestListRoute, type RequestListRouteOptions } from './requests/list-route.js';
// Issue 68 (H-055) | Lista de pedidos elegiveis do profissional (GET /v1/professional/discovery/requests).
import { handleDiscoveryRoute, isDiscoveryRoute, type DiscoveryRouteOptions } from './requests/discovery-route.js';
// H-056 (Issue 69) | Fotos elegiveis: lista e link de visualizacao do profissional e do dono.
import { handlePhotoViewRoute, isPhotoViewRoute, type PhotoViewRouteOptions } from './requests/photo-view-route.js';
// H-056 (Issue 69) | Entrega da foto com marca d'agua (60 s), independente da midia.
import { handleWatermarkedPhotoRoute, isWatermarkedPhotoRoute, type WatermarkedPhotoRouteOptions } from './media/watermarked-photo-route.js';
// Issue 71 (H-058) | Aceite idempotente do trabalho (POST /v1/requests/:id/acceptances).
import { handleAcceptanceRoute, isAcceptanceRoute, type AcceptanceRouteOptions } from './requests/acceptance-route.js';
// Issue 46 (H-033) | Telefone e consentimento de contato (dono e profissional).
import { handleContactRoute, isContactRoute, type ContactRouteOptions } from './contact/contact-route.js';
// Issue 56 (H-043) | Perfil publico por slug (GET /v1/public/professionals/:slug): sem sessao e sem Set-Cookie.
import { handlePublicProfileGet, PUBLIC_PROFILE_ROUTE_PREFIX, type PublicProfileRouteOptions } from './public-profile-route.js';
import { draftNotFound } from './drafts/draft-service.js';
import {
  handleSessionConvert,
  handleSessionLogout,
  handleSessionLogoutAll,
  handleStepUp,
  handleStepUpChallenge,
  SESSION_CONVERT_PATH,
  SESSION_LOGOUT_ALL_PATH,
  SESSION_LOGOUT_PATH,
  STEP_UP_CHALLENGE_PATH,
  STEP_UP_PATH,
  type SessionRouteOptions,
} from './session-route.js';

/** Limite de corpo da aplicacao (CA-07): 4 MB inclusivo. Acima disso a resposta e 413. */
export const APP_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
export const HEALTH_PATH = '/health';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const JSON_HEADERS = {
  ...NO_STORE,
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AppOptions {
  /** Segredo do tick (nome JOBS_TICK_SECRET). Ausente ou curto demais: o tick fica fechado (401). */
  readonly tickSecret: string | undefined;
  /** Consumo do link (H-012). Sem esta opcao a rota nao existe (404). */
  readonly consume?: ConsumeRouteOptions;
  /** Pedido de login por link ou codigo (H-097). Sem esta opcao a rota POST /v1/auth/challenges nao existe (404). */
  readonly challengeRequest?: ChallengeRequestRouteOptions;
  /** Verificacao do codigo (H-097, caminho proposto). Sem esta opcao a rota POST /v1/auth/challenges/verify nao existe (404). */
  readonly challengeVerify?: ChallengeVerifyRouteOptions;
  /** Sessao de 7 dias e step-up (H-014). Sem esta opcao as rotas nao existem (404). */
  readonly session?: SessionRouteOptions;
  /** Autocomplete de endereco temporario (H-020). Sem esta opcao a rota nao existe (404). */
  readonly geo?: GeoRouteOptions;
  /** Consulta da auditoria pelo Auditor (H-104). Sem esta opcao a rota nao existe (404). */
  readonly admin?: AdminAuditRouteOptions;
  /** Menu do console por papel (H-103). Sem esta opcao a rota GET /v1/admin/console/menu nao existe (404). */
  readonly adminConsole?: AdminConsoleRouteOptions;
  /** Painel operacional (H-108). Sem esta opcao a rota GET /v1/admin/ops/panel nao existe (404). */
  readonly adminOps?: AdminOpsRouteOptions;
  /** Gestao do catalogo (H-107). Sem esta opcao as rotas /v1/admin/catalog nao existem (404). */
  readonly adminCatalog?: AdminCatalogRouteOptions;
  /** Estado da sessao admin para a interface (H-103). Sem esta opcao a rota GET /v1/admin/auth/session nao existe (404). */
  readonly adminAuthSession?: AdminAuthSessionRouteOptions;
  /** Acesso excepcional a conversa (H-073). Sem esta opcao as rotas /v1/admin/access-cases nao existem (404). */
  readonly accessCase?: AdminAccessCaseRouteOptions;
  /** Fila de verificacao de identidade (H-039). Sem esta opcao as rotas /v1/admin/verificacao/casos nao existem (404). */
  readonly verification?: AdminVerificationRouteOptions;
  /** Dupla aprovacao de estorno e suspensao (H-105). Sem esta opcao as rotas /v1/admin/{refund|suspension}-approvals nao existem (404). */
  readonly dualApproval?: AdminDualApprovalRouteOptions;
  /** Cadastro de politica de retencao e hold (H-109). Sem esta opcao as rotas /v1/admin/retention/* nao existem (404). */
  readonly adminRetention?: AdminRetentionRouteOptions;
  /** Confirmacao recente do segundo fator da sessao admin (H-073, 60 §4). Sem esta opcao a rota nao existe (404). */
  readonly adminStepUp?: AdminStepUpRouteOptions;
  /** Busca de servico com sinonimos (H-019). Sem esta opcao a rota nao existe (404). */
  readonly catalog?: CatalogRouteOptions;
  /** Rascunho de pedido sem conta (H-025). Sem esta opcao as rotas /v1/drafts nao existem (404). */
  readonly drafts?: DraftRouteOptions;
  /** Fotos em quarentena (H-026). Sem esta opcao as rotas /v1/media nao existem (404). Desligada em producao (88 §8). */
  readonly media?: MediaRouteOptions;
  /** Documentos de identidade do profissional (H-037). Sem esta opcao as rotas /v1/professional/documents respondem 404 uniforme. */
  readonly identityDocs?: IdentityDocRouteOptions;
  /** Cadastro, verificacao e login por senha do profissional (H-016). Sem esta opcao as rotas nao existem (404). */
  readonly professional?: ProfessionalRouteOptions;
  /** H-016: GET /v1/professional/me. Sem esta opcao a rota nao existe (404). */
  readonly professionalAccount?: ProfessionalAccountRouteOptions;
  /** H-016: recuperacao, redefinicao e reenvio do link. Sem esta opcao as rotas nao existem (404). */
  readonly professionalRecovery?: ProfessionalRecoveryRouteOptions;
  /** H-016: troca de senha do profissional logado. Sem esta opcao a rota nao existe (404). */
  readonly professionalPassword?: ProfessionalPasswordRouteOptions;
  /** Cadastro do documento e leitura do perfil profissional (H-035). Sem esta opcao as rotas nao existem (404). */
  readonly professionalProfile?: ProfessionalProfileRouteOptions;
  /** Issue 54 (H-041): estado visivel e recurso do profissional. Sem esta opcao as rotas nao existem (404). */
  readonly professionalVerification?: ProfessionalVerificationRouteOptions;
  // Issue 57 (H-044) | Ativacao do trial (so existe com a opcao).
  readonly professionalTrial?: ProfessionalTrialRouteOptions;
  /** E5: rotas de cobranca (Mercado Pago). Sem esta opcao as rotas /v1/billing/* (exceto trial) respondem 404. */
  readonly billing?: BillingRouteOptions;
  /** E5 (H-053): reconciliacao diaria executada pelo tick autenticado. */
  readonly billingReconcile?: Pick<BillingService, 'reconciliar'>;
  /** H-036: servicos, base e raio do perfil. Sem esta opcao as rotas nao existem (404). */
  readonly professionalOffering?: ProfessionalOfferingRouteOptions;
  /** H-031 (#44): publicacao do pedido. Sem esta opcao a rota POST /v1/requests responde 404 uniforme (decisao 254). */
  readonly requestPublish?: PublishRouteOptions;
  /** Issue 45 (H-032): leitura do pedido pelo dono e pelo profissional. Sem esta opcao as rotas respondem 404 uniforme. */
  readonly requestDetail?: RequestDetailRouteOptions;
  /** Ciclo central: interessados, selecao, conversas e mensagens. Sem esta opcao as rotas respondem 404 uniforme. */
  readonly conversations?: ConversationRouteOptions;
  /** Pacote C: segunda onda, republicacao e acoes do dono. Sem esta opcao as rotas respondem 404 uniforme. */
  readonly waves?: WaveRouteOptions;
  /** Issue 120 (H-111): direitos do titular. Sem esta opcao as rotas /v1/privacy/dsr-requests respondem 404 uniforme. */
  readonly privacyTitular?: PrivacyTitularRouteOptions;
  /** Issue 120 (H-111): painel do DPO. Sem esta opcao, /v1/admin/privacy/dsr-cases responde 404 vazio. */
  readonly privacyDpo?: PrivacyDpoRouteOptions;
  /** Issue 47 (H-034): lista do dono. Sem a montagem, o mesmo 404 uniforme do rascunho. */
  readonly requestList?: RequestListRouteOptions;
  /** Issue 68 (H-055): lista de descoberta do profissional. Sem a montagem completa, o mesmo 404 uniforme do rascunho. */
  readonly requestDiscovery?: DiscoveryRouteOptions;
  /** H-056 (#69): fotos elegiveis (lista e link), ou ausente (404 uniforme do rascunho). */
  readonly photoView?: PhotoViewRouteOptions;
  /** H-056 (#69): entrega da foto com marca (60 s). Sem esta opcao, a rota responde o 404 uniforme do rascunho. */
  readonly watermarkedPhoto?: WatermarkedPhotoRouteOptions;
  /** Issue 71 (H-058): aceite idempotente. Sem a montagem completa, o mesmo 404 uniforme do rascunho. */
  readonly requestAcceptance?: AcceptanceRouteOptions;
  /** Issue 46 (H-033): telefone e consentimento de contato. Sem esta opcao as rotas respondem 404 uniforme. */
  readonly requestContact?: ContactRouteOptions;
  /** Issue 56 (H-043): perfil publico por slug. Sem esta opcao a rota nao existe (404). */
  readonly publicProfile?: PublicProfileRouteOptions;
}

export interface BodyReadResult {
  /** Bytes lidos ate o fim do corpo. O corpo nunca e guardado, so contado. */
  readonly bytes: number;
  readonly overflow: boolean;
}

/**
 * Conta os bytes do corpo sem armazena-lo. Ao passar do limite, o restante e descartado ate o fim
 * (a resposta 413 so sai depois, para o cliente nao receber reset de conexao no meio do envio).
 */
export function readBodyBytes(req: IncomingMessage, limit: number): Promise<BodyReadResult> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    req.on('end', () => resolve({ bytes, overflow: bytes > limit }));
    req.on('error', reject);
  });
}

/**
 * Caminho usado pelas rotas. Atras da mesma origem (web encaminha /api/*), o caminho chega com o
 * prefixo /api; sem ele, chega direto. As duas formas apontam para a mesma rota.
 */
export function routePath(url: string | undefined): string {
  const { pathname } = new URL(url ?? '/', 'http://localhost');
  const stripped = pathname.replace(/^\/api(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
): void {
  res.writeHead(status, headers);
  res.end(body);
}

async function handleTick(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AppOptions,
): Promise<void> {
  if (!isTickAuthorized(req.headers.authorization, opts.tickSecret)) {
    send(res, 401, NO_STORE, '');
    return;
  }
  const { bytes, overflow } = await readBodyBytes(req, APP_BODY_LIMIT_BYTES);
  if (overflow || bytes > TICK_BODY_LIMIT_BYTES) {
    send(res, 413, NO_STORE, '');
    return;
  }
  // E5 (H-053): reconciliacao MP x livro (so registra divergencias). Falha nao derruba o tick.
  let reconciliacao: { conferidos: number; divergencias: number } | 'falhou' | undefined;
  if (opts.billingReconcile) {
    try {
      reconciliacao = await opts.billingReconcile.reconciliar();
    } catch {
      reconciliacao = 'falhou';
    }
  }
  send(res, 200, JSON_HEADERS, JSON.stringify(reconciliacao === undefined ? { ok: true } : { ok: true, reconciliacao }));
}

/** Roteia uma requisicao. Rotas desconhecidas e metodos errados respondem 404 sem corpo. */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AppOptions,
): Promise<void> {
  const path = routePath(req.url);
  if (req.method === 'GET' && path === HEALTH_PATH) {
    send(res, 200, JSON_HEADERS, JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method === 'POST' && path === TICK_PATH) {
    await handleTick(req, res, opts);
    return;
  }
  if (req.method === 'POST' && path === CONSUME_PATH && opts.consume) {
    await handleConsume(req, res, opts.consume);
    return;
  }
  if (req.method === 'POST' && path === CHALLENGE_REQUEST_PATH && opts.challengeRequest) {
    await handleChallengeRequest(req, res, opts.challengeRequest);
    return;
  }
  if (req.method === 'POST' && path === CHALLENGE_VERIFY_PATH && opts.challengeVerify) {
    await handleChallengeVerify(req, res, opts.challengeVerify);
    return;
  }
  if (req.method === 'POST' && path === ADMIN_STEP_UP_PATH && opts.adminStepUp) {
    await handleAdminStepUpRoute(req, res, opts.adminStepUp);
    return;
  }
  if (
    opts.accessCase &&
    (path === ADMIN_ACCESS_CASES_PATH || path.startsWith(`${ADMIN_ACCESS_CASES_PATH}/`))
  ) {
    await handleAdminAccessCaseRoute(req, res, opts.accessCase, path);
    return;
  }
  if (opts.verification && (path === VERIFICACAO_CASOS_PATH || path.startsWith(`${VERIFICACAO_CASOS_PATH}/`))) {
    await handleAdminVerificationRoute(req, res, opts.verification, path);
    return;
  }
  if (
    opts.dualApproval &&
    (path.startsWith(`${ADMIN_REFUND_APPROVALS_PATH}`) || path.startsWith(`${ADMIN_SUSPENSION_APPROVALS_PATH}`))
  ) {
    await handleAdminDualApprovalRoute(req, res, opts.dualApproval, path);
    return;
  }
  if (req.method === 'POST' && path === ADMIN_AUDIT_QUERY_PATH && opts.admin) {
    await handleAdminAuditQuery(req, res, opts.admin);
    return;
  }
  if (req.method === 'GET' && path === ADMIN_CONSOLE_MENU_PATH && opts.adminConsole) {
    await handleAdminConsoleMenu(req, res, opts.adminConsole);
    return;
  }
  if (req.method === 'GET' && path === ADMIN_OPS_PANEL_PATH && opts.adminOps) {
    await handleAdminOpsPanel(req, res, opts.adminOps);
    return;
  }
  if (opts.adminCatalog && path.startsWith('/v1/admin/catalog')) {
    await handleAdminCatalogRoute(req, res, opts.adminCatalog, path);
    return;
  }
  if (path.startsWith(`${RETENTION_BASE_PATH}/`) && opts.adminRetention) {
    await handleAdminRetentionRoute(req, res, opts.adminRetention, path);
    return;
  }
  if (req.method === 'GET' && path === ADMIN_AUTH_SESSION_PATH && opts.adminAuthSession) {
    await handleAdminAuthSessionRoute(req, res, opts.adminAuthSession);
    return;
  }
  if (req.method === 'POST' && path === ADDRESS_SUGGEST_PATH && opts.geo) {
    await handleAddressSuggest(req, res, opts.geo);
    return;
  }
  if (opts.drafts && isDraftRoute(path)) {
    await handleDraftRoute(req, res, path, opts.drafts);
    return;
  }
  // H-037 (#50): documentos de identidade. Sem a montagem completa (trava ou pendencia), o mesmo 404 uniforme do rascunho.
  if (isIdentityDocRoute(path)) {
    if (opts.identityDocs) {
      await handleIdentityDocRoute(req, res, path, opts.identityDocs);
      return;
    }
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // H-056 (Issue 69): entrega da foto com marca. Nao depende da midia; sem a montagem, o 404 uniforme do rascunho.
  if (isWatermarkedPhotoRoute(path)) {
    if (opts.watermarkedPhoto) return handleWatermarkedPhotoRoute(req, res, path, opts.watermarkedPhoto);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  if (opts.media && isMediaRoute(path)) {
    await handleMediaRoute(req, res, path, opts.media);
    return;
  }
  // E3 (decisao 190, desenho §2.4): sem a midia montada, o mesmo 404 uniforme do rascunho (corpo e cabecalhos).
  if (isMediaRoute(path)) {
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 47 (H-034): lista do dono, so GET. O POST da mesma URL segue no bloco de publicacao.
  if (req.method === 'GET' && isRequestListRoute(path)) {
    if (opts.requestList) return handleRequestListRoute(req, res, opts.requestList);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // H-031 (#44): publicacao do pedido. Sem a montagem completa, o mesmo 404 uniforme do rascunho.
  if (path === REQUEST_PUBLISH_PATH) {
    if (opts.requestPublish) return handleRequestPublishRoute(req, res, path, opts.requestPublish);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 120 (H-111): direitos do titular. Sem a montagem (banco app_system), o mesmo 404 uniforme do rascunho.
  // Issue 120 (H-111): painel do DPO. Sem a montagem (banco app_system e ADMIN_BASE_URL), 404 vazio como a rota admin.
  if (isPrivacyDpoRoute(path)) {
    if (opts.privacyDpo) return handlePrivacyDpoRoute(req, res, path, opts.privacyDpo);
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (isPrivacyTitularRoute(path)) {
    if (opts.privacyTitular) return handlePrivacyTitularRoute(req, res, path, opts.privacyTitular);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // H-056 (Issue 69): fotos elegiveis do profissional e do dono. Sem a montagem, o mesmo 404 uniforme do rascunho.
  if (isPhotoViewRoute(path)) {
    if (opts.photoView) return handlePhotoViewRoute(req, res, path, opts.photoView);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Pacote C (H-060, H-082, H-083): segunda onda e republicacao. Sem a montagem, o mesmo 404 uniforme do rascunho.
  if (isWaveRoute(req.method ?? '', path)) {
    if (opts.waves) return handleWaveRoute(req, res, path, opts.waves);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Ciclo central: interessados, selecao, conversas e mensagens. Sem a montagem, o mesmo 404 uniforme do rascunho.
  if (isConversationRoute(req.method ?? '', path)) {
    if (opts.conversations) return handleConversationRoute(req, res, path, opts.conversations);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 45 (H-032): leitura do pedido. Sem a montagem completa (chave ou banco), o mesmo 404 uniforme do rascunho.
  if (isRequestDetailRoute(path)) {
    if (opts.requestDetail) return handleRequestDetailRoute(req, res, path, opts.requestDetail);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 68 (H-055): descoberta do profissional. Sem a montagem completa (chave ou banco), o mesmo 404 uniforme do rascunho.
  if (isDiscoveryRoute(path)) {
    if (opts.requestDiscovery) return handleDiscoveryRoute(req, res, opts.requestDiscovery);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 71 (H-058): aceite do trabalho. Sem a montagem completa (chave, banco ou conexao), o mesmo 404 uniforme do rascunho.
  if (isAcceptanceRoute(req.method ?? '', path)) {
    if (opts.requestAcceptance) return handleAcceptanceRoute(req, res, path, opts.requestAcceptance);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 46 (H-033): contato. Sem a montagem completa (chave ou banco), o mesmo 404 uniforme do rascunho.
  if (isContactRoute(req.method ?? '', path)) {
    if (opts.requestContact) return handleContactRoute(req, res, path, opts.requestContact);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  // Issue 56 (H-043): perfil publico. Sem a montagem completa (banco), o mesmo 404 uniforme do rascunho.
  if (req.method === 'GET' && path.startsWith(PUBLIC_PROFILE_ROUTE_PREFIX)) {
    if (opts.publicProfile) return handlePublicProfileGet(req, res, opts.publicProfile);
    const r = draftNotFound();
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }

  if (req.method === 'POST' && path === CATALOG_SEARCH_PATH && opts.catalog) {
    await handleCatalogSearch(req, res, opts.catalog);
    return;
  }
  if (opts.professionalProfile && path === PROFESSIONAL_PROFILE_PATH) {
    if (req.method === 'PUT') return handleProfessionalProfilePut(req, res, opts.professionalProfile);
    if (req.method === 'GET') return handleProfessionalProfileGet(req, res, opts.professionalProfile);
  }
  // Issue 54 (H-041): estado visivel e recurso do profissional.
  if (opts.professionalVerification && path === PROFESSIONAL_VERIFICATION_PATH && req.method === 'GET') {
    return handleProfessionalVerificationGet(req, res, opts.professionalVerification);
  }
  if (opts.professionalVerification && path === PROFESSIONAL_VERIFICATION_APPEAL_PATH && req.method === 'POST') {
    return handleProfessionalVerificationAppeal(req, res, opts.professionalVerification);
  }
  if (opts.billing && BILLING_PATHS.includes(path)) {
    return handleBillingRoute(req, res, path, opts.billing);
  }
  if (opts.professionalTrial && path === TRIAL_ACTIVATE_PATH) {
    return handleProfessionalTrialRoute(req, res, opts.professionalTrial);
  }
  if (opts.professionalOffering && (path === PROFESSIONAL_SERVICES_PATH || path === PROFESSIONAL_AREA_PATH)) {
    return handleProfessionalOfferingRoute(req, res, path, opts.professionalOffering);
  }
  // H-016 | Conta do profissional, recuperacao, reenvio e troca de senha (cada rota so existe com a sua opcao).
  if (req.method === 'GET' && path === PROFESSIONAL_ME_PATH && opts.professionalAccount) {
    return handleProfessionalMe(req, res, opts.professionalAccount);
  }
  if (req.method === 'POST' && opts.professionalRecovery) {
    if (path === PASSWORD_RECOVERY_PATH) return handlePasswordRecovery(req, res, opts.professionalRecovery);
    if (path === PASSWORD_RESET_PATH) return handlePasswordReset(req, res, opts.professionalRecovery);
    if (path === PROFESSIONAL_RESEND_PATH) return handleVerificationResend(req, res, opts.professionalRecovery);
  }
  if (req.method === 'POST' && path === PROFESSIONAL_PASSWORD_CHANGE_PATH && opts.professionalPassword) {
    return handleProfessionalPasswordChange(req, res, opts.professionalPassword);
  }
  if (req.method === 'POST' && opts.professional && isProfessionalPath(path)) {
    const profissional = opts.professional;
    if (path === PROFESSIONAL_REGISTER_PATH) return handleProfessionalRegister(req, res, profissional);
    if (path === PROFESSIONAL_VERIFY_CONFIRM_PATH) return handleProfessionalVerifyConfirm(req, res, profissional);
    if (path === PROFESSIONAL_LOGIN_PATH) return handleProfessionalLogin(req, res, profissional);
  }
  if (req.method === 'POST' && opts.session) {
    const sessao = opts.session;
    if (path === SESSION_CONVERT_PATH) return handleSessionConvert(req, res, sessao);
    if (path === SESSION_LOGOUT_PATH) return handleSessionLogout(req, res, sessao);
    if (path === SESSION_LOGOUT_ALL_PATH) return handleSessionLogoutAll(req, res, sessao);
    if (path === STEP_UP_PATH && sessao.proof !== undefined) return handleStepUp(req, res, sessao);
    if (path === STEP_UP_CHALLENGE_PATH && sessao.challenge !== undefined) {
      return handleStepUpChallenge(req, res, sessao);
    }
  }
  send(res, 404, NO_STORE, '');
}
