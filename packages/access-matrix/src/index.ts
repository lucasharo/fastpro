// H-115 (Issue 124) | Matriz de acesso legivel por maquina. Fonte unica para API, banco e relatorio.
// PACKAGE_NAME, PERMISSIONS e ROLE_PERMISSIONS sao mantidos (compatibilidade com H-018).

export const PACKAGE_NAME = '@fastpro/access-matrix' as const;

// H-018 (docs/factory/53-DESENHO-H018 §3.1): permissao de gestao do catalogo. Atribuida somente ao
// papel Superadmin. Visitante, cliente e profissional nao a possuem. A checagem no banco e feita por
// private.catalog_assert_admin (aal2 + permissao no principal).
export const PERMISSIONS = {
  catalogManage: 'catalog.manage',
} as const;

export const ROLE_PERMISSIONS = {
  superadmin: [PERMISSIONS.catalogManage],
} as const;

export * from './types.js';
export * from './roles.js';
export * from './resources.js';
export * from './projections.js';
export * from './sentinels.js';
export * from './matrix.js';
export * from './report.js';
