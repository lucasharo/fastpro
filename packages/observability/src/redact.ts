// Redacao automatica de PII e segredos em texto (ADR-013; P8; RF-163; B-41). Funciona como
// SEGUNDA barreira: a primeira e a allowlist de campos. Heuristica por padroes conhecidos.
// LIMITES (ver README): nome proprio e endereco livre nao sao detectaveis de forma confiavel.

interface Rule {
  readonly kind: string;
  readonly pattern: RegExp;
}

const SEP = String.raw`[\s.-]?`;
// H-014: code, secret e sid entram como chave (JSON e chave: valor). Codigo de 6 digitos e segredo de
// sessao nao podem sair em log (52 §5, item 5).
const PII_KEYS = String.raw`e-?mail|phone|telefone|celular|cpf|cnpj|nome|name|endereco|address|senha|password|token|segredo|secret|code|sid`;

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
  // JSON/objeto serializado: "email":"x", 'senha': 'x' -> o par inteiro.
  {
    kind: 'json-field',
    pattern: new RegExp(
      String.raw`["'](?:${PII_KEYS})["']\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)`,
      'gi',
    ),
  },
  // chave=valor (query string, cookie, env): sem espacos ao redor do sinal.
  {
    kind: 'query-secret',
    pattern:
      /\b(?:token|access_token|key|api_key|secret|password|senha|code|otp|session|sessionid|session_id|sid)=[^\s&"';,]+/gi,
  },
  // senha: x / password: x / token: x (dois-pontos, com espaco opcional).
  {
    kind: 'credential',
    pattern: /\b(?:senha|password|passwd|pwd|secret|segredo|token|session|sessao|code|sid)\s*:\s*[^\s,;]+/gi,
  },
  // E-mail ofuscado: "a [at] b [dot] c", "a (at) b.c", "a @ b.c" (espacos ao redor).
  {
    kind: 'email-obfuscated',
    pattern:
      /[A-Za-z0-9._%+-]+\s*(?:\[at\]|\(at\)|\{at\}|\s@\s|@\s|\s@)\s*[A-Za-z0-9-]+(?:\s*(?:\.|\[dot\]|\(dot\)|\{dot\})\s*[A-Za-z0-9-]+)+/gi,
  },
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    kind: 'cnpj',
    pattern: /(?<![\d.])\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s/]?\d{4}[\s-]?\d{2}(?![\d])/g,
  },
  { kind: 'cpf', pattern: /(?<![\d.])\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s-]?\d{2}(?![\d])/g },
  // Cartao de 15/16 digitos (com espacos ou hifens). Nao casa dentro de UUID/identificadores.
  { kind: 'card', pattern: /(?<![\w-])(?:\d[ -]?){14,15}\d(?![\w-])/g },
  {
    kind: 'phone',
    pattern: new RegExp(
      String.raw`(?<![\d])(?:\+?55${SEP})?0?\(?\d{2}\)?${SEP}9?${SEP}\d{4}${SEP}\d{4}(?![\d])`,
      'g',
    ),
  },
  // CEP: com hifen em qualquer lugar; sem hifen apenas depois da palavra "CEP".
  { kind: 'cep', pattern: /(?<![\d])\d{5}-\d{3}(?![\d])/g },
  { kind: 'cep', pattern: /\bcep\s*:?\s*\d{5}-?\d{3}(?![\d])/gi },
  // Endereco: logradouro + nome/numero ("Rua das Flores, 12", "R. das Flores, 12", "Av Paulista 1000").
  {
    kind: 'address',
    pattern:
      /\b(?:Rua|Avenida|Travessa|Alameda|Rodovia|Estrada|Praca|Praça|Largo)\s+[^;\n]{2,80}/gi,
  },
  {
    kind: 'address',
    pattern: /\b(?:R|Av|Tv|Al|Rod|Estr|Pça|Pc)\.?\s+[A-Za-zÀ-ú0-9][^;\n]{2,80}/g,
  },
  // Complemento: bloco B, apto 12, casa 3, conjunto 5, sala 7, andar 2, torre 1.
  {
    kind: 'address',
    pattern:
      /\b(?:bloco|bl|apartamento|apto|ap|casa|conjunto|cj|sala|andar|torre)\.?\s*[:#-]?\s*\d+[A-Za-z]?\b/gi,
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
