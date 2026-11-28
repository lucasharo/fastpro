// H-035 | Cifra e HMAC do documento do profissional (docs/factory/75-DESENHO-H035.md §1, §2 item 3).
// document_enc: AES-256-GCM no formato versao(1) | nonce(12) | tag(16) | texto. AAD = "doc1|<user_id>|document_enc",
// que amarra o blob ao dono. A chave ativa vem de DATA_ENC_KEY_ACTIVE_VERSION (DATA_ENC_KEY_V<n>, base64 de 32
// bytes); a versao vai no primeiro byte, o que permite rotacao sem reescrever tudo.
// O campo document_hmac recebe o HMAC-SHA-256 com DOCUMENT_HMAC_KEY sobre "doc1|<tipo>|<digitos>", em hexadecimal.
// Chave distinta da cifra.
// Nenhuma rota de H-035 decifra: open() existe para testes e para a leitura de H-039 (com registro de acesso).
// Erros carregam so um codigo fixo, nunca o valor de chave, documento ou blob.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { ProfessionalDocumentType } from '@fastpro/domain';

const FORMAT_PREFIX = 'doc1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const KEY_BYTES = 32;
const MAX_VERSION = 255;

export type ProfessionalDocumentCryptoCode = 'configuracao_cifra' | 'documento_indisponivel';

export class ProfessionalDocumentCryptoError extends Error {
  readonly code: ProfessionalDocumentCryptoCode;
  constructor(code: ProfessionalDocumentCryptoCode) {
    super(code);
    this.name = 'ProfessionalDocumentCryptoError';
    this.code = code;
  }
}

/** O que a rota de cadastro precisa: cifrar para o dono e calcular o identificador de unicidade. */
export interface ProfessionalDocumentSecrets {
  encrypt(userId: string, digits: string): Buffer;
  hmac(documentType: ProfessionalDocumentType, digits: string): string;
}

/** Vault completo: inclui a decifragem (so para testes e para H-039). */
export interface ProfessionalDocumentVault extends ProfessionalDocumentSecrets {
  open(userId: string, blob: Buffer): string;
  readonly activeVersion: number;
}

export interface ProfessionalDocumentKeys {
  readonly hmacKey: Buffer;
  readonly activeVersion: number;
  /** Chaves de cifra por versao. A ativa precisa existir; as antigas servem para decifrar blobs antigos. */
  readonly encKeys: ReadonlyMap<number, Buffer>;
}

function decodificarChave(raw: string | undefined): Buffer {
  if (raw === undefined || raw.trim() === '') throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  const chave = Buffer.from(raw.trim(), 'base64');
  if (chave.length !== KEY_BYTES) throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  return chave;
}

function aadDoDocumento(userId: string): string {
  return `${FORMAT_PREFIX}|${userId}|document_enc`;
}

/** Monta o vault a partir de chaves ja lidas (usado pelo carregador do ambiente e pelos testes). */
export function createProfessionalDocumentVault(keys: ProfessionalDocumentKeys): ProfessionalDocumentVault {
  const { hmacKey, activeVersion, encKeys } = keys;
  if (hmacKey.length !== KEY_BYTES) throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  if (!Number.isInteger(activeVersion) || activeVersion < 1 || activeVersion > MAX_VERSION) {
    throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  }
  const ativa = encKeys.get(activeVersion);
  if (ativa === undefined || ativa.length !== KEY_BYTES) {
    throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  }

  return {
    activeVersion,
    encrypt(userId: string, digits: string): Buffer {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', ativa, nonce);
      cipher.setAAD(Buffer.from(aadDoDocumento(userId), 'utf8'));
      const corpo = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([activeVersion]), nonce, cipher.getAuthTag(), corpo]);
    },
    open(userId: string, blob: Buffer): string {
      if (blob.length < HEADER_BYTES) throw new ProfessionalDocumentCryptoError('documento_indisponivel');
      const chave = encKeys.get(blob[0] ?? 0);
      if (chave === undefined) throw new ProfessionalDocumentCryptoError('documento_indisponivel');
      const nonce = blob.subarray(1, 1 + NONCE_BYTES);
      const tag = blob.subarray(1 + NONCE_BYTES, HEADER_BYTES);
      const corpo = blob.subarray(HEADER_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', chave, nonce);
        decipher.setAAD(Buffer.from(aadDoDocumento(userId), 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(corpo), decipher.final()]).toString('utf8');
      } catch {
        throw new ProfessionalDocumentCryptoError('documento_indisponivel');
      }
    },
    hmac(documentType: ProfessionalDocumentType, digits: string): string {
      if (!/^[0-9]+$/.test(digits)) throw new ProfessionalDocumentCryptoError('documento_indisponivel');
      return createHmac('sha256', hmacKey)
        .update(`${FORMAT_PREFIX}|${documentType}|${digits}`, 'utf8')
        .digest('hex');
    },
  };
}

/**
 * Le DOCUMENT_HMAC_KEY, DATA_ENC_KEY_ACTIVE_VERSION e as chaves DATA_ENC_KEY_V<n> do ambiente.
 * Ausente ou invalida = erro de configuracao, sem valor. Chaves nunca entram em erro ou log.
 */
export function loadProfessionalDocumentVault(env: NodeJS.ProcessEnv = process.env): ProfessionalDocumentVault {
  const hmacKey = decodificarChave(env.DOCUMENT_HMAC_KEY);
  const versaoBruta = (env.DATA_ENC_KEY_ACTIVE_VERSION ?? '').trim();
  if (!/^[1-9][0-9]{0,2}$/.test(versaoBruta)) throw new ProfessionalDocumentCryptoError('configuracao_cifra');
  const activeVersion = Number(versaoBruta);
  if (activeVersion > MAX_VERSION) throw new ProfessionalDocumentCryptoError('configuracao_cifra');

  const encKeys = new Map<number, Buffer>();
  for (const [nome, valor] of Object.entries(env)) {
    const m = /^DATA_ENC_KEY_V([1-9][0-9]{0,2})$/.exec(nome);
    if (m === null || valor === undefined) continue;
    const versao = Number(m[1]);
    if (versao <= MAX_VERSION) encKeys.set(versao, decodificarChave(valor));
  }
  return createProfessionalDocumentVault({ hmacKey, activeVersion, encKeys });
}
