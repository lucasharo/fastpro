// H-115 (Issue 124) | Integridade estatica da matriz (desenho §3.2 e §5.1). Sem banco, sem rede.
import { describe, expect, it } from 'vitest';
import {
  ACCESS_MATRIX,
  ACCESS_PRINCIPALS,
  ACCESS_RESOURCES,
  ADMIN_ROLE_IDS,
  ADMIN_ROLE_PERMISSIONS_MIRROR,
  activeCases,
  canAccess,
  containsSentinel,
  deferredCases,
  SENTINELS,
  unknownReferences,
} from '../src/index.js';

const CA_IDS = new Set(Array.from({ length: 20 }, (_, i) => `CA-H115-${String(i + 1).padStart(2, '0')}`));

// Criterios que nao sao caso de matriz: cobertos por outra fatia (desenho §8.1).
const CRITERIA_OUTSIDE_CASES: Readonly<Record<string, string>> = {
  'CA-H115-01': 'F1: tipagem e integridade (este arquivo)',
  'CA-H115-02': 'F2: catalogo RLS (CAT-01)',
  'CA-H115-04': 'F2: contexto ausente (CAT-08)',
  'CA-H115-20': 'F5: guarda de cobertura',
};

describe('integridade da matriz', () => {
  it('ids de caso sao unicos e seguem o padrao CP-NN', () => {
    const ids = ACCESS_MATRIX.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^CP-\d{2}$/);
  });

  it('cobre CP-01 a CP-26 do refino e os complementares declarados', () => {
    const ids = new Set(ACCESS_MATRIX.map((c) => c.id));
    for (let i = 1; i <= 26; i += 1) expect(ids.has(`CP-${String(i).padStart(2, '0')}`)).toBe(true);
    expect(ids.size).toBeGreaterThanOrEqual(35);
  });

  it('todo principal e recurso citado existe', () => {
    expect(unknownReferences()).toEqual([]);
  });

  it('todo criterio citado existe em CA-H115-01..20', () => {
    for (const c of ACCESS_MATRIX) {
      for (const ca of c.criteria) expect(CA_IDS.has(ca), `${c.id} cita ${ca}`).toBe(true);
    }
  });

  it('todo CA-H115 tem caso ou esta justificado fora da matriz', () => {
    const cited = new Set(ACCESS_MATRIX.flatMap((c) => [...c.criteria]));
    for (const ca of CA_IDS) {
      if (CRITERIA_OUTSIDE_CASES[ca]) continue;
      expect(cited.has(ca), `${ca} sem caso`).toBe(true);
    }
  });

  it('caso ativo com resposta HTTP de sucesso ou de recurso de banco tem sonda', () => {
    for (const c of activeCases()) {
      const needsProbe =
        c.http !== undefined && (c.http.status === 200 || c.http.status === 201 || c.http.status === 403 || c.http.status === 404);
      if (!needsProbe) continue;
      expect(c.probe, `${c.id} sem sonda`).toBeDefined();
      expect(c.probe?.kind, `${c.id} com sonda vazia`).not.toBe('none');
    }
  });

  it('caso deferred exige requiresRelation e deferredBy', () => {
    for (const c of deferredCases()) {
      expect(c.requiresRelation, `${c.id} sem requiresRelation`).toBeTruthy();
      expect(c.deferredBy?.length ?? 0, `${c.id} sem deferredBy`).toBeGreaterThan(0);
    }
  });

  it('HTTP 404 exige banco sem linhas ou negado', () => {
    for (const c of ACCESS_MATRIX) {
      if (c.http?.status !== 404 || !c.db) continue;
      expect(['no_rows', 'denied'], `${c.id}`).toContain(c.db.kind);
    }
  });

  it('HTTP 200 com chaves proibidas exige a mesma lista proibida no banco', () => {
    for (const c of ACCESS_MATRIX) {
      if (c.http?.status !== 200 || c.http.mustNotHaveKeys.length === 0) continue;
      expect(c.db?.kind, `${c.id}`).toBe('rows');
      const forb = c.db && c.db.kind === 'rows' ? c.db.forbiddenColumns ?? [] : [];
      expect([...forb].sort(), `${c.id} divergente`).toEqual([...c.http.mustNotHaveKeys].sort());
    }
  });

  it('todo caso tem condicao descritiva e ao menos uma camada', () => {
    for (const c of ACCESS_MATRIX) {
      expect(c.condition.length).toBeGreaterThan(5);
      expect(c.layers.length).toBeGreaterThan(0);
    }
  });
});

describe('principais e papeis administrativos', () => {
  it('os 7 papeis administrativos existem como principais', () => {
    for (const role of ADMIN_ROLE_IDS) {
      expect(ACCESS_PRINCIPALS[`admin_${role}`], `admin_${role}`).toBeDefined();
    }
  });

  it('nenhuma permissao da matriz fica fora do conjunto administrativo conhecido', () => {
    const known = new Set(Object.values(ADMIN_ROLE_PERMISSIONS_MIRROR).flat());
    for (const p of Object.values(ACCESS_PRINCIPALS)) {
      for (const perm of p.permissions ?? []) expect(known.has(perm), `${p.id}: ${perm}`).toBe(true);
    }
  });

  it('superadmin nao tem permissoes de estorno, verificacao, moderacao nem retencao (RN-H115-12)', () => {
    const sa = ACCESS_PRINCIPALS.admin_superadmin.permissions ?? [];
    for (const forbidden of ['finance.refund.approve', 'verification.review', 'moderation.decide']) {
      expect(sa).not.toContain(forbidden);
    }
    expect(sa.some((p) => p.startsWith('retention.'))).toBe(false);
  });

  it('admin sem MFA e aal1; demais admins sao aal2', () => {
    expect(ACCESS_PRINCIPALS.admin_no_mfa.aal).toBe('aal1');
    for (const id of Object.keys(ACCESS_PRINCIPALS)) {
      if (id.startsWith('admin_') && id !== 'admin_no_mfa') expect(ACCESS_PRINCIPALS[id].aal).toBe('aal2');
    }
  });

  it('auditor nao tem permissao de escrita nem de aprovacao', () => {
    const perms = ACCESS_PRINCIPALS.admin_auditor.permissions ?? [];
    expect(perms).toEqual(['audit.read']);
  });
});

describe('recursos e acesso esperado', () => {
  it('todo recurso tem relacao e sensibilidade', () => {
    for (const r of Object.values(ACCESS_RESOURCES)) {
      expect(r.relation).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(['C0', 'C1', 'C2', 'C3', 'C4']).toContain(r.sensitivity);
    }
  });

  it('canAccess reflete casos ativos: dono le o proprio pedido, outro cliente nao', () => {
    expect(canAccess('customer_owner', 'request', 'read')).toBe(true);
    expect(canAccess('customer_other', 'request', 'read')).toBe(false);
  });

  it('participante com aceite (deferred) nao conta como acesso ativo ate a Issue #71', () => {
    expect(canAccess('pro_participant', 'professional_request_view', 'read')).toBe(false);
  });
});

describe('sentinelas de PII', () => {
  it('detecta sentinela em valor aninhado e em chave', () => {
    expect(containsSentinel({ a: { b: [SENTINELS.email] } })).toBe(true);
    expect(containsSentinel({ [SENTINELS.phone]: 1 })).toBe(true);
  });

  it('nao acusa resposta limpa', () => {
    expect(containsSentinel({ id: 'x', publicLabel: 'Centro' })).toBe(false);
  });
});
