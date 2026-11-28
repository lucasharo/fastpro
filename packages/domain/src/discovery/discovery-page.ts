// Issue 68 (H-055) | Contrato puro da descoberta de pedidos: item de lista fechado, envelope da pagina e validacao da query.
// Sem I/O (docs/factory/153-DESENHO-H055.md, §3.2 a §3.4). A rota e o serializador de banco ficam fora deste arquivo.
import { DISCOVERY_PAGE_DEFAULT, DISCOVERY_PAGE_MAX } from './discovery-rules.js';

/** Lista fechada de chaves do item, nesta ordem. Qualquer campo fora dela fica de fora da resposta. */
export const DISCOVERY_ITEM_KEYS = [
  'id',
  'service_id',
  'service_name',
  'urgency',
  'description',
  'public_label',
  'distance_km',
  'modality',
  'published_at',
  'acceptance_deadline_at',
  'has_photos',
] as const;

export type DiscoveryUrgency = 'imediato' | 'proximas_semanas' | 'proximo_mes' | 'nao_definido';
export type DiscoveryModality = 'presencial' | 'online';

/** Item da lista do profissional. Sem coordenada, sem contato do cliente, sem dado interno de casamento. */
export interface RequestDiscoveryItem {
  readonly id: string;
  readonly service_id: string;
  readonly service_name: string;
  readonly urgency: DiscoveryUrgency;
  readonly description: string;
  /** "Cidade - UF" ou null. */
  readonly public_label: string | null;
  /** Km com uma casa (passos de 0,5) para presencial; null para online. */
  readonly distance_km: number | null;
  readonly modality: DiscoveryModality;
  /** ISO-8601 UTC. */
  readonly published_at: string;
  /** ISO-8601 UTC. */
  readonly acceptance_deadline_at: string;
  readonly has_photos: boolean;
}

/** Envelope da resposta (decisao 608). next_cursor e null quando nao ha proxima pagina. */
export interface RequestDiscoveryPage {
  readonly items: readonly RequestDiscoveryItem[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

/**
 * Copia campo a campo para o item, na ordem de DISCOVERY_ITEM_KEYS. Nunca faz spread da origem:
 * qualquer chave extra da linha de banco e descartada aqui.
 */
export function buildDiscoveryItem(source: RequestDiscoveryItem): RequestDiscoveryItem {
  return {
    id: source.id,
    service_id: source.service_id,
    service_name: source.service_name,
    urgency: source.urgency,
    description: source.description,
    public_label: source.public_label,
    distance_km: source.distance_km,
    modality: source.modality,
    published_at: source.published_at,
    acceptance_deadline_at: source.acceptance_deadline_at,
    has_photos: source.has_photos,
  };
}

/** Parametros aceitos pela rota. Qualquer outro nome, ou repeticao, e recusado. */
const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set(['limit', 'cursor']);
const LIMIT_PATTERN = /^[0-9]{1,3}$/;

export type DiscoveryQueryResult =
  | { readonly ok: true; readonly limit: number; readonly cursor: string | null }
  | { readonly ok: false; readonly code: 'parametro_invalido' };

/**
 * Valida a query da rota: `limit` (inteiro decimal puro, 1 a 200, padrao 50) e `cursor` (texto, validado depois
 * pelo decifrador do cursor, para que cursor vazio ou longo responda cursor_invalido).
 */
export function parseDiscoveryQuery(entries: ReadonlyArray<readonly [string, string]>): DiscoveryQueryResult {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const [name, value] of entries) {
    if (!ALLOWED_QUERY_KEYS.has(name) || seen.has(name)) return { ok: false, code: 'parametro_invalido' };
    seen.add(name);
    values.set(name, value);
  }

  let limit: number = DISCOVERY_PAGE_DEFAULT;
  if (values.has('limit')) {
    const raw = values.get('limit') ?? '';
    if (!LIMIT_PATTERN.test(raw)) return { ok: false, code: 'parametro_invalido' };
    limit = Number(raw);
    if (limit < 1 || limit > DISCOVERY_PAGE_MAX) return { ok: false, code: 'parametro_invalido' };
  }

  return { ok: true, limit, cursor: values.has('cursor') ? (values.get('cursor') ?? '') : null };
}
