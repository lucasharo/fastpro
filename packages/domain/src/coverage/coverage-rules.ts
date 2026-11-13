// Issue 37 (H-024) | Cobertura booleana sem contagem: regras puras (docs/factory/99-DESENHO-H024.md, §2 e §4.1).
// Sem banco e sem rede. A decisao mora em private.coverage_for_request (migracao 20261113220000).
// Aqui ficam os unicos valores publicos (so "com" ou "sem"), os limites da entrada e o prazo do cache.

/** Resultados que o banco devolve. "limite" e "indisponivel" nunca viram valor publico (CA-08, CA-07). */
export const COVERAGE_RESULTS = ['com', 'sem', 'limite', 'indisponivel'] as const;
export type CoverageResult = (typeof COVERAGE_RESULTS)[number];

/** Unico valor de cobertura que sai ao cliente: existe ou nao existe (decisao 56; CA-01, CA-02). */
export type CoveragePublicValue = 'com' | 'sem';

/** Validade do cache por (servico, celula), em segundos (CA-06). */
export const COVERAGE_CACHE_TTL_S = 300;

/** Limites por hora [PROPOSTA] da 99 §2.2 (D-H024-9). A entrada valida o intervalo 1 a 10000. */
export const COVERAGE_LIMIT_IP_HOUR = 60;
export const COVERAGE_LIMIT_CUSTOMER_HOUR = 60;
export const COVERAGE_LIMIT_REQUEST_HOUR = 20;

export const COVERAGE_LIMIT_MIN = 1;
export const COVERAGE_LIMIT_MAX = 10000;

export function isCoverageResult(value: unknown): value is CoverageResult {
  return typeof value === 'string' && (COVERAGE_RESULTS as readonly string[]).includes(value);
}

/** Converte o resultado do banco no valor publico. Qualquer outro resultado nao e exibido como cobertura. */
export function coveragePublicValue(result: CoverageResult): CoveragePublicValue | null {
  if (result === 'com' || result === 'sem') return result;
  return null;
}

export function isValidCoverageLimit(limit: unknown): limit is number {
  return (
    typeof limit === 'number' &&
    Number.isInteger(limit) &&
    limit >= COVERAGE_LIMIT_MIN &&
    limit <= COVERAGE_LIMIT_MAX
  );
}

/** Chave de IP: HMAC em hexadecimal minusculo, 64 caracteres. Nunca o IP em claro (ADR-014). */
export function isValidCoverageIpKey(key: unknown): key is string {
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key);
}
