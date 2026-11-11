// H-093 | Chave de idempotencia enviada ao provedor. Sempre hash, nunca a chave original (desenho 37 §4.3).
import { createHash } from 'node:crypto';

export function idempotencyToken(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
