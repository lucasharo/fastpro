// H-102 | Matriz papel x permissao x rota (docs/factory/54-DESENHO-H102.md §1, §4; T-H102-05; CA-H102-04).
// Rota sem declaracao = inexistente (404). Papel sem a permissao da rota = 403 permission_denied, sem
// efeito. Cada papel e testado sozinho contra cada rota do registro e contra rotas de outras historias
// (fixture de teste). O mapa abaixo e a semente do banco (migracao 20261111220000).
import { describe, it, expect } from 'vitest';
import {
  ADMIN_PERMISSION_DENIED,
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROUTES_H102,
  decideAdminGuard,
  resolveAdminRoute,
  adminPermissionsOf,
  type AdminGuardRecord,
  type AdminRouteSpec,
} from '../src/admin/index.js';
import { SYNTH_NOW } from './admin-fakes.js';

/** Registro de uma conta com um papel: linha que o banco devolveria pela guarda. */
function linha(papeis: readonly string[]): AdminGuardRecord {
  return {
    userId: 'u-teste',
    roles: papeis,
    permissions: [...adminPermissionsOf(papeis)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: SYNTH_NOW + 3600_000,
    totpAtMs: SYNTH_NOW,
  };
}

type Resultado = 'publica' | 'autorizada' | 'negada' | 'nao_existe';

function resultadoPara(rota: AdminRouteSpec | null, papeis: readonly string[]): Resultado {
  if (rota === null) return 'nao_existe';
  const out = decideAdminGuard(papeis.length === 0 ? null : linha(papeis), rota.permission, SYNTH_NOW);
  if (out.kind === 'publica') return 'publica';
  if (out.kind === 'autorizada') return 'autorizada';
  return out.response === ADMIN_PERMISSION_DENIED ? 'negada' : 'nao_existe';
}

describe('T-H102-05 matriz de rotas do registro H-102 x papel', () => {
  it('mapa de papeis e identico a semente do banco (superadmin nao herda as demais)', () => {
    expect(ADMIN_ROLE_PERMISSIONS).toEqual({
      superadmin: ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'],
      verificacao: ['verification.review'],
      moderador: ['moderation.decide'],
      financeiro: ['finance.refund.request', 'finance.refund.approve'],
      suporte: ['support.completion.correct', 'case.open_sensitive'],
      auditor: ['audit.read'],
    });
  });

  it('rota de convite: so superadmin passa; demais papeis recebem 403; sem papel recebe 404', () => {
    const convite = resolveAdminRoute(ADMIN_ROUTES_H102, 'POST', '/v1/admin/invites');
    expect(convite?.permission).toBe('admin.role.manage');
    for (const papel of ADMIN_ROLES) {
      const esperado = papel === 'superadmin' ? 'autorizada' : 'negada';
      expect(resultadoPara(convite, [papel]), papel).toBe(esperado);
    }
    expect(resultadoPara(convite, [])).toBe('nao_existe');
  });

  it('rotas de troca de papel e reenrolamento exigem admin.role.manage', () => {
    const rotas = [
      ['POST', '/v1/admin/staff/abc/roles'],
      ['DELETE', '/v1/admin/staff/abc/roles/auditor'],
      ['POST', '/v1/admin/staff/abc/mfa-reenroll-requests'],
    ] as const;
    for (const [metodo, caminho] of rotas) {
      const rota = resolveAdminRoute(ADMIN_ROUTES_H102, metodo, caminho);
      expect(rota?.permission, caminho).toBe('admin.role.manage');
      expect(resultadoPara(rota, ['superadmin'])).toBe('autorizada');
      expect(resultadoPara(rota, ['auditor'])).toBe('negada');
    }
  });

  it('sessao de logout: qualquer papel passa; sem sessao, 404', () => {
    const logout = resolveAdminRoute(ADMIN_ROUTES_H102, 'POST', '/v1/admin/auth/logout');
    for (const papel of ADMIN_ROLES) expect(resultadoPara(logout, [papel])).toBe('autorizada');
    expect(resultadoPara(logout, [])).toBe('nao_existe');
  });

  it('rotas de autenticacao sao publicas (sem guarda)', () => {
    const sessao = resolveAdminRoute(ADMIN_ROUTES_H102, 'GET', '/v1/admin/auth/session');
    expect(resultadoPara(sessao, [])).toBe('publica');
  });

  it('rota fora do registro e inexistente para todo papel (CA-H102-04)', () => {
    expect(resolveAdminRoute(ADMIN_ROUTES_H102, 'GET', '/v1/admin/nada')).toBeNull();
    expect(resolveAdminRoute(ADMIN_ROUTES_H102, 'PUT', '/v1/admin/invites')).toBeNull();
    for (const papel of ADMIN_ROLES) {
      expect(resultadoPara(null, [papel])).toBe('nao_existe');
    }
  });
});

describe('T-H102-05 fixture de outra historia: aprovar estorno (CA-H102-04)', () => {
  // Rota ficticia de outra historia (H-106), so para exercitar a checagem de permissao.
  const estorno: AdminRouteSpec = {
    method: 'POST',
    pattern: '/v1/admin/refunds/:id/approve',
    permission: 'finance.refund.approve',
  };
  const registro = [...ADMIN_ROUTES_H102, estorno];

  it('auditor tentando aprovar estorno recebe 403 e nenhuma alteracao', () => {
    const rota = resolveAdminRoute(registro, 'POST', '/v1/admin/refunds/123/approve');
    expect(resultadoPara(rota, ['auditor'])).toBe('negada');
  });

  it('financeiro aprova; superadmin, que nao herda a permissao, recebe 403', () => {
    const rota = resolveAdminRoute(registro, 'POST', '/v1/admin/refunds/123/approve');
    expect(resultadoPara(rota, ['financeiro'])).toBe('autorizada');
    expect(resultadoPara(rota, ['superadmin'])).toBe('negada');
  });

  it('a rota de estorno sem declaracao no registro e inexistente', () => {
    expect(resolveAdminRoute(ADMIN_ROUTES_H102, 'POST', '/v1/admin/refunds/123/approve')).toBeNull();
  });
});
