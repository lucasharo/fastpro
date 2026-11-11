// H-073 (docs/factory/60-DESENHO-H073.md §4) sobre a sessao admin de H-102. Confirmacao recente do
// segundo fator: a prova (senha e codigo) passa pelo mesmo caminho do login (AdminAuthPort, mesmos
// limites H-015) e so depois a sessao avanca totp_at no banco. Logica pura; a autoridade e o banco.

import { ADMIN_STEP_UP_PATH, ADMIN_ROUTES_H102, type AdminMutationHeaders } from './routes.js';
import { guardAdminRequest } from './guard.js';
import { adminLoginBlocked } from './policy.js';
import type { AdminAuthPort, AdminLogger, AdminLoginLimits, AdminRepository } from './ports.js';
import {
  ADMIN_CREDENTIALS_INVALID,
  ADMIN_NOT_FOUND,
  ADMIN_RATE_LIMITED,
  adminReply,
  type AdminResponse,
} from './responses.js';

/** Janela da prova recente de TOTP: 30 minutos (60 §4). Estrita: aos 30:00 exatos ja exige nova prova. */
export const ADMIN_TOTP_RECENT_MS = 30 * 60 * 1000;

/** Prova recente se agora < totp_at + 30 min. Usada pelo dominio; o banco aplica a mesma regra. */
export function isTotpRecent(totpAtMs: number, nowMs: number): boolean {
  return nowMs < totpAtMs + ADMIN_TOTP_RECENT_MS;
}

export interface AdminStepUpRequest {
  /** Segredo do cookie __Host-fp_admin; nulo quando ausente. */
  readonly secret: string | null;
  readonly headers: AdminMutationHeaders;
  readonly password: unknown;
  readonly code: unknown;
  readonly ip: string;
}

export interface AdminStepUpDeps {
  readonly repo: AdminRepository;
  readonly auth: AdminAuthPort;
  readonly limits: AdminLoginLimits;
  readonly log: AdminLogger;
  readonly baseUrl: string;
}

/**
 * POST /v1/admin/session/step-up (corpo {password, code}). Ordem: guarda da rota (sessao, Origin, 404
 * identico), limite de tentativas por e-mail e IP, prova no provedor, conta da prova igual a da sessao,
 * e so entao o banco avanca totp_at. Toda falha de prova = 401 credenciais_invalidas (mesmo do login).
 */
export async function stepUpAdmin(
  req: AdminStepUpRequest,
  deps: AdminStepUpDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const guarda = await guardAdminRequest(
    { method: 'POST', path: ADMIN_STEP_UP_PATH, secret: req.secret, headers: req.headers },
    { repo: deps.repo, registry: ADMIN_ROUTES_H102, baseUrl: deps.baseUrl },
    nowMs,
  );
  if (guarda.kind === 'recusada') return guarda.response;
  if (guarda.kind !== 'autorizada' || req.secret === null) return ADMIN_NOT_FOUND;

  const conta = await deps.repo.sessionSubject(req.secret, nowMs);
  if (conta === null) return ADMIN_NOT_FOUND;

  const key = { email: conta.email, ip: req.ip };
  const counts = await deps.limits.counts(key, nowMs);
  if (adminLoginBlocked(counts)) {
    deps.log({ evento: 'confirmacao_admin', resultado: 'bloqueado', motivo: 'limite' });
    return ADMIN_RATE_LIMITED;
  }

  const fail = async (motivo: string): Promise<AdminResponse> => {
    await deps.limits.recordFailure(key, nowMs);
    deps.log({ evento: 'confirmacao_admin', resultado: 'recusado', motivo });
    return ADMIN_CREDENTIALS_INVALID;
  };

  if (typeof req.password !== 'string' || typeof req.code !== 'string') {
    return fail('entrada');
  }

  const prova = await deps.auth.signInWithPasswordAndTotp(conta.email, req.password, req.code);
  if (prova === null) return fail('provedor');
  if (prova.authUserId !== conta.authUserId) return fail('outra_conta');

  const avancou = await deps.repo.stepUp(req.secret, nowMs);
  if (!avancou) return ADMIN_NOT_FOUND;

  deps.log({ evento: 'confirmacao_admin', resultado: 'ok' });
  return adminReply(200, { confirmado: true, confirmado_ate: nowMs + ADMIN_TOTP_RECENT_MS });
}
