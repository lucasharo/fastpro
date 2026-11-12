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
import { handleAdminStepUpRoute, type AdminStepUpRouteOptions } from './admin-step-up-route.js';
import { handleAdminAuditQuery, type AdminAuditRouteOptions } from './admin-audit-route.js';
import { handleAdminConsoleMenu, type AdminConsoleRouteOptions } from './admin-console-route.js';
import { handleAdminOpsPanel, type AdminOpsRouteOptions } from './admin-ops-route.js';
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
import { handleAddressSuggest, type GeoRouteOptions } from './geo/address-suggest-route.js';
import { handleDraftRoute, isDraftRoute, type DraftRouteOptions } from './drafts/draft-route.js';
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
  /** Dupla aprovacao de estorno e suspensao (H-105). Sem esta opcao as rotas /v1/admin/{refund|suspension}-approvals nao existem (404). */
  readonly dualApproval?: AdminDualApprovalRouteOptions;
  /** Confirmacao recente do segundo fator da sessao admin (H-073, 60 §4). Sem esta opcao a rota nao existe (404). */
  readonly adminStepUp?: AdminStepUpRouteOptions;
  /** Busca de servico com sinonimos (H-019). Sem esta opcao a rota nao existe (404). */
  readonly catalog?: CatalogRouteOptions;
  /** Rascunho de pedido sem conta (H-025). Sem esta opcao as rotas /v1/drafts nao existem (404). */
  readonly drafts?: DraftRouteOptions;
  /** Cadastro, verificacao e login por senha do profissional (H-016). Sem esta opcao as rotas nao existem (404). */
  readonly professional?: ProfessionalRouteOptions;
  /** Cadastro do documento e leitura do perfil profissional (H-035). Sem esta opcao as rotas nao existem (404). */
  readonly professionalProfile?: ProfessionalProfileRouteOptions;
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
  if (req.method === 'POST' && path === CATALOG_SEARCH_PATH && opts.catalog) {
    await handleCatalogSearch(req, res, opts.catalog);
    return;
  }
  if (opts.professionalProfile && path === PROFESSIONAL_PROFILE_PATH) {
    if (req.method === 'PUT') return handleProfessionalProfilePut(req, res, opts.professionalProfile);
    if (req.method === 'GET') return handleProfessionalProfileGet(req, res, opts.professionalProfile);
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
