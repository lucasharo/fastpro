// Placeholder da historia H-001: sem logica de produto.
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
