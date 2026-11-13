// H-037 (Issue #50) | ESPELHO de packages/domain/src/identity-docs/keys.ts (fase 1). O barril do dominio ainda nao exporta identity-docs;
// na fase 2 (depois da #141) troque por import de @fastpro/domain e apague esta pasta. Paridade provada em tests/identity-docs-espelho.test.ts.
// H-037 (Issue #50) | Chaves de objeto dos documentos (107-DESENHO-H037.md, §2 D-1 e §4.1). A chave deriva do id
// (uuid); nunca carrega nome de arquivo, extensao confiavel ou identificador de profissional.
import { ehIdentityDocUuid } from './body.js';

/** Objeto de entrada no bucket `identity-incoming`: `s/<uuid>`. */
export function identityDocIncomingKey(id: string): string {
  if (!ehIdentityDocUuid(id)) throw new Error('identity-docs: id invalido para chave de entrada');
  return `s/${id.toLowerCase()}`;
}

/** Objeto final no bucket `identity-docs`: `i/<uuid>`. */
export function identityDocFinalKey(id: string): string {
  if (!ehIdentityDocUuid(id)) throw new Error('identity-docs: id invalido para chave final');
  return `i/${id.toLowerCase()}`;
}
