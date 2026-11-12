// H-103 (Issue 112) | GET /v1/admin/auth/session (docs/factory/70-DESENHO-H103.md §2, §3 R-7, T-H103-08).
// Rota publica no registro (ADMIN_ROUTES_H102), por isso a guarda nao decide aqui: esta funcao decide.
// Sem sessao valida (ausente, vencida, revogada, sem aal2 ou sem papel) = { autenticado: false } com 200,
// sempre o mesmo corpo: nao ha enumeracao nem diferenca por causa. Com sessao = papeis e expira_em.
// Sem e-mail, sem permissoes brutas, sem segredo.

import { decideAdminGuard } from './guard.js';
import type { AdminGuardRecord } from './ports.js';
import { adminReply, type AdminResponse } from './responses.js';
import { isAdminRole } from './roles.js';

export const ADMIN_AUTH_SESSION_PATH = '/v1/admin/auth/session';

export function handleAdminAuthSession(row: AdminGuardRecord | null, nowMs: number): AdminResponse {
  const decisao = decideAdminGuard(row, 'sessao', nowMs);
  if (decisao.kind !== 'autorizada' || row === null) return adminReply(200, { autenticado: false });
  return adminReply(200, {
    autenticado: true,
    papeis: row.roles.filter(isAdminRole),
    expira_em: new Date(row.expiresAtMs).toISOString(),
  });
}
