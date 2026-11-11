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
