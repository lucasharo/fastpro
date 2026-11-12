// H-102 | Registro de rotas /v1/admin/* com uma permissao por rota (54 §4), checagem de origem das
// mutacoes (54 §3) e resolucao de rota. Rota fora do registro = inexistente (404). Logica pura.

import type { AdminPermission } from './roles.js';
import {
  ADMIN_NOT_FOUND,
  ADMIN_ORIGIN_INVALID,
  type AdminResponse,
} from './responses.js';

export type AdminMethod = 'GET' | 'POST' | 'DELETE';

/** 'publica' = prefixo auth, sem sessao. 'sessao' = exige sessao valida, sem permissao extra. */
export interface AdminRouteSpec {
  readonly method: AdminMethod;
  readonly pattern: string;
  readonly permission: AdminPermission | 'sessao' | 'publica';
}

/** Caminho da confirmacao recente do segundo fator (H-073, 60 §4). */
export const ADMIN_STEP_UP_PATH = '/v1/admin/session/step-up';

/** Rotas deste desenho. Nenhuma e ligada a producao nesta etapa (54 §7, item 5). */
export const ADMIN_ROUTES_H102: readonly AdminRouteSpec[] = [
  { method: 'GET', pattern: '/v1/admin/auth/session', permission: 'publica' },
  { method: 'POST', pattern: '/v1/admin/auth/invite/start', permission: 'publica' },
  { method: 'POST', pattern: '/v1/admin/auth/invite/confirm', permission: 'publica' },
  { method: 'POST', pattern: '/v1/admin/auth/login', permission: 'publica' },
  { method: 'POST', pattern: '/v1/admin/auth/logout', permission: 'sessao' },
  { method: 'POST', pattern: '/v1/admin/invites', permission: 'admin.role.manage' },
  { method: 'POST', pattern: '/v1/admin/staff/:userId/roles', permission: 'admin.role.manage' },
  { method: 'DELETE', pattern: '/v1/admin/staff/:userId/roles/:role', permission: 'admin.role.manage' },
  {
    method: 'POST',
    pattern: '/v1/admin/staff/:userId/mfa-reenroll-requests',
    permission: 'admin.role.manage',
  },
  // H-073 (60 §4): confirmacao recente do segundo fator. Qualquer papel com sessao valida.
  { method: 'POST', pattern: ADMIN_STEP_UP_PATH, permission: 'sessao' },
];

/** Casa o caminho com o padrao; ':nome' casa um segmento nao vazio. */
function matchesPattern(pattern: string, path: string): boolean {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return false;
  return p.every((seg, i) => (seg.startsWith(':') ? s[i] !== '' : seg === s[i]));
}

export function resolveAdminRoute(
  registry: readonly AdminRouteSpec[],
  method: string,
  path: string,
): AdminRouteSpec | null {
  return (
    registry.find((r) => r.method === method && matchesPattern(r.pattern, path)) ?? null
  );
}

export interface AdminMutationHeaders {
  readonly contentType: string | null;
  readonly origin: string | null;
  readonly secFetchSite: string | null;
}

/**
 * Mutacoes exigem JSON, Origin igual a ADMIN_BASE_URL e Sec-Fetch-Site same-origin. Falha = 403
 * origem_invalida, antes da guarda e sem efeito. Metodos seguros passam sem checagem.
 */
export function checkAdminMutation(
  method: AdminMethod,
  headers: AdminMutationHeaders,
  baseUrl: string,
): AdminResponse | null {
  if (method === 'GET') return null;
  const json = headers.contentType?.toLowerCase().startsWith('application/json') === true;
  const origemOk = headers.origin === baseUrl;
  const siteOk = headers.secFetchSite === 'same-origin';
  return json && origemOk && siteOk ? null : ADMIN_ORIGIN_INVALID;
}

/** 404 identico para rota inexistente: a resposta nunca revela se a rota existe para quem nao tem papel. */
export function adminNotFound(): AdminResponse {
  return ADMIN_NOT_FOUND;
}

/** Consulta da trilha pelo Auditor (H-104, 63 §3): POST, permissao audit.read. Sem PUT, PATCH ou DELETE. */
export const ADMIN_AUDIT_QUERY_PATH = '/v1/admin/audit/queries';

