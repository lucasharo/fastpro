// H-021 | Coordenada permanente, uma chamada na publicacao (docs/factory/68-DESENHO-H021.md, §1 a §5, §7).
// Logica pura, sem I/O e sem rede: normalizacao do endereco, leitura defensiva da resposta do Geocoding v6
// (modo permanente), caixa do Brasil, teto por pedido, breaker de gasto (ausente ou invalido = fechado),
// decisao de reserva e painel. A escrita, a reserva atomica e o token ficam no servidor e no banco.
// Nada aqui guarda texto de endereco nem coordenada: o resultado e so o ponto mapeado (§4, item de mapeamento).
import { normalizeAddressQuery } from './address-suggest.js';

/** Teto de chamadas permanentes por pedido, contado pela cadeia de republicacao (decisao 29; dúvida 3). */
export const PERMANENT_CALLS_PER_REQUEST_MAX = 3;
/** Concessao de uma reserva (§3.2); vencida, a reserva e tratada como livre. */
export const PERMANENT_LEASE_MS = 60_000;
/** Preco de lista usado como estimativa no painel (08 §9.5). A fatura da Mapbox e a verdade. */
export const MAPBOX_PERMANENT_UNIT_USD = 0.005;

/** Caixa aproximada do Brasil (§2.1): barra lixo e inversao de eixos. */
export const BRAZIL_BOX = { lonMin: -74, lonMax: -34, latMin: -34, latMax: 6 } as const;

/** Tipos aceitos do Geocoding v6 e a precisao gravada (§4, dúvida 8). Tipo mais grosseiro e recusado. */
const PRECISION_BY_FEATURE_TYPE: ReadonlyMap<string, PermanentPrecision> = new Map([
  ['address', 'endereco'],
  ['street', 'rua'],
  ['neighborhood', 'bairro'],
  ['locality', 'localidade'],
]);

export type PermanentPrecision = 'endereco' | 'rua' | 'bairro' | 'localidade';

/** Unico formato de ponto que sai do adaptador permanente. Nao ha rotulo, identificador nem resposta bruta. */
export interface PermanentPoint {
  readonly lon: number;
  readonly lat: number;
  readonly precision: PermanentPrecision;
}

export function isInsideBrazilBox(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= BRAZIL_BOX.lonMin &&
    lon <= BRAZIL_BOX.lonMax &&
    lat >= BRAZIL_BOX.latMin &&
    lat <= BRAZIL_BOX.latMax
  );
}

export type PermanentAddressKey =
  | { readonly ok: true; readonly query: string; readonly key: string }
  | { readonly ok: false };

/**
 * Texto do endereco para a chamada (`query`) e chave para a idempotencia (`key`, minusculas).
 * Mesma normalizacao do autocomplete (NFC, sem controles, 3..120 caracteres).
 */
export function permanentAddressKey(raw: unknown): PermanentAddressKey {
  const q = normalizeAddressQuery(raw);
  if (!q.ok) return { ok: false };
  return { ok: true, query: q.q, key: q.q.toLowerCase() };
}

export type PermanentMapResult =
  | { readonly status: 'ponto'; readonly point: PermanentPoint }
  | { readonly status: 'sem_resultado' }
  | { readonly status: 'provider_shape' };

/**
 * Leitura defensiva da resposta do modo permanente (limit=1). So `geometry.coordinates` e o tipo
 * (`feature_type`) sao lidos; o restante (rotulo, identificadores, relevancia) e descartado.
 * A forma exata da resposta v6 e NAO VERIFICADA (desenho §4): qualquer desvio vira `provider_shape`.
 */
export function mapPermanentResponse(body: unknown): PermanentMapResult {
  if (typeof body !== 'object' || body === null || !('features' in body)) {
    return { status: 'provider_shape' };
  }
  const features: unknown = (body as { features: unknown }).features;
  if (!Array.isArray(features)) return { status: 'provider_shape' };
  if (features.length === 0) return { status: 'sem_resultado' };

  const primeiro: unknown = features[0];
  if (typeof primeiro !== 'object' || primeiro === null) return { status: 'provider_shape' };
  const geometry: unknown = (primeiro as { geometry?: unknown }).geometry;
  const props: unknown = (primeiro as { properties?: unknown }).properties;
  if (typeof geometry !== 'object' || geometry === null) return { status: 'provider_shape' };
  if ((geometry as { type?: unknown }).type !== 'Point') return { status: 'provider_shape' };
  const coords: unknown = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { status: 'provider_shape' };
  const lon: unknown = coords[0];
  const lat: unknown = coords[1];
  if (typeof lon !== 'number' || typeof lat !== 'number') return { status: 'provider_shape' };
  if (!isInsideBrazilBox(lon, lat)) return { status: 'provider_shape' };

  if (typeof props !== 'object' || props === null) return { status: 'provider_shape' };
  const tipo: unknown = (props as { feature_type?: unknown }).feature_type;
  const precision = typeof tipo === 'string' ? PRECISION_BY_FEATURE_TYPE.get(tipo) : undefined;
  if (precision === undefined) return { status: 'provider_shape' };

  return { status: 'ponto', point: { lon, lat, precision } };
}

export interface BreakerCaps {
  readonly soft: number;
  readonly hard: number;
}

const INTEIRO_NAO_NEGATIVO = /^\d{1,9}$/;

