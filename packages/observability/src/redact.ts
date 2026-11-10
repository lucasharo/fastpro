// Redacao automatica de PII e segredos em texto (ADR-013; P8; RF-163; B-41). Funciona como
// SEGUNDA barreira: a primeira e a allowlist de campos. Heuristica por padroes conhecidos.

interface Rule {
  readonly kind: string;
  readonly pattern: RegExp;
}

// A ordem importa: padroes mais especificos primeiro.
const RULES: readonly Rule[] = [
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'header', pattern: /\b(?:authorization|cookie|set-cookie|x-api-key)\s*[:=][^\n]*/gi },
  { kind: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  {
    kind: 'secret',
    pattern:
      /\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9+/=_-]{8,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:APP_USR|TEST)-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})/g,
  },
  { kind: 'url-credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@]+@/gi },
  {
    kind: 'query-secret',
    pattern: /\b(?:token|access_token|key|api_key|secret|password|senha|code|otp)=[^\s&"']+/gi,
  },
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    kind: 'cnpj',
    pattern: /(?<![\d.])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g,
  },
  { kind: 'cpf', pattern: /(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d])/g },
  {
    kind: 'phone',
    pattern: /(?<![\d])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\d])/g,
  },
  { kind: 'cep', pattern: /(?<![\d])\d{5}-\d{3}(?![\d])/g },
  {
    kind: 'address',
    pattern: /\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Rodovia|Estrada|Praca|Praça)\s+[^,;\n]{3,}/gi,
  },
  { kind: 'hex-secret', pattern: /(?<![0-9A-Fa-f])[0-9A-Fa-f]{32,}(?![0-9A-Fa-f])/g },
];

/** Substitui trechos sensiveis por [REDACTED:tipo]. */
export function redactText(input: string): string {
  let out = input;
  for (const { kind, pattern } of RULES) {
    out = out.replace(pattern, `[REDACTED:${kind}]`);
  }
  return out;
}

/** Tipos de PII/segredo encontrados no texto (vazio = limpo). Usado na varredura de logs de teste. */
export function findPii(text: string): string[] {
  const kinds = new Set<string>();
  for (const { kind, pattern } of RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) kinds.add(kind);
    pattern.lastIndex = 0;
  }
  return [...kinds];
}
