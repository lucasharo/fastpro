// H-021 | HMAC do endereco normalizado (docs/factory/68-DESENHO-H021.md, §2.1 address_hash).
// Chave propria, lida do ambiente pela composicao no nome ADDRESS_HASH_KEY (nunca reutiliza PEPPER_*).
// Somente servidor. O texto em claro nunca sai desta funcao; so o hexadecimal de 64 caracteres.
import { createHmac } from 'node:crypto';

export const ADDRESS_HASH_KEY_ENV = 'ADDRESS_HASH_KEY' as const;
/** Tamanho minimo da chave em caracteres (256 bits em base 16 ou equivalente). Abaixo disso, recusa. */
export const ADDRESS_HASH_KEY_MIN_LENGTH = 32;

/**
 * Devolve a funcao de hash. Chave ausente ou curta: erro na composicao, antes de qualquer publicacao
 * (equivalente a breaker fechado: nenhuma coordenada e gravada sem uma chave valida).
 */
export function createAddressHasher(key: string): (normalizedKey: string) => string {
  if (key.length < ADDRESS_HASH_KEY_MIN_LENGTH) {
    throw new Error('chave_hash_endereco_invalida');
  }
  return (normalizedKey: string) =>
    createHmac('sha256', key).update(normalizedKey, 'utf8').digest('hex');
}