/**
 * Tetos do breaker a partir do ambiente (MAPBOX_PERMANENT_SOFT_LIMIT e _HARD_LIMIT, em chamadas).
 * Ausente, vazio, nao inteiro, negativo, hard < 1 ou soft > hard: devolve null, e null significa
 * fechado (nenhuma chamada paga; decisao 5 do lider). Sem valor fixo no codigo (D-2 do PO).
 */
export function parseBreakerCaps(
  soft: string | undefined,
  hard: string | undefined,
): BreakerCaps | null {
  if (soft === undefined || hard === undefined) return null;
  const s = soft.trim();
  const h = hard.trim();
  if (!INTEIRO_NAO_NEGATIVO.test(s) || !INTEIRO_NAO_NEGATIVO.test(h)) return null;
  const caps: BreakerCaps = { soft: Number(s), hard: Number(h) };
  if (caps.hard < 1 || caps.soft > caps.hard) return null;
  return caps;
}

export interface BreakerDecision {
  /** true: a unidade de cota pode ser reservada e a chamada paga pode ocorrer. */
  readonly permitido: boolean;
  /** true quando esta reserva faz o uso alcancar o nivel de aviso (o chamador alerta uma unica vez). */
  readonly alcancouSoft: boolean;
}

/** Breaker da cota mensal. `used` e o uso antes da reserva. Caps null ou uso no teto: bloqueado. */
export function decideBreaker(caps: BreakerCaps | null, used: number): BreakerDecision {
  if (caps === null || !Number.isInteger(used) || used < 0 || used >= caps.hard) {
    return { permitido: false, alcancouSoft: false };
  }
  return { permitido: true, alcancouSoft: used + 1 >= caps.soft };
}

export type GeoRowState = 'aguardando' | 'reservado' | 'ok' | 'sem_resultado';

export interface GeoRowSnapshot {
  readonly state: GeoRowState;
  /** Instante da reserva (ms). Nulo fora de `reservado`. */
  readonly reservedAtMs: number | null;
}

export type GeoReservaAcao =
  | 'reutilizar'
  | 'chamar'
  | 'em_andamento'
  | 'teto'
  | 'sem_resultado'
  | 'breaker';

export interface GeoReservaEntrada {
  /** Linha (pedido, texto) atual; null quando ainda nao existe. */
  readonly row: GeoRowSnapshot | null;
  /** Chamadas permanentes ja contadas para o pedido (cadeia de republicacao). */
  readonly callsNoPedido: number;
  readonly callsCap: number;
  readonly caps: BreakerCaps | null;
  /** Uso mensal da cota antes desta reserva. */
  readonly quotaUsed: number;
  readonly nowMs: number;
  readonly leaseMs: number;
}

/**
 * Ordem de §3.2 e §5.2: ok reutiliza; sem resultado nao cobra de novo; reserva viva e em andamento;
 * teto por pedido antes da cota; breaker por ultimo. Teto ou breaker nao consomem nada.
 */
export function decideReservation(e: GeoReservaEntrada): GeoReservaAcao {
  const row = e.row;
  if (row?.state === 'ok') return 'reutilizar';
  if (row?.state === 'sem_resultado') return 'sem_resultado';
  if (
    row?.state === 'reservado' &&
    row.reservedAtMs !== null &&
    e.nowMs - row.reservedAtMs < e.leaseMs
  ) {
    return 'em_andamento';
  }
  if (e.callsNoPedido >= e.callsCap) return 'teto';
  if (!decideBreaker(e.caps, e.quotaUsed).permitido) return 'breaker';
  return 'chamar';
}

/** Primeiro dia do mes em UTC (AAAA-MM-01), periodo da cota mensal (§5.1). */
export function periodStartUtc(nowMs: number): string {
  if (!Number.isFinite(nowMs)) throw new RangeError('instante invalido');
  const d = new Date(nowMs);
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mes}-01`;
}

export interface QuotaPanel {
  readonly used: number;
  readonly soft: number | null;
  readonly hard: number | null;
  readonly pct: number | null;
  readonly breaker_state: 'fechado' | 'aberto';
  readonly motivo_bloqueio: 'configuracao' | 'teto' | null;
  readonly gasto_estimado_usd_lista: number;
  readonly aguardando: number;
}

/** Contador do painel (§5.3). A tela e de H-108; aqui so a conta e a forma do dado. */
export function buildQuotaPanel(input: {
  readonly used: number;
  readonly aguardando: number;
  readonly caps: BreakerCaps | null;
}): QuotaPanel {
  const { used, aguardando, caps } = input;
  const permitido = decideBreaker(caps, used).permitido;
  const motivo: QuotaPanel['motivo_bloqueio'] = permitido
    ? null
    : caps === null
      ? 'configuracao'
      : 'teto';
  return {
    used,
    soft: caps?.soft ?? null,
    hard: caps?.hard ?? null,
    pct: caps !== null && caps.hard > 0 ? Math.min(100, Math.round((used / caps.hard) * 100)) : null,
    breaker_state: permitido ? 'fechado' : 'aberto',
    motivo_bloqueio: motivo,
    gasto_estimado_usd_lista: Math.round(used * MAPBOX_PERMANENT_UNIT_USD * 1000) / 1000,
    aguardando,
  };
}
