// Issue 37 (H-024) | Regras puras da cobertura booleana (docs/factory/99-DESENHO-H024.md, §2 e §4.1).
import { describe, it, expect } from 'vitest';
import {
  COVERAGE_CACHE_TTL_S,
  COVERAGE_LIMIT_CUSTOMER_HOUR,
  COVERAGE_LIMIT_IP_HOUR,
  COVERAGE_LIMIT_REQUEST_HOUR,
  COVERAGE_RESULTS,
  coveragePublicValue,
  isCoverageResult,
  isValidCoverageIpKey,
  isValidCoverageLimit,
} from '../src/coverage/coverage-rules.js';

describe('cobertura booleana (Issue 37, H-024): regras puras', () => {
  it('so existem quatro resultados internos; "com" e "sem" sao os unicos valores publicos (CA-01)', () => {
    expect([...COVERAGE_RESULTS]).toEqual(['com', 'sem', 'limite', 'indisponivel']);
    expect(coveragePublicValue('com')).toBe('com');
    expect(coveragePublicValue('sem')).toBe('sem');
    expect(coveragePublicValue('limite')).toBeNull();
    expect(coveragePublicValue('indisponivel')).toBeNull();
  });

  it('valor fora do conjunto nao e resultado valido (ex.: numero ou faixa)', () => {
    for (const v of ['1', '0', '3', 'com 3', 'faixa 1-5', '', null, undefined, 5, true]) {
      expect(isCoverageResult(v)).toBe(false);
    }
    expect(isCoverageResult('com')).toBe(true);
  });

  it('o cache dura cinco minutos (CA-06) e os limites [PROPOSTA] da 99 §2.2 valem', () => {
    expect(COVERAGE_CACHE_TTL_S).toBe(300);
    expect(COVERAGE_LIMIT_IP_HOUR).toBe(60);
    expect(COVERAGE_LIMIT_CUSTOMER_HOUR).toBe(60);
    expect(COVERAGE_LIMIT_REQUEST_HOUR).toBe(20);
  });

  it('limite inteiro entre 1 e 10000; fora disso, invalido', () => {
    expect(isValidCoverageLimit(1)).toBe(true);
    expect(isValidCoverageLimit(10000)).toBe(true);
    for (const v of [0, -1, 10001, 1.5, Number.NaN, '5', null]) {
      expect(isValidCoverageLimit(v)).toBe(false);
    }
  });

  it('chave de IP: 64 caracteres hexadecimais minusculos; IP em claro e invalido', () => {
    expect(isValidCoverageIpKey('a'.repeat(64))).toBe(true);
    expect(isValidCoverageIpKey('A'.repeat(64))).toBe(false);
    expect(isValidCoverageIpKey('a'.repeat(63))).toBe(false);
    expect(isValidCoverageIpKey('192.168.0.1')).toBe(false);
  });

  it('varredura: nenhum nome exportado sugere contagem, lista ou coordenada', () => {
    const nomes = [
      ...Object.keys({
        COVERAGE_CACHE_TTL_S,
        COVERAGE_LIMIT_CUSTOMER_HOUR,
        COVERAGE_LIMIT_IP_HOUR,
        COVERAGE_LIMIT_REQUEST_HOUR,
        coveragePublicValue,
        isCoverageResult,
        isValidCoverageIpKey,
        isValidCoverageLimit,
      }),
    ];
    for (const n of nomes) {
      expect(n).not.toMatch(/count|list|coord|distance|total|lat|lon|cell|radius/i);
    }
  });
});
