// H-035 | Validacao pura do documento (CPF ou CNPJ) e do nome publico do perfil profissional
// (docs/factory/75-DESENHO-H035.md §1; CA-01 a CA-04). Sem banco, sem rede e sem cifra.
// Nenhum resultado carrega o numero digitado: so o campo e o motivo fixo.

export type ProfessionalDocumentType = 'CPF' | 'CNPJ';

export type ProfessionalFieldName = 'publicName' | 'documentType' | 'document';

export type ProfessionalFieldReason =
  | 'obrigatorio'
  | 'tamanho'
  | 'formato'
  | 'tipo_invalido'
  | 'sequencia_repetida'
  | 'digito_verificador';

export interface ProfessionalFieldError {
  readonly field: ProfessionalFieldName;
  readonly reason: ProfessionalFieldReason;
}

export type ProfessionalDocumentCheck =
  | { readonly ok: true; readonly digits: string }
  | { readonly ok: false; readonly reason: ProfessionalFieldReason };

export interface ProfessionalProfileInput {
  readonly publicName: string;
  readonly documentType: ProfessionalDocumentType;
  /** Somente digitos (sem mascara). Nunca vai para log, resposta ou erro. */
  readonly digits: string;
}

export type ProfessionalProfileInputCheck =
  | { readonly ok: true; readonly value: ProfessionalProfileInput }
  | { readonly ok: false; readonly fields: readonly ProfessionalFieldError[] };

/** Tamanho do nome publico apos trim, em caracteres (D7 do desenho H-035). */
export const PUBLIC_NAME_MIN = 2;
export const PUBLIC_NAME_MAX = 80;

const DIGITS_BY_TYPE: Readonly<Record<ProfessionalDocumentType, number>> = { CPF: 11, CNPJ: 14 };

/** Pesos do primeiro e do segundo digito verificador do CNPJ (Receita Federal). */
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Remove so a mascara (ponto, traco, barra e espaco). Qualquer outro caractere e recusado depois. */
export function stripDocumentMask(raw: string): string {
  return raw.replace(/[.\-/\s]/g, '');
}

function digitoCpf(numeros: readonly number[], base: number): number {
  let soma = 0;
  for (let i = 0; i < base; i++) soma += (numeros[i] ?? 0) * (base + 1 - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function digitoCnpj(numeros: readonly number[], pesos: readonly number[]): number {
  const soma = pesos.reduce((acc, peso, i) => acc + peso * (numeros[i] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Confere CPF (11 digitos) ou CNPJ (14 digitos) ja sem mascara. */
export function checkProfessionalDocument(
  type: ProfessionalDocumentType,
  raw: unknown,
): ProfessionalDocumentCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'formato' };
  const digits = stripDocumentMask(raw);
  if (!/^[0-9]+$/.test(digits)) return { ok: false, reason: 'formato' };
  if (digits.length !== DIGITS_BY_TYPE[type]) return { ok: false, reason: 'tamanho' };
  if (/^(\d)\1+$/.test(digits)) return { ok: false, reason: 'sequencia_repetida' };

  const numeros = Array.from(digits, Number);
  if (type === 'CPF') {
    const ok = digitoCpf(numeros, 9) === numeros[9] && digitoCpf(numeros, 10) === numeros[10];
    return ok ? { ok: true, digits } : { ok: false, reason: 'digito_verificador' };
  }
  const ok =
    digitoCnpj(numeros, PESOS_CNPJ_1) === numeros[12] &&
    digitoCnpj(numeros.slice(0, 13), PESOS_CNPJ_2) === numeros[13];
  return ok ? { ok: true, digits } : { ok: false, reason: 'digito_verificador' };
}

/** Nome publico: texto, com trim, entre PUBLIC_NAME_MIN e PUBLIC_NAME_MAX caracteres. */
export function checkPublicName(raw: unknown): { ok: true; value: string } | { ok: false; reason: ProfessionalFieldReason } {
  if (typeof raw !== 'string') return { ok: false, reason: 'obrigatorio' };
  const value = raw.trim();
  if (value === '') return { ok: false, reason: 'obrigatorio' };
  const tamanho = [...value].length;
  if (tamanho < PUBLIC_NAME_MIN || tamanho > PUBLIC_NAME_MAX) return { ok: false, reason: 'tamanho' };
  return { ok: true, value };
}

/** Base do identificador de URL (slug): sem acento, minusculo, so [a-z0-9] separado por traco. */
export function slugBaseFromName(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base === '' ? 'profissional' : base;
}

/** Forma do corpo de PUT /v1/professional/profile: { publicName, documentType, document }. */
export function checkProfessionalProfileInput(body: unknown): ProfessionalProfileInputCheck {
  const dados = (body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<
    string,
    unknown
  >;
  const fields: ProfessionalFieldError[] = [];

  const nome = checkPublicName(dados.publicName);
  if (!nome.ok) fields.push({ field: 'publicName', reason: nome.reason });

  const tipo = dados.documentType;
  const tipoValido = tipo === 'CPF' || tipo === 'CNPJ';
  if (!tipoValido) fields.push({ field: 'documentType', reason: 'tipo_invalido' });

  if (tipoValido) {
    const doc = checkProfessionalDocument(tipo, dados.document);
    if (!doc.ok) fields.push({ field: 'document', reason: doc.reason });
    if (nome.ok && doc.ok) {
      return {
        ok: true,
        value: { publicName: nome.value, documentType: tipo, digits: doc.digits },
      };
    }
  }
  return { ok: false, fields };
}
