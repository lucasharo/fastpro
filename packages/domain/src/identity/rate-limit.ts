// H-015 | Anti-enumeracao e limites (docs/factory/50-DESENHO-H015.md, §1-§4; CA-H015-01..15).
// Logica pura, sem I/O: chaves (texto a ser HMACado em @fastpro/db), IP normalizado, janelas,
// bloqueio progressivo do codigo, configuracao e forma do 429. Nenhum valor em claro e guardado aqui.
// Os contadores ficam em ops.rate_counter e ops.code_lock; a decisao final e revalidada no SQL.

export const RATE_KEY_PREFIX = 'rl1';

export const RATE_ACTIONS = ['pedido', 'codigo', 'erro_codigo'] as const;
export type RateAction = (typeof RATE_ACTIONS)[number];

export const RATE_SCOPES = ['ip', 'global_h', 'global_d', 'email'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

/** Combinacoes permitidas (50 §1.1). Qualquer outra e erro de programacao. */
const ALLOWED_SCOPES: Readonly<Record<RateAction, readonly RateScope[]>> = {
  pedido: ['ip', 'global_h', 'global_d'],
  codigo: ['ip'],
  erro_codigo: ['email'],
};

export class RateKeyError extends Error {
  readonly code: 'combinacao_invalida' | 'valor_vazio';
  constructor(code: 'combinacao_invalida' | 'valor_vazio') {
    super(code);
    this.name = 'RateKeyError';
    this.code = code;
  }
}

/**
 * Texto que sera HMACado com o pepper da acao (50 §1.1): "rl1|acao|escopo|valor".
 * Acao e escopo vem antes do valor e nao contem "|", entao o formato nao e ambiguo.
 * O valor e IP normalizado (ipNormalizado), e-mail normalizado ou "*" nos globais.
 */
export function rateKeyMessage(action: RateAction, scope: RateScope, value: string): string {
  if (!ALLOWED_SCOPES[action].includes(scope)) {
    throw new RateKeyError('combinacao_invalida');
  }
  if (value.length === 0) {
    throw new RateKeyError('valor_vazio');
  }
  return [RATE_KEY_PREFIX, action, scope, value].join('|');
}

/** Valor dos escopos globais (sem IP nem e-mail). */
export const RATE_GLOBAL_VALUE = '*';

export const IP_UNKNOWN_VALUE = 'desconhecido';

export interface ClientIpKey {
  /** Valor normalizado: IPv4 como esta, IPv6 como prefixo /64, ou "desconhecido". */
  readonly value: string;
  /** true quando o IP estava ausente ou ilegivel (gera a metrica ip_ausente, 50 §2.7). */
  readonly ausente: boolean;
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Converte IPv6 textual em 8 grupos de 16 bits. Aceita "::" e cauda IPv4 (::ffff:1.2.3.4). */
function parseIpv6(text: string): number[] | null {
  let body = text;
  const lastColon = body.lastIndexOf(':');
  const tail = body.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    const hi = ((v4[0] ?? 0) * 256 + (v4[1] ?? 0)).toString(16);
    const lo = ((v4[2] ?? 0) * 256 + (v4[3] ?? 0)).toString(16);
    body = `${body.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const rest = halves[1] === '' || halves[1] === undefined ? [] : halves[1].split(':');
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array.from({ length: fill }, () => '0'), ...rest];
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/**
 * IP do cliente para chave de limite (50 §1.1, CA-H015-02). IPv6 vira o prefixo /64; IPv4 mapeado
 * em IPv6 vira IPv4; ausente ou ilegivel vira "desconhecido" (balde compartilhado, falha fechada).
 */
export function normalizeClientIp(raw: string | null | undefined): ClientIpKey {
  const unknown: ClientIpKey = { value: IP_UNKNOWN_VALUE, ausente: true };
  if (typeof raw !== 'string') return unknown;
  let text = raw.trim();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (text === '') return unknown;

  if (!text.includes(':')) {
    const v4 = parseIpv4(text);
    return v4 === null ? unknown : { value: v4.join('.'), ausente: false };
  }

  const groups = parseIpv6(text);
  if (groups === null) return unknown;
  const g = (i: number): number => groups[i] ?? 0;
  if (g(0) === 0 && g(1) === 0 && g(2) === 0 && g(3) === 0 && g(4) === 0 && g(5) === 0xffff) {
    const v4 = [g(6) >> 8, g(6) & 255, g(7) >> 8, g(7) & 255];
    return { value: v4.join('.'), ausente: false };
  }
  const prefix = [g(0), g(1), g(2), g(3)].map((n) => n.toString(16)).join(':');
  return { value: `${prefix}::/64`, ausente: false };
}

// ---------------------------------------------------------------------------------------------
// Janelas (50 §1.1): balde de tamanho B, soma de S/B baldes (o atual e os anteriores).

export const RATE_DAY_SECONDS = 86_400;
/** Teto de Retry-After (50 §2.2). */
export const RATE_RETRY_MAX_SECONDS = 86_400;

export interface RateBucket {
  /** Inicio do balde em epoch (segundos), alinhado a bucketSeconds. */
  readonly windowStart: number;
  readonly count: number;
}

export type RateWindowDecision =
  | { readonly decision: 'permitido' }
  | { readonly decision: 'barrado'; readonly retryAfterSeconds: number };

/** Inicio do balde que contem o instante (epoch em segundos). */
export function bucketStartSeconds(nowSeconds: number, bucketSeconds: number): number {
  return Math.floor(nowSeconds / bucketSeconds) * bucketSeconds;
}

/** Retry-After em segundos inteiros, entre 1 e 86400 (50 §2.2). */
export function clampRetryAfter(seconds: number): number {
  if (!Number.isFinite(seconds)) return RATE_RETRY_MAX_SECONDS;
  return Math.min(RATE_RETRY_MAX_SECONDS, Math.max(1, Math.ceil(seconds)));
}

/**
 * Decide se mais um evento cabe na janela de `spanSeconds` (espelha rl_check no SQL, 50 §1.3 item 1).
 * Soma os baldes do inicio da janela grosseira ate o balde atual. Barrado quando a soma chega ao limite.
 * Retry-After = inicio do balde mais antigo com contagem + S - agora (diario: ate 00:00 UTC).
 */
export function decideRateWindow(input: {
  readonly nowSeconds: number;
  readonly bucketSeconds: number;
  readonly spanSeconds: number;
  readonly limit: number;
  readonly buckets: readonly RateBucket[];
}): RateWindowDecision {
  const { nowSeconds, bucketSeconds, spanSeconds, limit } = input;
  const current = bucketStartSeconds(nowSeconds, bucketSeconds);
  const oldestAllowed = current - (spanSeconds - bucketSeconds);

  let total = 0;
  let oldest: number | null = null;
  for (const bucket of input.buckets) {
    if (bucket.windowStart < oldestAllowed || bucket.windowStart > current) continue;
    if (bucket.count <= 0) continue;
    total += bucket.count;
    if (oldest === null || bucket.windowStart < oldest) oldest = bucket.windowStart;
  }

  if (total < limit) return { decision: 'permitido' };
  const start = oldest ?? current;
  return {
    decision: 'barrado',
    retryAfterSeconds: clampRetryAfter(start + spanSeconds - nowSeconds),
  };
}

/** Maior Retry-After entre os limites que barraram (50 §2.3). Sem barrado, devolve null. */
export function worstRetryAfter(decisions: readonly RateWindowDecision[]): number | null {
  let worst: number | null = null;
  for (const d of decisions) {
    if (d.decision === 'barrado' && (worst === null || d.retryAfterSeconds > worst)) {
      worst = d.retryAfterSeconds;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------------------------
// Bloqueio progressivo do codigo por e-mail (50 §3).

export const CODE_ERROR_LIMIT_DEFAULT = 15;
export const CODE_ERROR_WINDOW_SECONDS = RATE_DAY_SECONDS;
/** Zera os strikes apos 7 dias sem erro (50 §3, registro de erro passo 2). */
export const CODE_STRIKE_RESET_SECONDS = 7 * RATE_DAY_SECONDS;

/** Duracao do bloqueio do codigo: 1o = 15 min, 2o = 1 h, 3o em diante = 24 h (50 §3). */
export function codeLockSeconds(strike: number): number {
  if (!Number.isInteger(strike) || strike < 1) {
    throw new RangeError('strike invalido');
  }
  if (strike === 1) return 900;
  if (strike === 2) return 3600;
  return RATE_DAY_SECONDS;
}

/** Strikes efetivos antes de contar um novo erro: zera se o ultimo erro foi ha mais de 7 dias. */
export function effectiveStrikes(
  strikes: number,
  lastErrorSeconds: number,
  nowSeconds: number,
): number {
  return nowSeconds - lastErrorSeconds > CODE_STRIKE_RESET_SECONDS ? 0 : strikes;
}

// ---------------------------------------------------------------------------------------------
// Configuracao (50 §1.1, §4): valores de ops.app_config, com faixa e padrao.

export const RATE_CONFIG_KEYS = {
  pedidoIpHora: 'auth.rate.pedido_ip_hora',
  pedidoGlobalHora: 'auth.rate.pedido_global_hora',
  pedidoGlobalDia: 'auth.rate.pedido_global_dia',
  codigoIpHora: 'auth.rate.codigo_ip_hora',
  erroCodigoDia: 'auth.rate.erro_codigo_dia',
} as const;

export const RATE_LIMIT_DEFAULTS = {
  pedidoIpHora: 20,
  pedidoGlobalHora: 30,
  pedidoGlobalDia: 80,
  codigoIpHora: 50,
  erroCodigoDia: 15,
} as const;

/** Faixas aceitas. pedidoGlobalDia tem teto rigido de 90 (reserva de envio, 50 §4). */
export const RATE_LIMIT_RANGES = {
  pedidoIpHora: { min: 5, max: 100 },
  pedidoGlobalHora: { min: 5, max: 200 },
  pedidoGlobalDia: { min: 10, max: 90 },
  codigoIpHora: { min: 10, max: 500 },
  erroCodigoDia: { min: 5, max: 50 },
} as const;

export type RateLimits = { readonly [K in keyof typeof RATE_LIMIT_DEFAULTS]: number };

function clampRateSetting(value: unknown, range: { min: number; max: number }, fallback: number) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max) {
    return value;
  }
  return fallback;
}

/** Limites lidos de app_config; fora da faixa ou ausentes caem no padrao (T-H015-05). */
export function rateLimitsFrom(raw: { readonly [K in keyof RateLimits]?: unknown }): RateLimits {
  return {
    pedidoIpHora: clampRateSetting(raw.pedidoIpHora, RATE_LIMIT_RANGES.pedidoIpHora, RATE_LIMIT_DEFAULTS.pedidoIpHora),
    pedidoGlobalHora: clampRateSetting(raw.pedidoGlobalHora, RATE_LIMIT_RANGES.pedidoGlobalHora, RATE_LIMIT_DEFAULTS.pedidoGlobalHora),
    pedidoGlobalDia: clampRateSetting(raw.pedidoGlobalDia, RATE_LIMIT_RANGES.pedidoGlobalDia, RATE_LIMIT_DEFAULTS.pedidoGlobalDia),
    codigoIpHora: clampRateSetting(raw.codigoIpHora, RATE_LIMIT_RANGES.codigoIpHora, RATE_LIMIT_DEFAULTS.codigoIpHora),
    erroCodigoDia: clampRateSetting(raw.erroCodigoDia, RATE_LIMIT_RANGES.erroCodigoDia, RATE_LIMIT_DEFAULTS.erroCodigoDia),
  };
}

// ---------------------------------------------------------------------------------------------
// Resposta 429 (50 §2.2): mesma forma para cadastrado e nao cadastrado.

export type RateLimitedKind = 'pedido' | 'codigo';

export interface RateLimitedResponse {
  readonly status: 429;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Monta o 429. Corpo {code, retry_after_seconds}; cabecalhos fixos Retry-After, Cache-Control e
 * Content-Type. Nada mais (sem Set-Cookie, sem X-RateLimit-*, sem motivo do limite).
 */
export function rateLimited(kind: RateLimitedKind, retryAfterSeconds: number): RateLimitedResponse {
  const retry = clampRetryAfter(retryAfterSeconds);
  const code = kind === 'pedido' ? 'muitos_pedidos' : 'muitas_tentativas';
  return {
    status: 429,
    headers: {
      'Retry-After': String(retry),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, retry_after_seconds: retry }),
  };
}
