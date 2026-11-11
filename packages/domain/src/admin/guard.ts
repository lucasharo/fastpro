// H-102 | Guarda de cada requisicao admin (docs/factory/54-DESENHO-H102.md §3 e §4). Logica pura: a
// autoridade e o banco (uma consulta por requisicao); aqui so se decide a resposta.
//   sem sessao / vencida / revogada / sem aal2 / conta inativa / sem papel  -> 404 identico ao de rota
//   sessao valida e papel, mas sem a permissao da rota                       -> 403 permission_denied
// Nada vem do cookie alem do segredo.

import type { AdminRouteSpec, AdminMethod, AdminMutationHeaders } from './routes.js';
import { checkAdminMutation, resolveAdminRoute } from './routes.js';
import type { AdminGuardRecord, AdminRepository } from './ports.js';
import { ADMIN_NOT_FOUND, ADMIN_PERMISSION_DENIED, type AdminResponse } from './responses.js';

export type AdminGuardOutcome =
  | { readonly kind: 'publica' }
  | { readonly kind: 'autorizada'; readonly userId: string; readonly roles: readonly string[] }
  | { readonly kind: 'recusada'; readonly response: AdminResponse };

/** Decisao pura sobre a linha que o banco devolveu (nulo = sem sessao valida). */
export function decideAdminGuard(
  row: AdminGuardRecord | null,
  required: AdminRouteSpec['permission'],
  nowMs: number,
): AdminGuardOutcome {
  // Rota publica nao passa pela guarda: decide antes de olhar a linha (que pode ser nula).
  if (required === 'publica') return { kind: 'publica' };
  if (
    row === null ||
    !row.active ||
    !row.aal2 ||
    row.expiresAtMs <= nowMs ||
    row.roles.length === 0
  ) {
    return { kind: 'recusada', response: ADMIN_NOT_FOUND };
  }
  if (required === 'sessao') {
    return { kind: 'autorizada', userId: row.userId, roles: row.roles };
  }
  if (!row.permissions.includes(required)) {
    return { kind: 'recusada', response: ADMIN_PERMISSION_DENIED };
  }
  return { kind: 'autorizada', userId: row.userId, roles: row.roles };
}

export interface AdminGuardRequest {
  readonly method: AdminMethod;
  readonly path: string;
  /** Segredo do cookie __Host-fp_admin; nulo quando ausente. */
  readonly secret: string | null;
  readonly headers: AdminMutationHeaders;
}

export interface AdminGuardDeps {
  readonly repo: AdminRepository;
  readonly registry: readonly AdminRouteSpec[];
  readonly baseUrl: string;
}

/** Fluxo completo da guarda: rota, origem, uma consulta ao banco e a decisao. */
export async function guardAdminRequest(
  req: AdminGuardRequest,
  deps: AdminGuardDeps,
  nowMs: number,
): Promise<AdminGuardOutcome> {
  const route = resolveAdminRoute(deps.registry, req.method, req.path);
  if (route === null) return { kind: 'recusada', response: ADMIN_NOT_FOUND };

  const origem = checkAdminMutation(req.method, req.headers, deps.baseUrl);
  if (origem !== null) return { kind: 'recusada', response: origem };

  if (route.permission === 'publica') return { kind: 'publica' };
  if (req.secret === null) return { kind: 'recusada', response: ADMIN_NOT_FOUND };

  const row = await deps.repo.guard(req.secret, nowMs);
  return decideAdminGuard(row, route.permission, nowMs);
}
