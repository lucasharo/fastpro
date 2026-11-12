// H-016 | Regras puras do cadastro, da verificacao e do login por senha do profissional
// (docs/factory/33-DESENHO-H016.md §2.6, §3, §4, §5; CA-H016-02, CA-H016-03, CA-H016-11, CA-H016-12).
// Sem I/O, sem log e sem senha na saida. O Supabase Auth e a credencial; aqui fica a politica.
import { ChallengeInputError, normalizeChallengeEmail } from './challenge.js';
import { professionalPasswordProblem, utf8Bytes, type ProfessionalPasswordProblem } from './password.js';

export const PROFESSIONAL_REGISTER_PATH = '/v1/auth/professional/register';
export const PROFESSIONAL_VERIFY_CONFIRM_PATH = '/v1/auth/professional/verification/confirm';
export const PROFESSIONAL_LOGIN_PATH = '/v1/auth/professional/login';

/** Falhas sem espera: a 5a falha ja gera espera (33 §2.6, D-H016-4). */
export const PROFESSIONAL_LOGIN_FREE_FAILURES = 4;
/** Espera = 30 s dobrando a cada falha a partir da 5a, teto de 15 min. */
export const PROFESSIONAL_LOGIN_WAIT_BASE_SECONDS = 30;
export const PROFESSIONAL_LOGIN_WAIT_CAP_SECONDS = 900;
/** Zera o contador apos 24 h sem falha (33 §2.6). */
export const PROFESSIONAL_LOGIN_RESET_AFTER_MS = 24 * 60 * 60 * 1000;
/** Senha acima disso e recusada no login como credencial errada (limite do bcrypt, 33 §3.1). */
export const PROFESSIONAL_LOGIN_PASSWORD_MAX_BYTES = 72;

/** Corpos fixos. Nenhum eco de e-mail, senha ou token. */
export const PROFESSIONAL_ACCEPTED_BODY = { status: 'accepted' } as const;
export const INVALID_CREDENTIALS_BODY = { code: 'invalid_credentials' } as const;
export const ACCOUNT_UNAVAILABLE_BODY = { code: 'account_unavailable' } as const;
export const LOGIN_BLOCKED_BODY = { code: 'login_temporarily_blocked' } as const;
export const LINK_INVALID_BODY = { code: 'link_invalid' } as const;
export const SERVICE_UNAVAILABLE_BODY = { code: 'service_unavailable' } as const;

/** Espera do login para a falha de numero `failures` (ja contada). Zero antes da 5a. */
export function professionalLoginWaitSeconds(failures: number): number {
  if (!Number.isInteger(failures) || failures < 1) throw new RangeError('falhas invalidas');
  if (failures <= PROFESSIONAL_LOGIN_FREE_FAILURES) return 0;
  const espera = PROFESSIONAL_LOGIN_WAIT_BASE_SECONDS * 2 ** (failures - PROFESSIONAL_LOGIN_FREE_FAILURES - 1);
  return Math.min(espera, PROFESSIONAL_LOGIN_WAIT_CAP_SECONDS);
}

/** Estado do contador de login por e-mail (ops.code_lock no banco; mesmo formato na memoria). */
export interface LoginThrottleState {
  readonly failures: number;
  readonly lastFailureMs: number | null;
  readonly lockedUntilMs: number | null;
}

export const LOGIN_THROTTLE_EMPTY: LoginThrottleState = {
  failures: 0,
  lastFailureMs: null,
  lockedUntilMs: null,
};

export type LoginGate =
  | { readonly kind: 'bloqueada'; readonly retryAfterSeconds: number }
  | { readonly kind: 'tentativa'; readonly next: LoginThrottleState };

/**
 * Decide se a tentativa pode ser verificada. A tentativa ja nasce contada (DD-4): se passar, o
 * contador avanca; se a falha for a 5a ou depois, a espera correspondente vale para as seguintes.
 * Durante a espera nada e verificado e o contador nao anda (nem a senha certa passa, CA-H016-12).
 */
export function gateProfessionalLogin(state: LoginThrottleState, nowMs: number): LoginGate {
  if (state.lockedUntilMs !== null && state.lockedUntilMs > nowMs) {
    return {
      kind: 'bloqueada',
      retryAfterSeconds: Math.ceil((state.lockedUntilMs - nowMs) / 1000),
    };
  }
  const antigas =
    state.lastFailureMs !== null && nowMs - state.lastFailureMs > PROFESSIONAL_LOGIN_RESET_AFTER_MS;
  const failures = (antigas ? 0 : state.failures) + 1;
  const espera = professionalLoginWaitSeconds(failures);
  return {
    kind: 'tentativa',
    next: {
      failures,
      lastFailureMs: nowMs,
      lockedUntilMs: espera > 0 ? nowMs + espera * 1000 : null,
    },
  };
}

export type ProfessionalRegisterInput =
  | { readonly ok: true; readonly email: string; readonly password: string }
  | { readonly ok: false; readonly campo: 'email' | 'password'; readonly motivo: ProfessionalPasswordProblem | 'email' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida o cadastro antes de qualquer consulta (33 §3.1, passo 1). Nunca devolve a senha. */
export function checkProfessionalRegister(body: unknown): ProfessionalRegisterInput {
  const corpo = (body ?? {}) as { email?: unknown; password?: unknown };
  let email: string;
  try {
    if (typeof corpo.email !== 'string') return { ok: false, campo: 'email', motivo: 'email' };
    email = normalizeChallengeEmail(corpo.email);
  } catch (err) {
    if (err instanceof ChallengeInputError) return { ok: false, campo: 'email', motivo: 'email' };
    throw err;
  }
  if (!EMAIL_RE.test(email)) return { ok: false, campo: 'email', motivo: 'email' };
  const problema = professionalPasswordProblem(corpo.password, email);
  if (problema !== null) return { ok: false, campo: 'password', motivo: problema };
  return { ok: true, email, password: corpo.password as string };
}

/** Formato do segredo do link de verificacao: 256 bits em base64url (43 caracteres). */
const SEGREDO_RE = /^[A-Za-z0-9_-]{43}$/;
export function isProfessionalLinkToken(raw: unknown): raw is string {
  return typeof raw === 'string' && SEGREDO_RE.test(raw);
}

/** Normaliza o e-mail do login; nulo quando a forma nao serve (resposta 401, sem contador). */
export function loginEmailOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const email = normalizeChallengeEmail(raw);
    return EMAIL_RE.test(email) ? email : null;
  } catch {
    return null;
  }
}

/** Senha do login: so forma (texto, teto de bytes). A politica nova nao se aplica a quem ja entrou. */
export function loginPasswordOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return utf8Bytes(raw) <= PROFESSIONAL_LOGIN_PASSWORD_MAX_BYTES ? raw : null;
}
