// Placeholder da historia H-001: sem logica de produto.
export const PACKAGE_NAME = '@fastpro/domain' as const;

export * from './notifications/index.js';
export * from './identity/index.js';

export * from './admin/index.js';
export * from './geo/index.js';
export * from './professional/index.js';
export * from './draft/index.js';

export * from './catalog/index.js';
// H-109 | Retencao sem prazos: politica por classe, expurgo em lotes e cadastro com aprovacao dupla.
export * from './retention/index.js';
// H-026 | Fotos em quarentena (88-DESENHO-H026): constantes, corpo, portas e expurgo.
export * from './media/index.js';
// H-110 (Issue 119) | Expurgos operacionais: orquestracao pura (docs/factory/105-DESENHO-H110.md).
export * from './ops-purge/index.js';
// H-037 (Issue #50) | Documentos de identidade do profissional (barril do modulo; 107-DESENHO-H037 §11).
export * from './identity-docs/index.js';
// H-031 (#44) | Publicacao do pedido: regras puras, corpo, chave e token de duplicidade (110-DESENHO-H031).
export * from './request/index.js';
// H-045 (Issue 58) | Acesso comercial derivado: tipos, porta, relogio injetado e leitura (114-DESENHO-H045).
export * from './billing/index.js';
