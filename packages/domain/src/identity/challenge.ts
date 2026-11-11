// H-011 | Desafio de acesso do cliente (docs/factory/39-DESENHO-H011.md, §1, §4; CA-H011-10..18).
// Logica pura, sem I/O: normalizacao, formato do codigo, limites de frequencia e constantes.
// Aleatoriedade, HMAC e cifra ficam em @fastpro/db (node:crypto nao entra no dominio).

/** Validade fixa do link e do codigo (39 §4; D8). Nao e configuravel. */
export const CHALLENGE_TTL_SECONDS = 15 * 60;
/** Erros de codigo que invalidam o desafio (39 §4; CA-H011-12). */
export const CHALLENGE_MAX_CODE_ATTEMPTS = 5;
/** Tamanho do codigo numerico. */
export const CHALLENGE_CODE_DIGITS = 6;
/** Janela do teto por hora (39 §4). */
export const CHALLENGE_WINDOW_SECONDS = 60 * 60;
export const CHALLENGE_MIN_INTERVAL_DEFAULT = 60;
export const CHALLENGE_MIN_INTERVAL_RANGE = { min: 10, max: 600 } as const;
export const CHALLENGE_MAX_PER_HOUR_DEFAULT = 5;
export const CHALLENGE_MAX_PER_HOUR_RANGE = { min: 1, max: 20 } as const;
export const CHALLENGE_PURPOSES = ['login', 'publish'] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

export const CHALLENGE_CONFIG_KEYS = {
  minIntervalSeconds: 'auth.challenge.min_interval_seconds',
  maxPerHour: 'auth.challenge.max_per_hour',
} as const;

const EMAIL_MAX_LENGTH = 254;

export class ChallengeInputError extends Error {
  readonly code: 'email_invalido' | 'purpose_invalido';
  constructor(code: 'email_invalido' | 'purpose_invalido') {
    super(code);
    this.name = 'ChallengeInputError';
    this.code = code;
  }
}

/**
 * Normalizacao do e-mail (mesma regra do login, H-016: trim e minusculas).
 * Lanca ChallengeInputError('email_invalido') para vazio ou acima de 254 caracteres.
 */
export function normalizeChallengeEmail(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > EMAIL_MAX_LENGTH) {
    throw new ChallengeInputError('email_invalido');
  }
  return normalized;
}

export function assertChallengePurpose(value: string): ChallengePurpose {
  if ((CHALLENGE_PURPOSES as readonly string[]).includes(value)) {
    return value as ChallengePurpose;
  }
  throw new ChallengeInputError('purpose_invalido');
}

/** Codigo de 6 digitos com zeros a esquerda. `value` deve estar em [0, 999999]. */
export function formatChallengeCode(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) {
    throw new RangeError('codigo fora da faixa');
  }
  return String(value).padStart(CHALLENGE_CODE_DIGITS, '0');
}

/** Valor de configuracao: inteiro dentro da faixa, ou o padrao (39 §4). */
export function clampChallengeSetting(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  ) {
    return value;
  }
  return fallback;
}

export interface ChallengeLimits {
  readonly minIntervalSeconds: number;
  readonly maxPerHour: number;
}

/** Limites lidos de ops.app_config com padrao quando ausentes ou invalidos. */
export function challengeLimitsFrom(raw: {
  readonly minIntervalSeconds?: unknown;
  readonly maxPerHour?: unknown;
}): ChallengeLimits {
  return {
    minIntervalSeconds: clampChallengeSetting(
      raw.minIntervalSeconds,
      CHALLENGE_MIN_INTERVAL_RANGE,
      CHALLENGE_MIN_INTERVAL_DEFAULT,
    ),
    maxPerHour: clampChallengeSetting(
      raw.maxPerHour,
      CHALLENGE_MAX_PER_HOUR_RANGE,
      CHALLENGE_MAX_PER_HOUR_DEFAULT,
    ),
  };
}

export type ChallengeLimitDecision =
  | { readonly decision: 'permitido' }
  | {
      readonly decision: 'espera';
      readonly retryAfterSeconds: number;
      readonly motivo: 'intervalo' | 'teto';
    };

/**
 * Decide se um novo pedido do mesmo e-mail pode criar desafio (espelha private.auth_challenge_create).
 * `createdAtMs` traz os instantes (ms) de TODOS os desafios do e-mail, qualquer intencao.
 * Pedido barrado nao entra na contagem: o chamador so registra quando `permitido`.
 */
export function decideChallengeLimit(input: {
  readonly nowMs: number;
  readonly createdAtMs: readonly number[];
  readonly limits: ChallengeLimits;
}): ChallengeLimitDecision {
  const { nowMs, limits } = input;
  const minIntervalMs = limits.minIntervalSeconds * 1000;
  const windowMs = CHALLENGE_WINDOW_SECONDS * 1000;

  if (input.createdAtMs.length > 0) {
    const last = Math.max(...input.createdAtMs);
    if (nowMs - last < minIntervalMs) {
      return {
        decision: 'espera',
        motivo: 'intervalo',
        retryAfterSeconds: Math.max(1, Math.ceil((last + minIntervalMs - nowMs) / 1000)),
      };
    }
  }

  const recent = input.createdAtMs.filter((t) => t > nowMs - windowMs).sort((a, b) => a - b);
  if (recent.length >= limits.maxPerHour) {
    const oldest = recent[recent.length - limits.maxPerHour] as number;
    return {
      decision: 'espera',
      motivo: 'teto',
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)),
    };
  }
  return { decision: 'permitido' };
}
