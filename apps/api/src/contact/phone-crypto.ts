// Issue 46 (H-033) | Cifra de phone_enc do pedido (docs/factory/129-DESENHO-H033.md, §3; decisoes 438 e 443 a 445).
// phone_enc: AES-256-GCM no formato versao(1) | nonce(12) | tag(16) | texto. AAD = "ph1|<request_id>", que amarra o blob
// ao pedido (troca de linha falha). A chave AES de 32 bytes sai de PHONE_ENC_KEY por HKDF-SHA-256
// (salt "fastpro-phone-v1", info "service_request.phone_enc"). Chave separada da do endereco (ADDRESS_ENC_KEY).
// Sem rotacao nesta fase: o byte de versao reserva o futuro. Erros carregam so um codigo fixo, nunca o numero,
// a chave nem o blob.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { normalizePhoneBr } from '@fastpro/domain';

const FORMAT_PREFIX = 'ph1';
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const KEY_BYTES = 32;
const CHAVE_MIN_CHARS = 32;
const HKDF_SALT = 'fastpro-phone-v1';
const HKDF_INFO = 'service_request.phone_enc';

export type PhoneCryptoCode = 'configuracao_cifra' | 'telefone_invalido' | 'telefone_indisponivel';

export class PhoneCryptoError extends Error {
  readonly code: PhoneCryptoCode;
  constructor(code: PhoneCryptoCode) {
    super(code);
    this.name = 'PhoneCryptoError';
    this.code = code;
  }
}

export interface PhoneVault {
  /** Cifra um telefone ja normalizado em E.164 para o pedido indicado. Devolve o blob que vai para phone_enc. */
  seal(e164: string, requestId: string): Buffer;
  /** Decifra. Qualquer falha (AAD, byte alterado, versao, chave) vira telefone_indisponivel. */
  open(blob: Uint8Array, requestId: string): string;
}

function aad(requestId: string): Buffer {
  return Buffer.from(`${FORMAT_PREFIX}|${requestId}`, 'utf8');
}

function derivarChave(rawKey: string): Buffer {
  const ikm = Buffer.from(rawKey, 'utf8');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(HKDF_SALT, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), KEY_BYTES));
}

/** Monta o cofre a partir da chave em texto (PHONE_ENC_KEY). Chave ausente ou curta = configuracao invalida. */
export function createPhoneVault(rawKey: string): PhoneVault {
  if (typeof rawKey !== 'string' || rawKey.length < CHAVE_MIN_CHARS) {
    throw new PhoneCryptoError('configuracao_cifra');
  }
  const chave = derivarChave(rawKey);

  return {
    seal(e164: string, requestId: string): Buffer {
      if (normalizePhoneBr(e164) !== e164) throw new PhoneCryptoError('telefone_invalido');
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', chave, nonce);
      cipher.setAAD(aad(requestId));
      const corpo = Buffer.concat([cipher.update(e164, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), corpo]);
    },
    open(blob: Uint8Array, requestId: string): string {
      const bytes = Buffer.from(blob);
      if (bytes.length <= HEADER_BYTES || bytes[0] !== VERSION) {
        throw new PhoneCryptoError('telefone_indisponivel');
      }
      const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
      const tag = bytes.subarray(1 + NONCE_BYTES, HEADER_BYTES);
      const corpo = bytes.subarray(HEADER_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', chave, nonce);
        decipher.setAAD(aad(requestId));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(corpo), decipher.final()]).toString('utf8');
      } catch {
        throw new PhoneCryptoError('telefone_indisponivel');
      }
    },
  };
}