/** Acesso excepcional a conversa (H-073, 60 §1). Uma permissao por rota; leitura so com caso ativo. */
export const ADMIN_ACCESS_CASES_PATH = '/v1/admin/access-cases';
export const ADMIN_ROUTES_H073: readonly AdminRouteSpec[] = [
  { method: 'POST', pattern: ADMIN_ACCESS_CASES_PATH, permission: 'case.open_sensitive' },
  { method: 'GET', pattern: ADMIN_ACCESS_CASES_PATH, permission: 'sessao' },
  {
    method: 'POST',
    pattern: `${ADMIN_ACCESS_CASES_PATH}/:caseId/approve`,
    permission: 'case.authorize_sensitive',
  },
  { method: 'POST', pattern: `${ADMIN_ACCESS_CASES_PATH}/:caseId/close`, permission: 'sessao' },
  {
    method: 'POST',
    pattern: `${ADMIN_ACCESS_CASES_PATH}/:caseId/conversation/read`,
    permission: 'case.open_sensitive',
  },
];

/** Menu do console por papel (H-103, 70 §1). Qualquer papel com sessao valida; so devolve id, rotulo e caminho. */
export const ADMIN_CONSOLE_MENU_PATH = '/v1/admin/console/menu';
export const ADMIN_ROUTES_H103: readonly AdminRouteSpec[] = [
  { method: 'GET', pattern: ADMIN_CONSOLE_MENU_PATH, permission: 'sessao' },
];

/** Painel operacional (H-108, 76 §2): so leitura (GET), so Superadmin via ops.panel.read. */
export const ADMIN_OPS_PANEL_PATH = '/v1/admin/ops/panel';
export const ADMIN_ROUTES_H108: readonly AdminRouteSpec[] = [
  { method: 'GET', pattern: ADMIN_OPS_PANEL_PATH, permission: 'ops.panel.read' },
];

/**
 * Gestao do catalogo (H-107, 81 §1): so GET e POST (desativar e POST com active false). Todas exigem
 * catalog.manage; quem nao tem a permissao recebe 404 identico (decisao aceita, padrao do console).
 */
export const ADMIN_CATALOG_PATH = '/v1/admin/catalog';
export const ADMIN_ROUTES_H107: readonly AdminRouteSpec[] = [
  { method: 'GET', pattern: ADMIN_CATALOG_PATH, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/groups`, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/groups/:id`, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/services`, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/services/:id`, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/synonyms`, permission: 'catalog.manage' },
  { method: 'POST', pattern: `${ADMIN_CATALOG_PATH}/synonyms/:id`, permission: 'catalog.manage' },
  { method: 'GET', pattern: `${ADMIN_CATALOG_PATH}/:entity/:id/revisions`, permission: 'catalog.manage' },
];

/**
 * Dupla aprovacao (H-105, 80 §3): uma familia por tipo de acao. POST pede (permissao de pedir), GET e cancel
 * usam so a sessao (o banco filtra pelo solicitante e pela permissao de votar), vote exige a permissao de votar.
 */
export const ADMIN_REFUND_APPROVALS_PATH = '/v1/admin/refund-approvals';
export const ADMIN_SUSPENSION_APPROVALS_PATH = '/v1/admin/suspension-approvals';

function familiaDeAprovacao(
  caminho: string,
  pedir: AdminPermission,
  votar: AdminPermission,
): readonly AdminRouteSpec[] {
  return [
    { method: 'POST', pattern: caminho, permission: pedir },
    { method: 'GET', pattern: caminho, permission: 'sessao' },
    { method: 'POST', pattern: `${caminho}/:approvalId/vote`, permission: votar },
    { method: 'POST', pattern: `${caminho}/:approvalId/cancel`, permission: 'sessao' },
  ];
}

export const ADMIN_ROUTES_H105: readonly AdminRouteSpec[] = [
  ...familiaDeAprovacao(ADMIN_REFUND_APPROVALS_PATH, 'finance.refund.request', 'finance.refund.approve'),
  ...familiaDeAprovacao(ADMIN_SUSPENSION_APPROVALS_PATH, 'account.suspend.request', 'account.suspend.approve'),
];

/** Registro completo das rotas admin (H-102 + H-104 + H-073 + H-103 + H-108 + H-105). Fonte unica para a guarda da API. */
export const ADMIN_ROUTES: readonly AdminRouteSpec[] = [
  ...ADMIN_ROUTES_H102,
  { method: 'POST', pattern: ADMIN_AUDIT_QUERY_PATH, permission: 'audit.read' },
  ...ADMIN_ROUTES_H073,
  ...ADMIN_ROUTES_H103,
  ...ADMIN_ROUTES_H108,
  ...ADMIN_ROUTES_H107,
  ...ADMIN_ROUTES_H105,
];
