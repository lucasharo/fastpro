// H-102 | Papeis, permissoes e mapa papel x permissao (docs/factory/54-DESENHO-H102.md §1; semente de
// app.admin_role_permission na migracao 20261111220000_admin_create_rbac). Logica pura.
// Superadmin NAO herda as demais permissoes (segregacao, RF-145).

export const ADMIN_ROLES = [
  'superadmin',
  'verificacao',
  'moderador',
  'financeiro',
  'suporte',
  'auditor',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'verification.review',
  'moderation.decide',
  'finance.refund.request',
  'finance.refund.approve',
  'support.completion.correct',
  'audit.read',
  'catalog.manage',
  'admin.role.manage',
  'case.open_sensitive',
  'case.authorize_sensitive',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  superadmin: ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'],
  verificacao: ['verification.review'],
  moderador: ['moderation.decide'],
  financeiro: ['finance.refund.request', 'finance.refund.approve'],
  suporte: ['support.completion.correct', 'case.open_sensitive'],
  auditor: ['audit.read'],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

/** Permissoes efetivas de um conjunto de papeis ativos. Papel desconhecido nao concede nada. */
export function adminPermissionsOf(roles: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const role of roles) {
    if (!isAdminRole(role)) continue;
    for (const permission of ADMIN_ROLE_PERMISSIONS[role]) out.add(permission);
  }
  return out;
}
