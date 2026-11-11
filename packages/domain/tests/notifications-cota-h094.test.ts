// H-094 | TU-01 (alertas 70/85), TU-02 (coerencia dos cortes), TU-03 (constantes imutaveis).
// Sem banco, sem rede. Desenho: docs/factory/59-DESENHO-H094.md §4 e §5.
import { describe, it, expect } from 'vitest';
import { ALERT_THRESHOLDS_PCT, PROVIDER_LIMITS, QUOTA_CUTS, alertLevelFor } from '../src/index.js';

describe('alertLevelFor (TU-01, H-094)', () => {
  it('dia: 69->0, 70->1, 84->1, 85->2, 90->2, 99->2, 100->2', () => {
    const niveis = [69, 70, 84, 85, 90, 99, 100].map((u) => alertLevelFor(u, PROVIDER_LIMITS.dia));
    expect(niveis).toEqual([0, 1, 1, 2, 2, 2, 2]);
  });

  it('mes: 2.099->0, 2.100->1, 2.549->1, 2.550->2, 2.700->2, 3.000->2', () => {
    const niveis = [2099, 2100, 2549, 2550, 2700, 3000].map((u) =>
      alertLevelFor(u, PROVIDER_LIMITS.mes),
    );
    expect(niveis).toEqual([0, 1, 1, 2, 2, 2]);
  });

  it('nunca devolve 3 (o degrau de 95% foi retirado)', () => {
    for (let u = 0; u <= PROVIDER_LIMITS.mes; u += 1) {
      expect(alertLevelFor(u, PROVIDER_LIMITS.mes)).toBeLessThanOrEqual(2);
      expect(alertLevelFor(u, PROVIDER_LIMITS.dia)).toBeLessThanOrEqual(2);
    }
  });
});

describe('coerencia de limites, alertas e cortes (TU-02, H-094)', () => {
  it('ALERT_THRESHOLDS_PCT aplicado a PROVIDER_LIMITS da 70/85 no dia e 2.100/2.550 no mes', () => {
    expect((PROVIDER_LIMITS.dia * ALERT_THRESHOLDS_PCT.nivel1) / 100).toBe(70);
    expect((PROVIDER_LIMITS.dia * ALERT_THRESHOLDS_PCT.nivel2) / 100).toBe(85);
    expect((PROVIDER_LIMITS.mes * ALERT_THRESHOLDS_PCT.nivel1) / 100).toBe(2100);
    expect((PROVIDER_LIMITS.mes * ALERT_THRESHOLDS_PCT.nivel2) / 100).toBe(2550);
  });

  it('o corte de lembrete (70/2.100) e o nivel 1 e o de digest (85/2.550) e o nivel 2', () => {
    expect(QUOTA_CUTS.lembrete).toEqual({ dia: 70, mes: 2100 });
    expect(QUOTA_CUTS.digest).toEqual({ dia: 85, mes: 2550 });
    expect(alertLevelFor(QUOTA_CUTS.lembrete.dia, PROVIDER_LIMITS.dia)).toBe(1);
    expect(alertLevelFor(QUOTA_CUTS.lembrete.mes, PROVIDER_LIMITS.mes)).toBe(1);
    expect(alertLevelFor(QUOTA_CUTS.digest.dia, PROVIDER_LIMITS.dia)).toBe(2);
    expect(alertLevelFor(QUOTA_CUTS.digest.mes, PROVIDER_LIMITS.mes)).toBe(2);
  });

  it('o corte critico e 90/2.700 (corte da classe, nao alerta) e auth usa PROVIDER_LIMITS', () => {
    expect(QUOTA_CUTS.critico).toEqual({ dia: 90, mes: 2700 });
    expect(QUOTA_CUTS.auth).toEqual({ dia: PROVIDER_LIMITS.dia, mes: PROVIDER_LIMITS.mes });
  });
});

describe('constantes imutaveis (TU-03, H-094)', () => {
  it('limites, limiares e cortes estao congelados', () => {
    expect(Object.isFrozen(PROVIDER_LIMITS)).toBe(true);
    expect(Object.isFrozen(ALERT_THRESHOLDS_PCT)).toBe(true);
    expect(Object.isFrozen(QUOTA_CUTS)).toBe(true);
  });
});
