// H-014 | Step-up para acao critica (docs/factory/52-DESENHO-H014.md §4; CA-H014-12..17).
// Logica pura. Um contrato unico (POST /v1/auth/step-up) com dois metodos de prova: 'code' (cliente,
// codigo por e-mail) e 'password' (profissional, H-016). O metodo vem da sessao, nunca do chamador.
import { STEP_UP_WINDOW_SECONDS, type AuthMethod, type StepUpMethod } from './session.js';
import { CHALLENGE_CODE_DIGITS } from './challenge.js';

/** Acoes criticas (08 §5.4; D-H014-5). Lista unica: o guarda e a matriz de rotas leem daqui. */
export const CRITICAL_ACTIONS = [
  'cancelar',
  'concluir',
  'corrigir_conclusao',
  'compartilhar_contato',
  'revogar_contato',
  'selecionar',
  'trocar_selecionado',
] as const;
export type CriticalAction = (typeof CRITICAL_ACTIONS)[number];

export function isCriticalAction(name: string): name is CriticalAction {
  return (CRITICAL_ACTIONS as readonly string[]).includes(name);
}

/** Corpo do POST do step-up: no maximo 1 KiB. */
export const STEP_UP_BODY_LIMIT_BYTES = 1024;
/** Limite de caracteres da senha no contrato; a politica de senha e da H-016. */
export const STEP_UP_PASSWORD_MAX_LENGTH = 256;

/** Metodo de prova que a sessao exige: link -> code; password -> password (52 §4.2). */
export function stepUpMethodFor(authMethod: AuthMethod): StepUpMethod {
  return authMethod === 'password' ? 'password' : 'code';
}

/** O metodo pedido precisa ser o da sessao; senao a API responde 422 metodo_invalido. */
export function checkStepUpMethod(sessionMethod: AuthMethod, requested: StepUpMethod): boolean {
  return stepUpMethodFor(sessionMethod) === requested;
}

export interface StepUpSession {
  /** recent_auth_at da sessao, em ms; nulo quando nunca houve prova. */
  readonly recentAuthAtMs: number | null;
  readonly authMethod: AuthMethod;
}

export type RecentAuthCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401;
      readonly body: { readonly code: 'step_up_required'; readonly method: StepUpMethod };
    };

/**
 * Janela de 30 min, sem deslizar: passa se agora - recent_auth_at <= 1800 s (o limite exato vale).
 * Falha sempre com 401 step_up_required (nunca 403 nem 404; CA-H014-17), sem Set-Cookie.
 */
export function requireRecentAuth(session: StepUpSession, nowMs: number): RecentAuthCheck {
  const recente =
    session.recentAuthAtMs !== null &&
    nowMs - session.recentAuthAtMs <= STEP_UP_WINDOW_SECONDS * 1000;
  if (recente) return { ok: true };
  return {
    ok: false,
    status: 401,
    body: { code: 'step_up_required', method: stepUpMethodFor(session.authMethod) },
  };
}

/** Corpo do contrato, ja conferido. */
export type StepUpRequest =
  | { readonly ok: true; readonly method: 'code'; readonly code: string }
  | { readonly ok: true; readonly method: 'password'; readonly password: string }
  | { readonly ok: false };

const CODE_RE = new RegExp(`^\\d{${CHALLENGE_CODE_DIGITS}}$`);
const CODE_KEYS = ['code', 'method'];
const PASSWORD_KEYS = ['method', 'password'];

/**
 * Confere {method:"code", code} ou {method:"password", password}. Chaves exatas por metodo; corpo
 * acima de 1 KiB, JSON invalido ou tipo errado: recusa (o chamador responde 422, sem alterar nada).
 */
export function parseStepUpBody(text: string, byteLength: number): StepUpRequest {
  if (byteLength > STEP_UP_BODY_LIMIT_BYTES) return { ok: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort();

  if (obj.method === 'code') {
    if (keys.join(',') !== [...CODE_KEYS].sort().join(',')) return { ok: false };
    if (typeof obj.code !== 'string' || !CODE_RE.test(obj.code)) return { ok: false };
    return { ok: true, method: 'code', code: obj.code };
  }

  if (obj.method === 'password') {
    if (keys.join(',') !== [...PASSWORD_KEYS].sort().join(',')) return { ok: false };
    if (typeof obj.password !== 'string') return { ok: false };
    if (obj.password.length < 1 || obj.password.length > STEP_UP_PASSWORD_MAX_LENGTH) {
      return { ok: false };
    }
    return { ok: true, method: 'password', password: obj.password };
  }

  return { ok: false };
}
