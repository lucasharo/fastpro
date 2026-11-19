// Issue 68 (H-055) | Cursor opaco da descoberta: AES-256-GCM com chave HKDF-SHA-256, AAD ligada ao profissional,
// validade de 24 h e um unico codigo de recusa (docs/factory/153-DESENHO-H055.md, §4; decisoes 604 a 606).
// So node:crypto; a chave chega por parametro (DISCOVERY_CURSOR_KEY e lida pela composicao, nunca aqui).
//
// Formato: base64url( 0x01 | nonce(12) | tag(16) | cifrado ). Payload cifrado: JSON {"g","k","id","iat"}.
// AAD = "cur1|" + professionalId, o que impede usar o cursor de um profissional em outro.
// Qualquer falha de leitura lanca o mesmo codigo fixo, sem dizer o motivo e sem eco do token.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { isValidDiscoveryCursor, type DiscoveryCursor } from './discovery-rules.js';

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const KEY_BYTES = 32;
const CHAVE_MIN_CHARS = 32;
const TOKEN_MAX_CHARS = 512;
const CLOCK_SKEW_MS = 60_000;
export const DISCOVERY_CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const HKDF_SALT = 'fastpro-discovery-cursor-v1';
const HKDF_INFO = 'cursor-aead';
const AAD_PREFIX = 'cur1|';
const PAYLOAD_KEYS = ['g', 'k', 'id', 'iat'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 'cursor_invalido' para qualquer recusa de leitura; 'configuracao_cursor' so na montagem (chave ausente ou curta). */
export type DiscoveryCursorCode = 'cursor_invalido' | 'configuracao_cursor';

export class DiscoveryCursorError extends Error {
  readonly code: DiscoveryCursorCode;
  constructor(code: DiscoveryCursorCode) {
    super(code);
    this.name = 'DiscoveryCursorError';
    this.code = code;
  }
}

export interface DiscoveryCursorCodec {
  /** Cifra o cursor para o profissional, com iat = atMs (instante unico da requisicao). */
  seal(cursor: DiscoveryCursor, professionalId: string, atMs: number): string;
  /** Decifra e valida. Qualquer falha (formato, tag, AAD, versao, tipos, idade) vira cursor_invalido. */
  open(token: unknown, professionalId: string, atMs: number): DiscoveryCursor;
}

function derivarChave(rawKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(rawKey, 'utf8'), Buffer.from(HKDF_SALT, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), KEY_BYTES),
  );
}

function aad(professionalId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${professionalId}`, 'utf8');
}

function recusa(): DiscoveryCursorError {
  return new DiscoveryCursorError('cursor_invalido');
}

/** Monta o codec a partir da chave em texto. Chave ausente ou com menos de 32 caracteres falha ao montar. */
export function createDiscoveryCursorCodec(rawKey: string): DiscoveryCursorCodec {
  if (typeof rawKey !== 'string' || rawKey.length < CHAVE_MIN_CHARS) {
    throw new DiscoveryCursorError('configuracao_cursor');
  }
  const chave = derivarChave(rawKey);

  return {
    seal(cursor: DiscoveryCursor, professionalId: string, atMs: number): string {
      if (
        !isValidDiscoveryCursor(cursor) ||
        !UUID_PATTERN.test(cursor.requestId) ||
        typeof professionalId !== 'string' ||
        professionalId.length === 0 ||
        !Number.isSafeInteger(atMs)
      ) {
        throw recusa();
      }
      const plain = Buffer.from(
        JSON.stringify({ g: cursor.group, k: cursor.key, id: cursor.requestId, iat: atMs }),
        'utf8',
      );
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', chave, nonce);
      cipher.setAAD(aad(professionalId));
      const corpo = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), corpo]).toString('base64url');
    },

    open(token: unknown, professionalId: string, atMs: number): DiscoveryCursor {
      if (
        typeof token !== 'string' ||
        token.length === 0 ||
        token.length > TOKEN_MAX_CHARS ||
        !BASE64URL_PATTERN.test(token) ||
        typeof professionalId !== 'string' ||
        professionalId.length === 0 ||
        !Number.isSafeInteger(atMs)
      ) {
        throw recusa();
      }
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.length <= HEADER_BYTES || bytes.toString('base64url') !== token || bytes[0] !== VERSION) {
        throw recusa();
      }
      const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
      const tag = bytes.subarray(1 + NONCE_BYTES, HEADER_BYTES);
      const corpo = bytes.subarray(HEADER_BYTES);

      let plain: Buffer;
      try {
        const decipher = createDecipheriv('aes-256-gcm', chave, nonce);
        decipher.setAAD(aad(professionalId));
        decipher.setAuthTag(tag);
        plain = Buffer.concat([decipher.update(corpo), decipher.final()]);
      } catch {
        throw recusa();
      }

      const payload = parsePayload(plain);
      const idadeMs = atMs - payload.iat;
      if (idadeMs < -CLOCK_SKEW_MS || idadeMs > DISCOVERY_CURSOR_TTL_MS) throw recusa();
      return { group: payload.g, key: payload.k, requestId: payload.id };
    },
  };
}

interface CursorPayload {
  readonly g: 0 | 1;
  readonly k: number;
  readonly id: string;
  readonly iat: number;
}

/** Confere o JSON decifrado com tipos exatos e chaves fechadas. Qualquer desvio vira cursor_invalido. */
function parsePayload(plain: Buffer): CursorPayload {
  let json: unknown;
  try {
    json = JSON.parse(plain.toString('utf8'));
  } catch {
    throw recusa();
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw recusa();
  const obj = json as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key) => keys.includes(key))) throw recusa();

  const { g, k, id, iat } = obj;
  if (g !== 0 && g !== 1) throw recusa();
  if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 0) throw recusa();
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw recusa();
  if (typeof iat !== 'number' || !Number.isSafeInteger(iat)) throw recusa();
  return { g, k, id, iat };
}
