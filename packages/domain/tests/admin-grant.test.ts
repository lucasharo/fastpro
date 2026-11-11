// H-102 | Testes puros de troca e revogacao de papel (docs/factory/54-DESENHO-H102.md §5; T-H102-06;
// CA-H102-09 a 11; D-H102-5). Autoconcessao negada e auditada; superadmin so com aprovacao valida
// (solicitante, alvo, nao usada, dentro de 24 h); revogacao nao tira o ultimo Superadmin.
// Sem rede, sem banco. Ids sinteticos.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_PERMISSION_DENIED,
  adminPermissionsOf,
  decideAdminRoleGrant,
  decideAdminRoleRevoke,
  type AdminApprovalState,
  type AdminGrantState,
} from '../src/admin/index.js';

const AGORA = Date.parse('2099-01-01T12:00:00.000Z');
const SUPER = adminPermissionsOf(['superadmin']);
const AUDITOR = adminPermissionsOf(['auditor']);

function aprovacaoValida(over: Partial<AdminApprovalState> = {}): AdminApprovalState {
  return {
    action: 'papel_superadmin',
    detail: 'superadmin',
    status: 'aprovada',
    consumed: false,
    subjectId: 'alvo',
    requestedBy: 'ator',
    expiresAtMs: AGORA + 3600_000,
    ...over,
  };
}

function concessao(over: Partial<AdminGrantState> = {}): AdminGrantState {
  return {
    actorId: 'ator',
    targetId: 'alvo',
    role: 'auditor',
    actorPermissions: [...SUPER],
    targetActive: true,
    targetHasRole: false,
    approval: null,
    nowMs: AGORA,
    ...over,
  };
}

describe('T-H102-06 concessao de papel', () => {
  it('autoconcessao: 403 permission_denied e evento de auditoria pedido (CA-H102-11)', () => {
    const d = decideAdminRoleGrant(concessao({ targetId: 'ator', role: 'auditor' }));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.response.status).toBe(403);
      expect(d.response.body).toEqual({ code: 'permission_denied' });
      expect(d.audit).toBe('admin.role.self_grant_denied');
    }
  });

  it('autoconcessao de superadmin tambem e negada, mesmo com aprovacao', () => {
    const d = decideAdminRoleGrant(
      concessao({ targetId: 'ator', role: 'superadmin', approval: aprovacaoValida({ subjectId: 'ator' }) }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.audit).toBe('admin.role.self_grant_denied');
  });

  it('papel sem admin.role.manage nao concede e nao audita como autoconcessao', () => {
    const d = decideAdminRoleGrant(concessao({ actorPermissions: [...AUDITOR] }));
    expect(d).toEqual({ ok: false, response: ADMIN_PERMISSION_DENIED });
  });

  it('superadmin concede papel comum sem aprovacao', () => {
    expect(decideAdminRoleGrant(concessao({ role: 'financeiro' }))).toEqual({ ok: true });
  });

  it('superadmin so com aprovacao valida: aprovada, do solicitante, do alvo, nao usada, dentro de 24 h', () => {
    expect(decideAdminRoleGrant(concessao({ role: 'superadmin', approval: aprovacaoValida() }))).toEqual({ ok: true });

    const invalidas: Array<[string, AdminApprovalState | null]> = [
      ['sem aprovacao', null],
      ['pendente', aprovacaoValida({ status: 'pendente' })],
      ['vencida', aprovacaoValida({ expiresAtMs: AGORA - 1 })],
      ['ja usada', aprovacaoValida({ consumed: true, status: 'consumida' })],
      ['solicitante diferente', aprovacaoValida({ requestedBy: 'outro' })],
      ['alvo diferente', aprovacaoValida({ subjectId: 'outro-alvo' })],
      ['acao errada', aprovacaoValida({ action: 'mfa_reenroll' })],
      ['sem detalhe de superadmin', aprovacaoValida({ detail: 'auditor' })],
    ];
    for (const [nome, approval] of invalidas) {
      const d = decideAdminRoleGrant(concessao({ role: 'superadmin', approval }));
      expect(d.ok, nome).toBe(false);
      if (!d.ok) expect(d.response.status, nome).toBe(422);
    }
  });

  it('papel invalido, alvo inativo e papel ja ativo sao recusados com codigos proprios', () => {
    const invalido = decideAdminRoleGrant(concessao({ role: 'dono' }));
    expect(!invalido.ok && invalido.response.body).toEqual({ code: 'papel_invalido' });
    const inativo = decideAdminRoleGrant(concessao({ targetActive: false }));
    expect(!inativo.ok && inativo.response.body).toEqual({ code: 'alvo_nao_ativo' });
    const repetido = decideAdminRoleGrant(concessao({ targetHasRole: true }));
    expect(!repetido.ok && repetido.response.status).toBe(409);
  });
});

describe('T-H102-06 revogacao de papel (CA-H102-08 e D-H102-5)', () => {
  it('revogacao imediata quando ha dois Superadmins ativos', () => {
    expect(
      decideAdminRoleRevoke({
        actorPermissions: [...SUPER],
        role: 'superadmin',
        targetHasRole: true,
        activeSuperadmins: 2,
      }),
    ).toBeNull();
  });

  it('nao revoga o ultimo Superadmin ativo (422 ultimo_superadmin)', () => {
    const r = decideAdminRoleRevoke({
      actorPermissions: [...SUPER],
      role: 'superadmin',
      targetHasRole: true,
      activeSuperadmins: 1,
    });
    expect(r?.status).toBe(422);
    expect(r?.body).toEqual({ code: 'ultimo_superadmin' });
  });

  it('papel que o alvo nao tem: 409; sem permissao: 403', () => {
    expect(
      decideAdminRoleRevoke({ actorPermissions: [...SUPER], role: 'auditor', targetHasRole: false, activeSuperadmins: 1 })?.status,
    ).toBe(409);
    expect(
      decideAdminRoleRevoke({ actorPermissions: [...AUDITOR], role: 'auditor', targetHasRole: true, activeSuperadmins: 1 }),
    ).toEqual(ADMIN_PERMISSION_DENIED);
  });
});
