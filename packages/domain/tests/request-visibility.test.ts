// Issue 45 (H-032) | Testes puros da visibilidade de localizacao (docs/factory/127-DESENHO-H032.md, §5, §7; T-09, T-17, T-18).
import { describe, expect, it } from 'vitest';
import {
  ELIGIBLE_PROFESSIONAL_KEYS,
  OWNER_KEYS,
  derivePublicLabel,
  roundDistanceKm,
  visibleKeys,
} from '../src/request/visibility.js';

describe('listas fechadas por papel (CA-09, CA-10, CA-11)', () => {
  it('dono recebe as 11 chaves do desenho, na ordem, sem coordenada nem identificador interno', () => {
    expect(OWNER_KEYS).toEqual([
      'id', 'status', 'serviceId', 'serviceName', 'urgency', 'description', 'firstName',
      'addressText', 'publicLabel', 'publishedAt', 'acceptanceDeadlineAt',
    ]);
    expect(visibleKeys('owner', { addressShared: false })).toEqual(OWNER_KEYS);
  });

  it('profissional elegivel recebe as 10 chaves da RN-10 e nenhuma de endereco, nome ou coordenada', () => {
    expect(ELIGIBLE_PROFESSIONAL_KEYS).toHaveLength(10);
    const chaves: readonly string[] = ELIGIBLE_PROFESSIONAL_KEYS;
    for (const proibida of ['addressText', 'firstName', 'status', 'customerUserId', 'geocodePointId', 'exactPoint', 'cellIndex']) {
      expect(chaves).not.toContain(proibida);
    }
    expect(visibleKeys('eligible_professional', { addressShared: true })).toEqual(ELIGIBLE_PROFESSIONAL_KEYS);
  });

  it('participante: as do profissional + firstName; addressText so com endereco compartilhado (decisao 409)', () => {
    const sem = visibleKeys('participant', { addressShared: false });
    expect(sem).toEqual([...ELIGIBLE_PROFESSIONAL_KEYS, 'firstName']);
    expect(sem).not.toContain('addressText');
    const com = visibleKeys('participant', { addressShared: true });
    expect(com).toEqual([...ELIGIBLE_PROFESSIONAL_KEYS, 'firstName', 'addressText']);
  });

  it('administrador com caso aberto: participante com addressText', () => {
    expect(visibleKeys('admin_with_case', { addressShared: false })).toEqual([
      ...ELIGIBLE_PROFESSIONAL_KEYS, 'firstName', 'addressText',
    ]);
  });
});

describe('distancia para cima em passos de 0,5 km (CA-16, decisao 426)', () => {
  it('fronteiras do desenho: 0, 1, 499, 500, 501, 749, 750, 1000 e 12 345 m', () => {
    const esperado: Array<[number, number]> = [
      [0, 0.5], [1, 0.5], [499, 0.5], [500, 0.5], [501, 1], [749, 1], [750, 1], [1000, 1], [12345, 12.5],
    ];
    for (const [metros, km] of esperado) expect(roundDistanceKm(metros), `${metros} m`).toBe(km);
  });

  it('resultado e sempre multiplo de 0,5, nunca abaixo da distancia real e nunca 0 km', () => {
    for (let m = 0; m <= 30000; m += 137) {
      const km = roundDistanceKm(m);
      expect(km * 2 - Math.round(km * 2)).toBe(0);
      expect(km).toBeGreaterThanOrEqual(0.5);
      expect(km).toBeGreaterThanOrEqual(m / 1000);
    }
  });

  it('distancia invalida e recusada', () => {
    expect(() => roundDistanceKm(-1)).toThrow();
    expect(() => roundDistanceKm(Number.NaN)).toThrow();
  });
});

describe('rotulo publico "Cidade - UF" (CA-14, CA-15, T-17)', () => {
  const casos: Array<[string, string | null]> = [
    ['Rua das Flores 100, Pinheiros, Sao Paulo - SP', 'Sao Paulo - SP'],
    ['Rua das Flores 100, Sao Paulo - SP', 'Sao Paulo - SP'],
    ['Rua das Flores 100, Sao Paulo - SP, 01310-100', null],
    ['Sao Paulo - SP', 'Sao Paulo - SP'],
    ['Sao Paulo/SP', 'Sao Paulo - SP'],
    ['Porto Alegre, RS', 'Porto Alegre - RS'],
    ['Porto Alegre, XX', null],
    ['Rua X sem numero, Curitiba', null],
    ['Cidade 2 - SP', null],
    ['Av. Brasil 500, Joao Pessoa - PB', 'Joao Pessoa - PB'],
    ['Sao Paulo - SP 01310', null],
    ['a@b - SP', null],
  ];
  for (const [entrada, esperado] of casos) {
    it(`"${entrada}" => ${esperado === null ? 'nulo' : esperado}`, () => {
      expect(derivePublicLabel(entrada)).toBe(esperado);
    });
  }

  it('nenhum rotulo contem digito ou arroba, e o tamanho fica entre 3 e 80', () => {
    for (const entrada of ['Sao Paulo - SP', 'Porto Alegre, RS', 'Joao Pessoa - PB']) {
      const r = derivePublicLabel(entrada);
      expect(r).not.toBeNull();
      expect(r ?? '').not.toMatch(/[0-9@]/);
      expect((r ?? '').length).toBeGreaterThanOrEqual(3);
      expect((r ?? '').length).toBeLessThanOrEqual(80);
    }
  });

  it('cidade com mais de 60 caracteres e recusada', () => {
    expect(derivePublicLabel(`${'A'.repeat(61)} - SP`)).toBeNull();
    expect(derivePublicLabel(`${'A'.repeat(60)} - SP`)).toBe(`${'A'.repeat(60)} - SP`);
  });
});
