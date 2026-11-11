// H-020 | Autocomplete de endereco temporario (docs/factory/56-DESENHO-H020.md, §1, §2, §4, §5).
// Logica pura, sem I/O. O navegador so recebe {mode, items:[{label}]} ou {mode:'texto_livre', ...}.
// Nada aqui guarda resposta do provedor: a funcao de mapeamento descarta tudo menos o rotulo.

export const ADDRESS_SUGGEST_PATH = '/v1/geo/address-suggest' as const;

/** Corpo do pedido: 1 KB (desenho §2.1). */
export const ADDRESS_BODY_LIMIT_BYTES = 1024;
export const ADDRESS_QUERY_MIN = 3;
export const ADDRESS_QUERY_MAX = 120;
export const ADDRESS_LABEL_MAX = 200;
export const ADDRESS_ITEMS_MAX = 5;

export const ADDRESS_CONTEXTS = ['request_draft', 'professional_base'] as const;
export type AddressContext = (typeof ADDRESS_CONTEXTS)[number];

/** Limite de taxa (§4.1): reutiliza private.rl_check/rl_hit com janela e balde grosseiros. */
export const SUGGEST_RATE_PRINCIPAL = { spanS: 60, bucketS: 10, limit: 30 } as const;
export const SUGGEST_RATE_IP = { spanS: 60, bucketS: 10, limit: 60 } as const;
export const SUGGEST_RETRY_AFTER_S = 60;

/** Teto da cota (§4.2). Cada ambiente tem o seu contador; a soma 93.000 + 2.000 fica abaixo de 100.000. */
export const MAPBOX_TEMP_CAPS = {
  producao: { soft: 70_000, hard: 93_000 },
  desenvolvimento: { soft: 1_500, hard: 2_000 },
} as const;
/** Limite superior aceito por qualquer configuracao (abaixo das 100.000 gratuitas). */
export const MAPBOX_TEMP_HARD_MAX = 99_000;

export type ErrorCodeEntrada = 'entrada_invalida';
export type TextoLivreMotivo = 'limite' | 'cota' | 'desligado' | 'indisponivel';

export interface AddressSuggestItem {
  readonly label: string;
}

export type AddressSuggestResponse =
  | { readonly mode: 'ok'; readonly items: readonly AddressSuggestItem[] }
  | {
      readonly mode: 'texto_livre';
      readonly reason: TextoLivreMotivo;
      readonly retry_after_s?: number;
    };

export type ProviderErrorCode =
  | 'provider_timeout'
  | 'provider_5xx'
  | 'provider_auth'
  | 'provider_429'
  | 'provider_shape';

export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = [
  'provider_timeout',
  'provider_5xx',
  'provider_auth',
  'provider_429',
  'provider_shape',
];

// Remove controles (Cc) e formatacao invisivel (Cf), como o espaco de largura zero.
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/g;

function tidy(text: string): string {
  return text.normalize('NFC').replace(CONTROL_OR_FORMAT, ' ').replace(WHITESPACE_RUN, ' ').trim();
}

function codePoints(text: string): number {
  return [...text].length;
}

export type QueryResult =
  | { readonly ok: true; readonly q: string }
  | { readonly ok: false; readonly code: ErrorCodeEntrada };

/** Normaliza o texto digitado (§2.2 passo 2): NFC, sem controles, espacos colapsados, 3..120. */
export function normalizeAddressQuery(raw: unknown): QueryResult {
  if (typeof raw !== 'string') return { ok: false, code: 'entrada_invalida' };
  const q = tidy(raw);
  const n = codePoints(q);
  if (n < ADDRESS_QUERY_MIN || n > ADDRESS_QUERY_MAX) return { ok: false, code: 'entrada_invalida' };
  return { ok: true, q };
}

export type BodyResult =
  | { readonly ok: true; readonly q: string; readonly context: AddressContext }
  | { readonly ok: false; readonly code: ErrorCodeEntrada };

