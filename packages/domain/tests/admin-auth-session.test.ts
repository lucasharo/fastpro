// H-103 (Issue 112) | GET /v1/admin/auth/session (docs/factory/70-DESENHO-H103.md §4, T-H103-08).
// Com sessao valida: papeis e expira_em. Sem sessao valida (ausente, vencida, revogada, sem aal2, sem papel):
// o mesmo { autenticado: false } com 200, sem diferenca entre as causas. Logica pura, em memoria.
import { describe, it, expect } from 'vitest';
import {
  adminPermissionsOf,
  handleAdminAuthSession,
  type AdminGuardRecord,
} from '../src/admin/index.js';
import { SYNTH_NOW } from './admin-fakes.js';

function linha(papeis: readonly string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: 'u-teste',
    roles: papeis,
    permissions: [...adminPermissionsOf(papeis)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: SYNTH_NOW + 3600_000,
    totpAtMs: SYNTH_NOW,
    ...extra,
  };
}

describe('T-H103-08 GET /v1/admin/auth/session', () => {
  it('sessao valida: autenticado, papeis e expira_em em ISO; sem permissoes nem usuario', () => {
    const out = handleAdminAuthSession(linha(['suporte', 'auditor']), SYNTH_NOW);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      autenticado: true,
      papeis: ['suporte', 'auditor'],
      expira_em: new Date(SYNTH_NOW + 3600_000).toISOString(),
    });
    expect(Object.keys(out.body).sort()).toEqual(['autenticado', 'expira_em', 'papeis']);
  });

  it('papel desconhecido nao aparece em papeis', () => {
    const out = handleAdminAuthSession(linha(['auditor', 'inventado']), SYNTH_NOW);
    expect(out.body.papeis).toEqual(['auditor']);
  });

  it('ausente, vencida, revogada, sem aal2 ou sem papel: 200 com o mesmo corpo', () => {
    const casos = [
      null,
      linha(['auditor'], { expiresAtMs: SYNTH_NOW - 1 }),
      linha(['auditor'], { active: false }),
      linha(['auditor'], { aal2: false }),
      linha([]),
    ];
    const respostas = casos.map((row) => handleAdminAuthSession(row, SYNTH_NOW));
    for (const r of respostas) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ autenticado: false });
      expect(r.headers['Cache-Control']).toBe('no-store');
    }
  });
});
