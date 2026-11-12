// H-016 | Regras puras do cadastro, da verificacao e do login por senha do profissional
// (docs/factory/33-DESENHO-H016.md §2.6, §3, §4, §5; CA-H016-02, CA-H016-03, CA-H016-11, CA-H016-12).
// Sem I/O, sem log e sem senha na saida. O Supabase Auth e a credencial; aqui fica a politica.
import { ChallengeInputError, normalizeChallengeEmail } from './challenge.js';
import { professionalPasswordProblem, utf8Bytes, type ProfessionalPasswordProblem } from './password.js';
import type { RateWindowDecision } from './rate-limit.js';

export const PROFESSIONAL_REGISTER_PATH = '/v1/auth/professional/register';
export const PROFESSIONAL_VERIFY_CONFIRM_PATH = '/v1/auth/professional/verification/confirm';
export const PROFESSIONAL_LOGIN_PATH = '/v1/auth/professional/login';

/** Tentativas que passam sem espera: a 5a e barrada com espera (33 §2.6, D-H016-4). */
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
  | { readonly kind: 'bloqueada'; readonly retryAfterSeconds: number; readonly next: LoginThrottleState }
  | { readonly kind: 'tentativa'; readonly next: LoginThrottleState };

/**
 * Decide se a tentativa pode ser verificada. O contador ja conta a tentativa que passa (DD-4).
 * Ate a 4a falha nada espera. A tentativa seguinte (5a) e barrada com espera de 30 s e nao conta.
 * Depois da espera, uma tentativa passa e conta; se falhar, a espera seguinte dobra (60 s, 120 s...).
 * Enquanto a espera vale, nada passa, nem a senha certa, e o contador nao anda (CA-H016-12).
 */
