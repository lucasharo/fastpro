// H-102 | Troca de papel (docs/factory/54-DESENHO-H102.md §5.1, §5.2; CA-H102-09/10/11; D-H102-5).
// Regras puras espelhadas no banco (private.admin_role_grant / admin_role_revoke). O banco e a autoridade;
// aqui se decide a resposta e se a autoconcessao deve ser auditada.
//   - autoconcessao: 403 permission_denied + evento admin.role.self_grant_denied (gravado em transacao propria)
//   - concessao de superadmin: exige aprovacao papel_superadmin aprovada, do solicitante, do alvo, nao usada
//   - revogacao: imediata; nunca revoga o ultimo Superadmin ativo

import { isAdminRole } from './roles.js';
import { ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

export interface AdminApprovalState {
  readonly action: 'papel_superadmin' | 'mfa_reenroll';
  readonly detail: string | null;
  readonly status: 'pendente' | 'aprovada' | 'rejeitada' | 'expirada' | 'consumida';
  readonly consumed: boolean;
  readonly subjectId: string | null;
  readonly requestedBy: string;
  readonly expiresAtMs: number;
}

export interface AdminGrantState {
  readonly actorId: string;
  readonly targetId: string;
  readonly role: string;
  readonly actorPermissions: readonly string[];
  readonly targetActive: boolean;
  readonly targetHasRole: boolean;
  readonly approval: AdminApprovalState | null;
  readonly nowMs: number;
}

export type AdminGrantDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly response: AdminResponse;
      /** Quando presente, o chamador grava este evento em transacao propria (CA-H102-11). */
      readonly audit?: 'admin.role.self_grant_denied';
    };

export function decideAdminRoleGrant(s: AdminGrantState): AdminGrantDecision {
  if (s.actorId === s.targetId) {
    return { ok: false, response: ADMIN_PERMISSION_DENIED, audit: 'admin.role.self_grant_denied' };
  }
  if (!s.actorPermissions.includes('admin.role.manage')) {
    return { ok: false, response: ADMIN_PERMISSION_DENIED };
  }
  if (!isAdminRole(s.role)) {
    return { ok: false, response: adminReply(422, { code: 'papel_invalido' }) };
  }
  if (!s.targetActive) {
    return { ok: false, response: adminReply(422, { code: 'alvo_nao_ativo' }) };
  }
  if (s.targetHasRole) {
    return { ok: false, response: adminReply(409, { code: 'papel_ja_ativo' }) };
  }
  if (s.role === 'superadmin') {
    const a = s.approval;
    const valida =
      a !== null &&
      a.action === 'papel_superadmin' &&
      a.detail === 'superadmin' &&
      a.status === 'aprovada' &&
      !a.consumed &&
      a.subjectId === s.targetId &&
      a.requestedBy === s.actorId &&
      a.expiresAtMs > s.nowMs;
    if (!valida) {
      return { ok: false, response: adminReply(422, { code: 'aprovacao_invalida' }) };
    }
  }
  return { ok: true };
}

export interface AdminRevokeState {
  readonly actorPermissions: readonly string[];
  readonly role: string;
  readonly targetHasRole: boolean;
  /** Superadmins ativos no sistema (conta ativa com papel superadmin ativo). */
  readonly activeSuperadmins: number;
}

export function decideAdminRoleRevoke(s: AdminRevokeState): AdminResponse | null {
  if (!s.actorPermissions.includes('admin.role.manage')) return ADMIN_PERMISSION_DENIED;
  if (!s.targetHasRole) return adminReply(409, { code: 'papel_nao_ativo' });
  if (s.role === 'superadmin' && s.activeSuperadmins <= 1) {
    return adminReply(422, { code: 'ultimo_superadmin' });
  }
  return null;
}