function isAddressContext(value: unknown): value is AddressContext {
  return typeof value === 'string' && (ADDRESS_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Corpo JSON {q, context} (§2.1). `bytes` e o tamanho real lido; acima de 1 KB ou com campos
 * extras, o pedido e recusado antes de qualquer custo.
 */
export function parseAddressSuggestBody(text: string, bytes: number): BodyResult {
  if (bytes > ADDRESS_BODY_LIMIT_BYTES) return { ok: false, code: 'entrada_invalida' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'entrada_invalida' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'entrada_invalida' };
  }
  const chaves = Object.keys(parsed);
  if (chaves.some((k) => k !== 'q' && k !== 'context')) return { ok: false, code: 'entrada_invalida' };
  const obj = parsed as { q?: unknown; context?: unknown };
  if (!isAddressContext(obj.context)) return { ok: false, code: 'entrada_invalida' };
  const q = normalizeAddressQuery(obj.q);
  if (!q.ok) return { ok: false, code: 'entrada_invalida' };
  return { ok: true, q: q.q, context: obj.context };
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = tidy(value);
  return t === '' ? null : t;
}

/**
 * Rotulo textual de uma sugestao (CA-03): full_address; senao name + place_formatted.
 * Rotulo acima de 200 caracteres e descartado (nao truncado, para nao mudar o sentido).
 */
export function labelFromProperties(props: Record<string, unknown>): string | null {
  const full = textOf(props['full_address']);
  let label = full;
  if (label === null) {
    const name = textOf(props['name']);
    const place = textOf(props['place_formatted']);
    label = name === null ? null : place === null ? name : `${name}, ${place}`;
  }
  if (label === null || codePoints(label) > ADDRESS_LABEL_MAX) return null;
  return label;
}

export type MapResult =
  | { readonly ok: true; readonly items: readonly AddressSuggestItem[] }
  | { readonly ok: false; readonly code: 'provider_shape' };

/**
 * Converte a lista bruta do provedor em no maximo 5 rotulos (§2.4). Nada alem de `label` sai daqui:
 * coordenadas, identificadores e relevancia sao ignorados. Item sem rotulo e descartado; lista que
 * nao e lista e erro de formato.
 */
export function mapSuggestFeatures(features: unknown): MapResult {
  if (!Array.isArray(features)) return { ok: false, code: 'provider_shape' };
  const items: AddressSuggestItem[] = [];
  for (const feature of features) {
    if (items.length >= ADDRESS_ITEMS_MAX) break;
    if (typeof feature !== 'object' || feature === null) continue;
    const props = (feature as { properties?: unknown }).properties;
    if (typeof props !== 'object' || props === null) continue;
    const label = labelFromProperties(props as Record<string, unknown>);
    if (label !== null) items.push({ label });
  }
  return { ok: true, items };
}

/** Codigo fixo para uma falha do provedor (§5). Nenhuma mensagem ou corpo do provedor sai. */
export function providerErrorCode(status: number | 'timeout' | 'shape'): ProviderErrorCode {
  if (status === 'timeout') return 'provider_timeout';
  if (status === 'shape') return 'provider_shape';
  if (status === 429) return 'provider_429';
  if (status === 401 || status === 403) return 'provider_auth';
  if (status >= 500 && status <= 599) return 'provider_5xx';
  return 'provider_shape';
}

export interface QuotaTakeResult {
  /** Resultado de private.mapbox_temp_quota_take: true se a reserva foi feita. */
  readonly ok: boolean;
  /** true apenas na primeira vez que o nivel de alerta sobe neste mes. */
  readonly novoAlerta: boolean;
}

/** Decisao sobre a reserva de cota (§4.2): so consulta com reserva feita; alerta sai uma vez. */
export function decideQuotaTake(take: QuotaTakeResult): { permitido: boolean; alerta: boolean } {
  return { permitido: take.ok, alerta: take.novoAlerta };
}

/** Tetos validos: inteiros, 0 <= alerta <= desliga <= 99.000 e desliga >= 1. */
export function validateQuotaCaps(soft: number, hard: number): { ok: boolean } {
  const ints = Number.isInteger(soft) && Number.isInteger(hard);
  const ok =
    ints && soft >= 0 && hard >= 1 && soft <= hard && hard <= MAPBOX_TEMP_HARD_MAX;
  return { ok };
}
