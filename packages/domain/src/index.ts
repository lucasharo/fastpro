// Placeholder da historia H-001: sem logica de produto.
export const PACKAGE_NAME = '@fastpro/domain' as const;

export * from './notifications/index.js';
export * from './identity/index.js';

export * from './admin/index.js';
export * from './geo/index.js';
export * from './draft/index.js';

export * from './catalog/index.js';
// H-109 | Retencao sem prazos: politica por classe, expurgo em lotes e cadastro com aprovacao dupla.
export * from './retention/index.js';
