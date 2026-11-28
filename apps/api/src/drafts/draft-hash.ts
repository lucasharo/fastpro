// H-025 | Hash do rascunho (docs/factory/74-DESENHO-H025.md, §1 e §2, R1, R3).
// O banco guarda so o SHA-256 do segredo do cookie; o IP so entra como HMAC com chave propria
// (lida pela composicao, nunca reutiliza outra chave). Somente servidor. Segredo sem o hash, nunca.
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Tamanho minimo da chave do HMAC do IP (256 bits em base 16 ou equivalente). */
export const DRAFT_IP_KEY_MIN_LENGTH = 32;

export interface DraftHasher {
  /** SHA-256 em hexadecimal (64 caracteres) do segredo do cookie. */
  secretHash(secret: string): string;
  /** HMAC-SHA256 em hexadecimal do IP normalizado. O IP em claro nao sai daqui. */
  ipHmac(ip: string): string;
}

/** Recusa chave curta na composicao: sem chave valida nao ha limite por IP. */
export function createDraftHasher(ipKey: string): DraftHasher {
  if (ipKey.length < DRAFT_IP_KEY_MIN_LENGTH) throw new Error('chave_hmac_rascunho_invalida');
  return {
    secretHash: (secret) => createHash('sha256').update(secret, 'utf8').digest('hex'),
    ipHmac: (ip) => createHmac('sha256', ipKey).update(ip, 'utf8').digest('hex'),
  };
}

/** Segredo novo do rascunho: 256 bits aleatorios em base64url (43 caracteres), so no servidor. */
export function newDraftSecret(): string {
  return randomBytes(32).toString('base64url');
}
