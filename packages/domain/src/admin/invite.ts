// H-102 | Convite e ativacao da conta admin (docs/factory/54-DESENHO-H102.md §2; CA-H102-01/02/05).
// Logica pura com portas injetadas. Sem auto-cadastro: a conta so nasce no passo 1 de um convite vivo.
// Respostas de convite recusado sao sempre ADMIN_INVITE_INVALID (mesmo corpo e cabecalhos).
// Logs: somente evento, resultado e motivo, nunca e-mail, senha, token ou codigo.

import { ADMIN_ROLES, isAdminRole, type AdminRole } from './roles.js';
import {
  adminCodeAttemptsExhausted,
  adminPasswordProblem,
  isAdminTokenFormat,
  isLiveInvite,
  normalizeAdminEmail,
} from './policy.js';
import type { AdminAuthPort, AdminLogger, AdminRepository } from './ports.js';
import {
  adminReply,
  ADMIN_INVITE_INVALID,
  type AdminResponse,
} from './responses.js';

export interface AdminInviteDeps {
  readonly repo: AdminRepository;
  readonly auth: AdminAuthPort;
  readonly newToken: () => string;
  readonly log: AdminLogger;
}

export interface AdminIssueRequest {
  readonly inviterId: string;
  readonly email: unknown;
  readonly roles: unknown;
  readonly approvalRequestId: string | null;
}

/** Emissao (POST /v1/admin/invites, permissao admin.role.manage). A resposta nunca traz o token. */
export async function issueAdminInvite(
  req: AdminIssueRequest,
  deps: AdminInviteDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const email = normalizeAdminEmail(req.email);
  if (email === null) return adminReply(422, { code: 'email_invalido' });

  const roles = parseRoles(req.roles);
  if (roles === null) return adminReply(422, { code: 'papel_invalido' });

  if (roles.includes('superadmin') && req.approvalRequestId === null) {
    deps.log({ evento: 'convite_emitido', resultado: 'recusado', motivo: 'aprovacao_ausente' });
    return adminReply(422, { code: 'aprovacao_invalida' });
  }

  if (await deps.repo.emailHasAccount(email)) {
    deps.log({ evento: 'convite_emitido', resultado: 'recusado', motivo: 'email_indisponivel' });
    return adminReply(409, { code: 'email_indisponivel' });
  }

  const result = await deps.repo.issueInvite({
    inviterId: req.inviterId,
    email,
    roles,
    approvalRequestId: roles.includes('superadmin') ? req.approvalRequestId : null,
    token: deps.newToken(),
    nowMs,
  });
  if (!result.ok) {
    deps.log({ evento: 'convite_emitido', resultado: 'recusado', motivo: result.reason });
    return adminReply(result.reason === 'aprovacao_invalida' ? 422 : 409, { code: result.reason });
  }
  deps.log({ evento: 'convite_emitido', resultado: 'ok' });
  return adminReply(201, { ok: true });
}

function parseRoles(raw: unknown): AdminRole[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AdminRole[] = [];
  for (const r of raw) {
    if (!isAdminRole(r) || out.includes(r)) return null;
    out.push(r);
  }
  return out.length > 0 && out.every((r) => (ADMIN_ROLES as readonly string[]).includes(r)) ? out : null;
}

export interface AdminInviteStartRequest {
  readonly token: string;
  readonly password: unknown;
}

/**
 * Passo 1 (POST /v1/admin/auth/invite/start): cria a conta no provedor, grava pendente_mfa e devolve
 * o segredo TOTP uma vez. Uma unica consulta ao banco, mesmo para token malformado. Nao consome o convite.
 */
export async function startAdminInvite(
  req: AdminInviteStartRequest,
  deps: AdminInviteDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const invite = await deps.repo.lookupInvite(req.token, nowMs);
  if (
    invite === null ||
    !isAdminTokenFormat(req.token) ||
    invite.kind !== 'ativacao' ||
    !isLiveInvite(invite.state, invite.expiresAtMs, nowMs)
  ) {
    deps.log({ evento: 'convite_ativacao_passo1', resultado: 'recusado' });
    return ADMIN_INVITE_INVALID;
  }

  const problem = adminPasswordProblem(req.password, invite.email);
  if (problem !== null || typeof req.password !== 'string') {
    return adminReply(422, { code: 'senha_invalida', motivo: problem ?? 'tipo' });
  }

  const account = await deps.auth.enrollUser(invite.email, req.password);
  if (account === null) {
    deps.log({ evento: 'convite_ativacao_passo1', resultado: 'falha_provedor' });
    return adminReply(503, { code: 'autenticacao_indisponivel' });
  }

  const ok = await deps.repo.markWaiting(
    req.token,
    { authUserId: account.authUserId, email: invite.email },
    nowMs,
  );
  if (!ok) {
    deps.log({ evento: 'convite_ativacao_passo1', resultado: 'recusado' });
    return ADMIN_INVITE_INVALID;
  }
  deps.log({ evento: 'convite_ativacao_passo1', resultado: 'ok' });
  return adminReply(200, { etapa: 'totp', segredo: account.secret, otpauth: account.otpauthUri });
}

export interface AdminInviteConfirmRequest extends AdminInviteStartRequest {
  readonly code: unknown;
}

/**
 * Passo 2 (POST /v1/admin/auth/invite/confirm): valida o TOTP, ativa a conta com os papeis do convite,
 * marca o convite como usado. NAO abre sessao (a pessoa entra depois, pelo login).
 */
export async function confirmAdminInvite(
  req: AdminInviteConfirmRequest,
  deps: AdminInviteDeps,
  nowMs: number,
): Promise<AdminResponse> {
  const invite = await deps.repo.lookupInvite(req.token, nowMs);
  if (
    invite === null ||
    !isAdminTokenFormat(req.token) ||
    invite.kind !== 'ativacao' ||
    invite.state !== 'aguardando_totp' ||
    invite.userId === null ||
    !isLiveInvite(invite.state, invite.expiresAtMs, nowMs)
  ) {
    deps.log({ evento: 'convite_ativacao_passo2', resultado: 'recusado' });
    return ADMIN_INVITE_INVALID;
  }

  const problem = adminPasswordProblem(req.password, invite.email);
  if (problem !== null || typeof req.password !== 'string' || typeof req.code !== 'string') {
    return adminReply(422, { code: 'entrada_invalida' });
  }

  const ok = await deps.auth.confirmEnrollment(invite.email, req.password, req.code);
  if (!ok) {
    const total = await deps.repo.recordCodeFailure(req.token, nowMs);
    if (total === null || adminCodeAttemptsExhausted(total)) {
      deps.log({ evento: 'convite_ativacao_passo2', resultado: 'invalidado', motivo: 'tentativas' });
      return ADMIN_INVITE_INVALID;
    }
    deps.log({ evento: 'convite_ativacao_passo2', resultado: 'codigo_errado' });
    return adminReply(400, { code: 'codigo_invalido', tentativas_restantes: 5 - total });
  }

  const activated = await deps.repo.activateInvite(req.token, nowMs);
  if (!activated) {
    deps.log({ evento: 'convite_ativacao_passo2', resultado: 'recusado' });
    return ADMIN_INVITE_INVALID;
  }
  deps.log({ evento: 'convite_ativacao_passo2', resultado: 'ok' });
  return adminReply(200, { ativo: true });
}
