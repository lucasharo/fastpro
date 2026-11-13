// H-037 (Issue #50) | Modulo de documentos de identidade (barril do modulo). Os barris globais
// packages/domain/src/index.ts e packages/db/src/index.ts recebem a linha de exportacao na fase 2, depois da #141.
export * from './constants.js';
export * from './textos.js';
export * from './body.js';
export * from './pdf.js';
export * from './tipo.js';
export * from './keys.js';
export * from './ports.js';
