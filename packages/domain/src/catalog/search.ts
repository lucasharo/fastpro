// H-019 | Busca de servico com sinonimos (docs/factory/64-DESENHO-H019.md, §1.2, §2, §3.1, §3.2, §3.4).
// Logica pura, sem I/O. A ordenacao, a normalizacao de acento/caixa e a busca em si ficam no banco
// (private.catalog_search). Aqui: entrada (2..80), corpo (so {q}, 1 KB), projecao por lista de permissao
// (7 campos) e formato da resposta. O termo digitado nunca entra em log, erro ou resposta.

export const CATALOG_SEARCH_PATH = '/v1/catalog/service-search' as const;

/** Corpo do pedido: 1 KB (desenho §3.1). */
export const CATALOG_SEARCH_BODY_LIMIT_BYTES = 1024;
export const CATALOG_SEARCH_QUERY_MIN = 2;
export const CATALOG_SEARCH_QUERY_MAX = 80;
/** Limite de resultados (desenho §1.2 e §3.2): constante da funcao no banco e teto aqui. */
export const CATALOG_SEARCH_RESULTS_MAX = 10;
/** Tempo maximo da chamada ao banco (desenho §3.3). */
export const CATALOG_SEARCH_DB_TIMEOUT_MS = 2000;

/** Limite de taxa (desenho §3.1): 90 buscas aceitas por 60 s por IP (HMAC), via private.rl_check/rl_hit. */
export const CATALOG_SEARCH_RATE = { spanS: 60, bucketS: 10, limit: 90 } as const;
export const CATALOG_SEARCH_RETRY_AFTER_S = 60;

/**
 * Campos publicos da busca, nesta ordem. Espelha CATALOG_PUBLIC_FIELDS de packages/contracts
 * (lista de permissao, T-H018-06). Sinonimos, termo e campos internos nunca entram.
 */
export const CATALOG_SEARCH_FIELDS = [
  'group_id',
  'group_name',
  'group_position',
  'service_id',
  'service_name',
  'modality',
  'regulated',
] as const;

export const CATALOG_SEARCH_ERROR_CODES = ['entrada_invalida', 'limite', 'falha'] as const;
export type CatalogSearchErrorCode = (typeof CATALOG_SEARCH_ERROR_CODES)[number];

export interface CatalogSearchItem {
  readonly group_id: string;
  readonly group_name: string;
  readonly group_position: number;
  readonly service_id: string;
  readonly service_name: string;
  readonly modality: string;
  readonly regulated: boolean;
}

export type CatalogSearchResponse =
  | { readonly status: 'ok'; readonly items: readonly CatalogSearchItem[] }
  | { readonly status: 'vazio'; readonly code: 'sem_resultado'; readonly items: readonly [] };

export interface CatalogSearchErrorBody {
  readonly status: 'erro';
  readonly code: CatalogSearchErrorCode;
}

// Mesmo tratamento de H-020: remove controles (Cc) e formatacao invisivel (Cf); espacos colapsados.
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function tidy(text: string): string {
  return text.normalize('NFC').replace(CONTROL_OR_FORMAT, ' ').replace(WHITESPACE_RUN, ' ').trim();
}

function codePoints(text: string): number {
  return [...text].length;
}

export type CatalogQueryResult =
  | { readonly ok: true; readonly q: string }
  | { readonly ok: false; readonly code: 'entrada_invalida' };

/**
 * Normaliza o termo digitado (desenho §3.1, passo 3): NFC, sem controles, espacos colapsados,
 * 2..80 caracteres e ao menos uma letra ou digito. Acento e caixa NAO sao tratados aqui (banco).
 */
export function normalizeCatalogQuery(raw: unknown): CatalogQueryResult {
  if (typeof raw !== 'string') return { ok: false, code: 'entrada_invalida' };
  const q = tidy(raw);
  const n = codePoints(q);
  if (n < CATALOG_SEARCH_QUERY_MIN || n > CATALOG_SEARCH_QUERY_MAX) {
    return { ok: false, code: 'entrada_invalida' };
  }
  if (!LETTER_OR_DIGIT.test(q)) return { ok: false, code: 'entrada_invalida' };
  return { ok: true, q };
}

export type CatalogBodyResult =
  | { readonly ok: true; readonly q: string }
  | { readonly ok: false; readonly code: 'entrada_invalida' };

/**
 * Corpo JSON {q} (desenho §3.1). `bytes` e o tamanho real lido; acima de 1 KB, com chave extra
 * ou fora do formato, o pedido e recusado antes de qualquer consulta.
 */
export function parseCatalogSearchBody(text: string, bytes: number): CatalogBodyResult {
  if (bytes > CATALOG_SEARCH_BODY_LIMIT_BYTES) return { ok: false, code: 'entrada_invalida' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'entrada_invalida' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'entrada_invalida' };
  }
  if (Object.keys(parsed).some((k) => k !== 'q')) return { ok: false, code: 'entrada_invalida' };
  const q = normalizeCatalogQuery((parsed as { q?: unknown }).q);
  if (!q.ok) return { ok: false, code: 'entrada_invalida' };
  return { ok: true, q: q.q };
}

export type CatalogProjection =
  | { readonly ok: true; readonly items: readonly CatalogSearchItem[] }
  | { readonly ok: false };

/**
 * Projeta as linhas do banco pela lista de permissao (CATALOG_SEARCH_FIELDS). Qualquer campo extra
 * e descartado; tipo errado ou mais de 10 linhas e falha (nunca repassa a linha crua).
 */
export function projectCatalogSearchRows(rows: readonly unknown[]): CatalogProjection {
  if (!Array.isArray(rows) || rows.length > CATALOG_SEARCH_RESULTS_MAX) return { ok: false };
  const items: CatalogSearchItem[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return { ok: false };
    const r = row as Record<string, unknown>;
    const valido =
      typeof r['group_id'] === 'string' &&
      typeof r['group_name'] === 'string' &&
      typeof r['group_position'] === 'number' &&
      Number.isInteger(r['group_position']) &&
      typeof r['service_id'] === 'string' &&
      typeof r['service_name'] === 'string' &&
      typeof r['modality'] === 'string' &&
      typeof r['regulated'] === 'boolean';
    if (!valido) return { ok: false };
    items.push({
      group_id: r['group_id'] as string,
      group_name: r['group_name'] as string,
      group_position: r['group_position'] as number,
      service_id: r['service_id'] as string,
      service_name: r['service_name'] as string,
      modality: r['modality'] as string,
      regulated: r['regulated'] as boolean,
    });
  }
  return { ok: true, items };
}

/** Resposta de sucesso (1 a 10 itens) ou vazia (CA-06). Erro e resposta separada (CA-07). */
export function buildCatalogSearchResponse(items: readonly CatalogSearchItem[]): CatalogSearchResponse {
  if (items.length === 0) return { status: 'vazio', code: 'sem_resultado', items: [] };
  return { status: 'ok', items };
}

export function catalogSearchError(code: CatalogSearchErrorCode): CatalogSearchErrorBody {
  return { status: 'erro', code };
}
