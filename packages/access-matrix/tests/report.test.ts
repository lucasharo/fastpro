// H-115 (Issue 124) | Relatorio de paridade (desenho §7): funcao pura com entradas sinteticas.
import { describe, expect, it } from 'vitest';
import { buildParityReport, type AccessCase } from '../src/index.js';

const caso = (id: string, status: 'active' | 'deferred', layers: AccessCase['layers']): AccessCase =>
  ({
    id,
    resource: 'request',
    action: 'read',
    principal: 'customer_owner',
    condition: 'caso sintetico para o relatorio',
    criteria: ['CA-H115-08'],
    invariants: [],
    layers,
    status,
    ...(status === 'deferred' ? { requiresRelation: 'app.x', deferredBy: ['#1'] } : {}),
  }) as AccessCase;

const cases: readonly AccessCase[] = [
  caso('CP-01', 'active', ['api', 'db']),
  caso('CP-02', 'active', ['api']),
  caso('CP-03', 'active', ['db']),
  caso('CP-04', 'deferred', ['api']),
];

describe('buildParityReport', () => {
  it('conta so casos ativos da camada e separa falhas e pendentes', () => {
    const r = buildParityReport(cases, { camada: 'api', resultados: { 'CP-01': 'ok', 'CP-02': 'falha' } });
    expect(r.ativos).toBe(2);
    expect(r.ok).toBe(1);
    expect(r.falhas).toEqual(['CP-02']);
    expect(r.pendentes).toEqual([]);
  });

  it('caso ativo sem resultado vira pendente', () => {
    const r = buildParityReport(cases, { camada: 'db', resultados: { 'CP-01': 'ok' } });
    expect(r.ativos).toBe(2);
    expect(r.pendentes).toEqual(['CP-03']);
  });

  it('caso deferred nunca entra no relatorio', () => {
    const r = buildParityReport(cases, { camada: 'api', resultados: {} });
    expect(r.ativos).toBe(2);
    expect(r.linha).not.toContain('CP-04');
  });

  it('a linha segue o formato H115 PARIDADE e nao contem dado de PII', () => {
    const r = buildParityReport(cases, { camada: 'api', resultados: { 'CP-01': 'ok', 'CP-02': 'falha' } });
    expect(r.linha).toBe('H115 PARIDADE camada=api ativos=2 ok=1 falhas=[CP-02] pendentes=[]');
    expect(r.linha).not.toMatch(/@|\+55/);
  });
});
