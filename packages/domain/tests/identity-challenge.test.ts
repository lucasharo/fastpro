// H-011 | T-H011-01 (normalizacao e codigo) e T-H011-03 (limites). Sem banco, sem rede.
// Desenho: docs/factory/39-DESENHO-H011.md §6.
import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_TTL_SECONDS,
  ChallengeInputError,
  assertChallengePurpose,
  challengeLimitsFrom,
  decideChallengeLimit,
  formatChallengeCode,
  normalizeChallengeEmail,
} from '../src/identity/index.js';

const MIN = 60;
const HOUR = 3600;
const T0 = Date.UTC(2099, 0, 1, 12, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const LIMITS = { minIntervalSeconds: 60, maxPerHour: 5 };

describe('T-H011-01 normalizacao e codigo', () => {
  it('normaliza com trim e minusculas, como o login (H-016)', () => {
    expect(normalizeChallengeEmail('  Ana.Silva@Example.TEST  ')).toBe('ana.silva@example.test');
  });

  it('rejeita vazio e e-mail acima de 254 caracteres', () => {
    expect(() => normalizeChallengeEmail('   ')).toThrow(ChallengeInputError);
    const longo = `${'a'.repeat(250)}@example.test`;
    expect(() => normalizeChallengeEmail(longo)).toThrow(ChallengeInputError);
  });

  it('aceita so login e publish como intencao', () => {
    expect(assertChallengePurpose('login')).toBe('login');
    expect(() => assertChallengePurpose('admin')).toThrow(ChallengeInputError);
  });

  it('formata o codigo com zeros a esquerda e cobre a faixa 000000..999999', () => {
    expect(formatChallengeCode(0)).toBe('000000');
    expect(formatChallengeCode(42)).toBe('000042');
    expect(formatChallengeCode(999_999)).toBe('999999');
    expect(() => formatChallengeCode(1_000_000)).toThrow(RangeError);
    expect(() => formatChallengeCode(-1)).toThrow(RangeError);
    const vistos = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const codigo = formatChallengeCode((i * 7919) % 1_000_000);
      expect(codigo).toMatch(/^[0-9]{6}$/);
      vistos.add(codigo);
    }
    expect(vistos.size).toBe(10_000);
  });

  it('validade fixa de 15 minutos', () => {
    expect(CHALLENGE_TTL_SECONDS).toBe(900);
  });
});

describe('T-H011-03 limites de frequencia', () => {
  it('59 s depois do ultimo pedido bloqueia; 60 s libera', () => {
    const bloqueado = decideChallengeLimit({ nowMs: at(59), createdAtMs: [at(0)], limits: LIMITS });
    expect(bloqueado).toEqual({ decision: 'espera', motivo: 'intervalo', retryAfterSeconds: 1 });
    const liberado = decideChallengeLimit({ nowMs: at(60), createdAtMs: [at(0)], limits: LIMITS });
    expect(liberado).toEqual({ decision: 'permitido' });
  });

  it('4 pedidos na hora permitem o quinto; o sexto recebe espera ate sair o mais antigo', () => {
    const quatro = [at(0), at(120), at(240), at(360)];
    expect(decideChallengeLimit({ nowMs: at(480), createdAtMs: quatro, limits: LIMITS })).toEqual({
      decision: 'permitido',
    });
    const cinco = [...quatro, at(480)];
    const barrado = decideChallengeLimit({ nowMs: at(600), createdAtMs: cinco, limits: LIMITS });
    expect(barrado).toEqual({
      decision: 'espera',
      motivo: 'teto',
      retryAfterSeconds: HOUR - 600,
    });
  });

  it('a janela e movel: pedido com mais de 1 h sai da contagem', () => {
    const cinco = [at(0), at(MIN * 2), at(MIN * 4), at(MIN * 6), at(MIN * 8)];
    const libera = decideChallengeLimit({
      nowMs: at(HOUR + 1),
      createdAtMs: cinco,
      limits: LIMITS,
    });
    expect(libera).toEqual({ decision: 'permitido' });
    const ainda = decideChallengeLimit({ nowMs: at(HOUR - 1), createdAtMs: cinco, limits: LIMITS });
    expect(ainda.decision).toBe('espera');
  });

  it('valores de configuracao fora da faixa caem no padrao', () => {
    expect(challengeLimitsFrom({ minIntervalSeconds: 5, maxPerHour: 99 })).toEqual({
      minIntervalSeconds: 60,
      maxPerHour: 5,
    });
    expect(challengeLimitsFrom({ minIntervalSeconds: '60', maxPerHour: 2.5 })).toEqual({
      minIntervalSeconds: 60,
      maxPerHour: 5,
    });
    expect(challengeLimitsFrom({ minIntervalSeconds: 120, maxPerHour: 3 })).toEqual({
      minIntervalSeconds: 120,
      maxPerHour: 3,
    });
    expect(challengeLimitsFrom({})).toEqual({ minIntervalSeconds: 60, maxPerHour: 5 });
  });
});
