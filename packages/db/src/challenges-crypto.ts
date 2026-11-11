// H-011 | Cifra, HMAC e aleatoriedade do desafio de acesso (docs/factory/39-DESENHO-H011.md, §2 e §5.1).
// AES-256-GCM com formato versao(1) | nonce(12) | tag(16) | texto. AAD = "ac1|<id>|<coluna>".
// A chave AUTH_CHALLENGE_KEY (32 bytes, base64) so existe no servidor. Nenhum erro carrega valores.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { formatChallengeCode } from '@fastpro/domain';

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const KEY_BYTES = 32;

export type ChallengeCryptoCode = 'configuracao_cifra' | 'segredo_indisponivel';

export class ChallengeCryptoError extends Error {
  readonly code: ChallengeCryptoCode;
  constructor(code: ChallengeCryptoCode) {
    super(code);
    this.name = 'ChallengeCryptoError';
    this.code = code;
  }
}

/** Le AUTH_CHALLENGE_KEY (base64 de 32 bytes). Ausente ou invalida = erro de configuracao, sem valor. */
export function loadChallengeKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.AUTH_CHALLENGE_KEY;
  if (raw === undefined || raw.trim() === '') throw new ChallengeCryptoError('configuracao_cifra');
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new ChallengeCryptoError('configuracao_cifra');
  return key;
}

/** AAD que amarra o blob ao desafio e a coluna: trocar um pelo outro falha na decifragem. */
export function challengeAad(challengeId: string, column: 'email_enc' | 'secrets_enc'): string {
  return `ac1|${challengeId}|${column}`;
}

export function sealChallengeBlob(key: Buffer, plain: string, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), body]);
}

export function openChallengeBlob(key: Buffer, blob: Buffer, aad: string): string {
  if (blob.length < HEADER_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new ChallengeCryptoError('segredo_indisponivel');
  }
  const nonce = blob.subarray(1, 1 + NONCE_BYTES);
  const tag = blob.subarray(1 + NONCE_BYTES, HEADER_BYTES);
  const body = blob.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new ChallengeCryptoError('segredo_indisponivel');
  }
}

/** HMAC-SHA256 em hexadecimal (64 caracteres). Usado com PEPPER_EMAIL_HMAC e PEPPER_CODE_HMAC. */
export function challengeHmacHex(pepper: string, input: string): string {
  return createHmac('sha256', pepper).update(input, 'utf8').digest('hex');
}

/** SHA-256 em hexadecimal, para o hash do token (token_hash). */
export function challengeSha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Token do link: 256 bits aleatorios em base64url. */
export function generateChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Codigo de 6 digitos sem vies de modulo (randomInt do node). */
export function generateChallengeCode(): string {
  return formatChallengeCode(randomInt(0, 1_000_000));
}
