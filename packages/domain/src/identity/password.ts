// H-016 | Politica de senha do profissional (docs/factory/33-DESENHO-H016.md §3.1; CA-H016-03, CA-H016-04).
// Logica pura, sem I/O e sem log: a senha nunca sai desta funcao e nao e devolvida nem registrada.
// A conferencia da senha e feita pelo Supabase Auth; aqui fica a regra da primeira barreira.
import { PROFESSIONAL_COMMON_PASSWORDS } from './common-passwords.js';

/** Minimo de caracteres (contados por ponto de codigo Unicode). Decisao D-H016-4 e do usuario. */
export const PROFESSIONAL_PASSWORD_MIN_CHARS = 8;
/** Teto em bytes UTF-8 (limite do bcrypt usado pelo Auth; 33 §3.1, R-H016-12). */
export const PROFESSIONAL_PASSWORD_MAX_BYTES = 72;

/** Motivo da recusa. Nenhum motivo contem a senha. */
export type ProfessionalPasswordProblem = 'tipo' | 'curta' | 'longa' | 'controle' | 'igual_email' | 'comum';

const CONTROLE_RE = /\p{Cc}/u;

/** Bytes UTF-8 de uma string, sem depender de TextEncoder (logica pura, portavel). */
function utf8Bytes(texto: string): number {
  let total = 0;
  for (const ch of texto) {
    const cp = ch.codePointAt(0) ?? 0;
    total += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return total;
}

/**
 * Valida a senha escolhida no cadastro ou na troca. Devolve null quando a senha passa.
 * Ordem: tipo, tamanho minimo, teto de bytes, caracteres de controle, igual ao e-mail, lista de comuns.
 */
export function professionalPasswordProblem(
  password: unknown,
  email: string,
): ProfessionalPasswordProblem | null {
  if (typeof password !== 'string') return 'tipo';
  if (Array.from(password).length < PROFESSIONAL_PASSWORD_MIN_CHARS) return 'curta';
  if (utf8Bytes(password) > PROFESSIONAL_PASSWORD_MAX_BYTES) return 'longa';
  if (CONTROLE_RE.test(password)) return 'controle';
  const minuscula = password.toLowerCase();
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return 'igual_email';
  if (PROFESSIONAL_COMMON_PASSWORDS.has(minuscula)) return 'comum';
  return null;
}
