// Issue 45 (H-032) | Cifra do endereco do pedido (docs/factory/127-DESENHO-H032.md, §3; decisoes 404 a 406).
// address_text_enc: AES-256-GCM no formato versao(1) | nonce(12) | tag(16) | texto. AAD = "addr1|<request_id>",
// que amarra o blob ao pedido (troca de linha falha). A chave AES de 32 bytes sai de ADDRESS_ENC_KEY por HKDF-SHA-256
// (salt "fastpro-address-v1", info "service_request.address_text"). Sem rotacao nesta fase: o byte de versao reserva o futuro.
// Erros carregam so um codigo fixo, nunca o texto, a chave nem o blob.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const FORMAT_PREFIX = 'addr1';
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const KEY_BYTES = 32;
const CHAVE_MIN_CHARS = 32;
const TEXTO_MIN = 3;
const TEXTO_MAX = 200;
const HKDF_SALT = 'fastpro-address-v1';
const HKDF_INFO = 'service_request.address_text';

export type AddressCryptoCode = 'configuracao_cifra' | 'endereco_invalido' | 'endereco_indisponivel';

export class AddressCryptoError extends Error {
  readonly code: AddressCryptoCode;
  constructor(code: AddressCryptoCode) {
    super(code);
    this.name = 'AddressCryptoError';
    this.code = code;
  }
}

export interface AddressVault {
  /** Cifra o endereco para o pedido indicado. Devolve o blob que vai para address_text_enc. */
  seal(texto: string, requestId: string): Buffer;
  /** Decifra. Qualquer falha (AAD, byte alterado, versao, chave) vira endereco_indisponivel. */
  open(blob: Uint8Array, requestId: string): string;
}

function aad(requestId: string): Buffer {
  return Buffer.from(`${FORMAT_PREFIX}|${requestId}`, 'utf8');
}

function derivarChave(rawKey: string): Buffer {
  const ikm = Buffer.from(rawKey, 'utf8');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(HKDF_SALT, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), KEY_BYTES));
}

/** Monta o cofre a partir da chave em texto (ADDRESS_ENC_KEY). Chave ausente ou curta = configuracao invalida. */
export function createAddressVault(rawKey: string): AddressVault {
  if (typeof rawKey !== 'string' || rawKey.length < CHAVE_MIN_CHARS) {
    throw new AddressCryptoError('configuracao_cifra');
  }
  const chave = derivarChave(rawKey);

  return {
    seal(texto: string, requestId: string): Buffer {
      const normalizado = texto.normalize('NFC');
      const tamanho = [...normalizado].length;
      if (tamanho < TEXTO_MIN || tamanho > TEXTO_MAX) throw new AddressCryptoError('endereco_invalido');
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', chave, nonce);
      cipher.setAAD(aad(requestId));
      const corpo = Buffer.concat([cipher.update(normalizado, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), corpo]);
    },
    open(blob: Uint8Array, requestId: string): string {
      const bytes = Buffer.from(blob);
      if (bytes.length <= HEADER_BYTES || bytes[0] !== VERSION) {
        throw new AddressCryptoError('endereco_indisponivel');
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
        throw new AddressCryptoError('endereco_indisponivel');
      }
    },
  };
}
