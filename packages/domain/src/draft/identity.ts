// H-013 (Issue #26) | Identificacao do rascunho: primeiro nome e e-mail (docs/factory/91-DESENHO-H013.md, §1.5).
// Logica pura, sem I/O. O HMAC do e-mail e feito na composicao (PEPPER_EMAIL_HMAC), nunca aqui.
// Corpo PUT: so as chaves first_name e email; as duas sao obrigatorias (ausente = invalido). Qualquer falha
// recusa o pedido inteiro, sem gravar. Mensagens de erro tem so o codigo fixo; o valor nunca sai.
import { ChallengeInputError, EMAIL_SHAPE_RE, normalizeChallengeEmail } from '../identity/challenge.js';

/** Corpo do PUT de identificacao: no maximo 2 KB (91 §1.5). */
export const IDENTITY_BODY_LIMIT_BYTES = 2 * 1024;
export const IDENTITY_FIELDS = ['first_name', 'email'] as const;
export const IDENTITY_FIRST_NAME_MIN = 2;
export const IDENTITY_FIRST_NAME_MAX = 60;
export const IDENTITY_EMAIL_MAX = 254;
/** Letras Unicode, espaco, apostrofo (ASCII ou tipográfico) e hifen; comeca por letra. */
const NOME_RE = /^\p{L}[\p{L} '\u2019-]*$/u;
const CONTROLE_RE = /\p{Cc}/u;

export interface IdentityFields {
  readonly first_name: string;
  readonly email: string;
}

export type IdentityBodyErrorCode =
  | 'corpo_grande'
  | 'corpo_invalido'
  | 'campo_desconhecido'
  | 'vazio'
  | 'nome_invalido'
  | 'email_invalido';

export type IdentityBodyResult =
  | { readonly ok: true; readonly fields: IdentityFields }
  | { readonly ok: false; readonly status: 413 | 422; readonly code: IdentityBodyErrorCode };

/** Primeiro nome: aparado, NFC, 2 a 60 caracteres, so letras, espaco, apostrofo e hifen. */
export function normalizeFirstName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const texto = value.normalize('NFC').trim();
  if (CONTROLE_RE.test(texto)) return null;
  const n = [...texto].length;
  if (n < IDENTITY_FIRST_NAME_MIN || n > IDENTITY_FIRST_NAME_MAX) return null;
  return NOME_RE.test(texto) ? texto : null;
}

/** E-mail: normalizado (aparado, minusculas), ate 254 caracteres e com a forma minima. */
export function normalizeIdentityEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let email: string;
  try {
    email = normalizeChallengeEmail(value);
  } catch (erro) {
    if (erro instanceof ChallengeInputError) return null;
    throw erro;
  }
  if (email.length > IDENTITY_EMAIL_MAX || !EMAIL_SHAPE_RE.test(email)) return null;
  return email;
}

/** Confere o corpo ja lido. Acima de 2 KB: 413. Chave fora de first_name/email: 422. Corpo sem chaves: 422 vazio. */
export function parseIdentityBody(text: string, byteLength: number): IdentityBodyResult {
  if (byteLength > IDENTITY_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const obj = raw as Record<string, unknown>;
  const chaves = Object.keys(obj);
  if (chaves.some((k) => !(IDENTITY_FIELDS as readonly string[]).includes(k))) {
    return { ok: false, status: 422, code: 'campo_desconhecido' };
  }
  if (chaves.length === 0) return { ok: false, status: 422, code: 'vazio' };

  const nome = normalizeFirstName(obj['first_name']);
  if (nome === null) return { ok: false, status: 422, code: 'nome_invalido' };
  const email = normalizeIdentityEmail(obj['email']);
  if (email === null) return { ok: false, status: 422, code: 'email_invalido' };
  return { ok: true, fields: { first_name: nome, email } };
}
