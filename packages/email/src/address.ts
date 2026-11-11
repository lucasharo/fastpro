// H-093 | Enderecos de e-mail. Nenhum endereco real aparece aqui: o da conta vem de configuracao.
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+$/;

/** Remetente de teste do Resend (S-11). Aceito somente para o destinatario da conta do titular. */
export const RESEND_TEST_SENDER = 'onboarding@resend.dev';
export const RESEND_TEST_DOMAIN = 'resend.dev';

/** Endereco de "Nome <endereco>" ou "endereco", em minusculas. Null se malformado ou com quebra de linha. */
export function extractAddress(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '' || /[\r\n]/.test(text)) return null;
  const match = /<([^<>]+)>$/.exec(text);
  const candidate = (match ? match[1] : text) ?? '';
  return ADDRESS_RE.test(candidate) ? candidate.toLowerCase() : null;
}

export function isSafeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

export function normalizeDomain(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Igualdade exata (sem distinguir maiusculas) com endereco nao vazio. */
export function sameAddress(a: string, b: string | undefined): boolean {
  const right = (b ?? '').trim().toLowerCase();
  return right !== '' && a.trim().toLowerCase() === right;
}
