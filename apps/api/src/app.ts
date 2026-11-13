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
  /** H-036: servicos, base e raio do perfil. Sem esta opcao as rotas nao existem (404). */
  readonly professionalOffering?: ProfessionalOfferingRouteOptions;
  /** H-031 (#44): publicacao do pedido. Sem esta opcao a rota POST /v1/requests responde 404 uniforme (decisao 254). */
  readonly requestPublish?: PublishRouteOptions;
  /** Issue 45 (H-032): leitura do pedido pelo dono e pelo profissional. Sem esta opcao as rotas respondem 404 uniforme. */
  readonly requestDetail?: RequestDetailRouteOptions;
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
  // Nesta pre-visualizacao o tick nao executa jobs (sem banco). A resposta prova o caminho autenticado.
  send(res, 200, JSON_HEADERS, JSON.stringify({ ok: true }));
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
  // H-031 (#44): publicacao do pedido. Sem a montagem completa, o mesmo 404 uniforme do rascunho.
  if (path === REQUEST_PUBLISH_PATH) {
    if (opts.requestPublish) return handleRequestPublishRoute(req, res, path, opts.requestPublish);
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
  if (req.method === 'POST' && path === CATALOG_SEARCH_PATH && opts.catalog) {
    await handleCatalogSearch(req, res, opts.catalog);
    return;
  }
  if (opts.professionalProfile && path === PROFESSIONAL_PROFILE_PATH) {
    if (req.method === 'PUT') return handleProfessionalProfilePut(req, res, opts.professionalProfile);
    if (req.method === 'GET') return handleProfessionalProfileGet(req, res, opts.professionalProfile);
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
