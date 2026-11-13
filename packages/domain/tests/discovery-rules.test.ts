// Issue 36 (H-023) | Regras puras da descoberta (docs/factory/97-DESENHO-H023.md, §2.1, §4 e §7).
import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_PAGE_MAX,
  DISCOVERY_RADIUS_MAX_M,
  DISCOVERY_RADIUS_MIN_M,
  discoveryUncertaintyM,
  isValidDiscoveryCursor,
  isValidDiscoveryLimit,
  isValidDiscoveryRadius,
} from '../src/discovery/index.js';

describe('raio da descoberta (CA-04)', () => {
  it('aceita 5.000 e 100.000 e recusa 4.999, 100.001, zero, negativo, fracionario e ausente', () => {
    expect(DISCOVERY_RADIUS_MIN_M).toBe(5000);
    expect(DISCOVERY_RADIUS_MAX_M).toBe(100000);
    expect(isValidDiscoveryRadius(5000)).toBe(true);
    expect(isValidDiscoveryRadius(100000)).toBe(true);
    for (const r of [4999, 100001, 0, -1, 5000.5, null, undefined, Number.NaN]) {
      expect(isValidDiscoveryRadius(r)).toBe(false);
    }
  });

  it('faixa de incerteza: 710 m mais 0,3 % do raio (decisao 104)', () => {
    expect(discoveryUncertaintyM(5000)).toBeCloseTo(725, 6);
    expect(discoveryUncertaintyM(20000)).toBeCloseTo(770, 6);
    expect(discoveryUncertaintyM(100000)).toBeCloseTo(1010, 6);
  });
});

describe('limite de pagina e cursor (CA-12)', () => {
  it('limite de 1 a 200', () => {
    expect(isValidDiscoveryLimit(1)).toBe(true);
    expect(isValidDiscoveryLimit(DISCOVERY_PAGE_MAX)).toBe(true);
    for (const l of [0, 201, 1.5, null, undefined]) expect(isValidDiscoveryLimit(l)).toBe(false);
  });

  it('cursor ausente ou completo; grupo fora de 0 e 1, chave negativa e id vazio sao recusados', () => {
    expect(isValidDiscoveryCursor(null)).toBe(true);
    expect(isValidDiscoveryCursor({ group: 1, key: 0, requestId: 'a' })).toBe(true);
    expect(isValidDiscoveryCursor({ group: 2 as 0, key: 0, requestId: 'a' })).toBe(false);
    expect(isValidDiscoveryCursor({ group: 0, key: -1, requestId: 'a' })).toBe(false);
    expect(isValidDiscoveryCursor({ group: 0, key: 5, requestId: '' })).toBe(false);
  });
});