export function gateProfessionalLogin(state: LoginThrottleState, nowMs: number): LoginGate {
  if (state.lockedUntilMs !== null && state.lockedUntilMs > nowMs) {
    return {
      kind: 'bloqueada',
      retryAfterSeconds: Math.ceil((state.lockedUntilMs - nowMs) / 1000),
      next: state,
    };
  }
  const antigas =
    state.lastFailureMs !== null && nowMs - state.lastFailureMs > PROFESSIONAL_LOGIN_RESET_AFTER_MS;
  const base = antigas ? 0 : state.failures;
  const proximo = base + 1;
  if (proximo <= PROFESSIONAL_LOGIN_FREE_FAILURES) {
    return {
      kind: 'tentativa',
      next: { failures: proximo, lastFailureMs: nowMs, lockedUntilMs: null },
    };
  }
  const espera = professionalLoginWaitSeconds(proximo);
  if (state.lockedUntilMs === null) {
    return {
      kind: 'bloqueada',
      retryAfterSeconds: espera,
      next: { failures: base, lastFailureMs: state.lastFailureMs, lockedUntilMs: nowMs + espera * 1000 },
    };
  }
  return {
    kind: 'tentativa',
    next: { failures: proximo, lastFailureMs: nowMs, lockedUntilMs: nowMs + espera * 1000 },
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

/** Conta conferida pela senha. Nunca traz senha, token ou segredo. */
export interface ProfessionalCredential {
  readonly userId: string;
  readonly emailVerified: boolean;
  readonly active: boolean;
}

/** Decisao do contador antes de conferir a senha. */
export type ProfessionalGateOutcome =
  | { readonly kind: 'bloqueada'; readonly retryAfterSeconds: number }
  | { readonly kind: 'tentativa' };

/**
 * Porta de persistencia do profissional. Implementada no Postgres (@fastpro/db) e em memoria nos testes.
 * O contador (loginGate) decide e grava a tentativa de uma vez; a conferencia da senha fica no Auth.
 */
export interface ProfessionalAuthPort {
  /** Cadastro sem revelar existencia: cria ou trata o e-mail ja existente do mesmo jeito. Lanca em falha. */
  register(email: string, password: string, nowMs: number): Promise<void>;
  /** Consome o link de verificacao. true so na primeira vez e dentro do prazo. */
  confirmVerification(token: string, nowMs: number): Promise<boolean>;
  /** Decide o bloqueio progressivo e grava a tentativa (ja contada, quando passa). */
  loginGate(email: string, nowMs: number): Promise<ProfessionalGateOutcome>;
  /** Confere a senha. Nulo para senha errada ou e-mail inexistente (mesma resposta). */
  verifyPassword(email: string, password: string): Promise<ProfessionalCredential | null>;
  /** Zera o contador apos login correto. */
  loginSucceeded(email: string): Promise<void>;
  /** Abre a sessao de 7 dias e devolve o segredo em claro (so vai ao cookie). */
  openSession(credential: ProfessionalCredential, nowMs: number): Promise<{ readonly secret: string }>;
}

/** Piso de tempo de resposta do cadastro e do login (33 §5.1 passo 4; auth.response_floor_ms). */
export const PROFESSIONAL_RESPONSE_FLOOR_MS = 400;

// ---------------------------------------------------------------------------------------------
// Limites de envio do cadastro e do reenvio do link (33 §2, §3.1 passo 2, §4.4; CA-H016-09).
// O reenvio para conta nao verificada acontece dentro do proprio cadastro (mesma rota), entao os
// limites valem para as duas coisas. Contam antes de consultar a conta, para nao revelar existencia.

/** Intervalo minimo entre dois envios para o mesmo e-mail (33 §2, auth.mail.min_interval_seconds). */
export const PROFESSIONAL_MAIL_MIN_INTERVAL_SECONDS = 60;
/** Teto de envios por hora para o mesmo e-mail (o quinto passa; o sexto e barrado). */
export const PROFESSIONAL_MAIL_EMAIL_PER_HOUR = 5;
/** Teto de cadastros e reenvios por hora para o mesmo IP. */
export const PROFESSIONAL_MAIL_IP_PER_HOUR = 10;

export type ProfessionalSendRule = 'email_intervalo' | 'email_hora' | 'ip_hora';

/** Uma regra de envio: a janela, o balde e o limite. `value` e o e-mail normalizado ou o IP. */
export interface ProfessionalSendRuleSpec {
  readonly rule: ProfessionalSendRule;
  readonly value: string;
  readonly spanSeconds: number;
  readonly bucketSeconds: number;
  readonly limit: number;
}

/**
 * Regras de um pedido de cadastro/reenvio. Intervalo minimo: uma unica entrada na janela de 60 s
 * com balde de 1 s. Teto por hora: baldes de 60 s em 3600 s.
 */
export function professionalSendRules(email: string, ip: string): readonly ProfessionalSendRuleSpec[] {
  return [
    {
      rule: 'email_intervalo',
      value: email,
      spanSeconds: PROFESSIONAL_MAIL_MIN_INTERVAL_SECONDS,
      bucketSeconds: 1,
      limit: 1,
    },
    { rule: 'email_hora', value: email, spanSeconds: 3600, bucketSeconds: 60, limit: PROFESSIONAL_MAIL_EMAIL_PER_HOUR },
    { rule: 'ip_hora', value: ip, spanSeconds: 3600, bucketSeconds: 60, limit: PROFESSIONAL_MAIL_IP_PER_HOUR },
  ];
}

/**
 * Porta do contador de envios. No Postgres, fica sobre ops.rate_counter (private.rl_check e
 * private.rl_hit, sem migracao nova); em memoria, nos testes. `check` nao registra; `record` registra
 * o envio aceito.
 */
export interface ProfessionalSendLimitPort {
  check(spec: ProfessionalSendRuleSpec, nowMs: number): Promise<RateWindowDecision>;
  record(spec: ProfessionalSendRuleSpec, nowMs: number): Promise<void>;
}
