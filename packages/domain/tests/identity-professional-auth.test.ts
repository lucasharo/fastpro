// H-016 | Testes puros do login e do cadastro do profissional (docs/factory/33-DESENHO-H016.md §2.6, §3.1,
// §5.1; CA-H016-03, CA-H016-12). Relogio injetado, sem rede, sem banco. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  checkProfessionalRegister,
  gateProfessionalLogin,
  isProfessionalLinkToken,
  LOGIN_THROTTLE_EMPTY,
  loginEmailOrNull,
  loginPasswordOrNull,
  professionalLoginWaitSeconds,
  PROFESSIONAL_LOGIN_RESET_AFTER_MS,
} from '../src/identity/index.js';

const T0 = Date.UTC(2099, 0, 1, 12);

describe('T-H016-12 espera do login (33 §2.6)', () => {
  it('nao espera ate a 4a falha; a 5a gera 30 s e dobra ate o teto de 900 s', () => {
    expect([1, 2, 3, 4].map(professionalLoginWaitSeconds)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 11].map(professionalLoginWaitSeconds)).toEqual([30, 60, 120, 240, 480, 900, 900]);
  });

  it('rejeita contagem invalida', () => {
    expect(() => professionalLoginWaitSeconds(0)).toThrow(RangeError);
    expect(() => professionalLoginWaitSeconds(1.5)).toThrow(RangeError);
  });
});

describe('T-H016-12 contador de tentativas', () => {
  it('a tentativa ja nasce contada; durante a espera nada avanca', () => {
    let estado = LOGIN_THROTTLE_EMPTY;
    for (let i = 0; i < 5; i++) {
      const portao = gateProfessionalLogin(estado, T0);
      expect(portao.kind).toBe('tentativa');
      if (portao.kind === 'tentativa') estado = portao.next;
    }
    expect(estado.failures).toBe(5);
    const bloqueada = gateProfessionalLogin(estado, T0 + 1000);
    expect(bloqueada).toEqual({ kind: 'bloqueada', retryAfterSeconds: 29 });
    expect(gateProfessionalLogin(estado, T0 + 1000)).toEqual(bloqueada);
  });

  it('depois da espera a tentativa passa de novo', () => {
    const estado = { failures: 5, lastFailureMs: T0, lockedUntilMs: T0 + 30_000 };
    const portao = gateProfessionalLogin(estado, T0 + 30_000);
    expect(portao.kind).toBe('tentativa');
  });

  it('zera o contador apos 24 h sem falha', () => {
    const antigo = { failures: 7, lastFailureMs: T0, lockedUntilMs: null };
    const portao = gateProfessionalLogin(antigo, T0 + PROFESSIONAL_LOGIN_RESET_AFTER_MS + 1);
    expect(portao.kind === 'tentativa' && portao.next.failures).toBe(1);
  });
});

describe('T-H016-03 forma do cadastro e do login (33 §3.1)', () => {
  it('normaliza o e-mail (espacos e caixa) e devolve a senha ja validada', () => {
    const r = checkProfessionalRegister({ email: '  Pessoa.Sintetica@Example.TEST ', password: 'senha-sintetica-x' });
    expect(r).toEqual({ ok: true, email: 'pessoa.sintetica@example.test', password: 'senha-sintetica-x' });
  });

  it('recusa corpo sem campos com a indicacao do campo, nunca com a senha', () => {
    expect(checkProfessionalRegister(undefined)).toEqual({ ok: false, campo: 'email', motivo: 'email' });
    expect(checkProfessionalRegister({ email: 'a@b.test', password: 7 })).toEqual({
      ok: false,
      campo: 'password',
      motivo: 'tipo',
    });
  });

  it('login: e-mail e senha de forma, com teto de 72 bytes na senha', () => {
    expect(loginEmailOrNull('  X@Y.test ')).toBe('x@y.test');
    expect(loginEmailOrNull('sem-arroba')).toBeNull();
    expect(loginEmailOrNull(12)).toBeNull();
    expect(loginPasswordOrNull('')).toBeNull();
    expect(loginPasswordOrNull('ç'.repeat(36))).toBe('ç'.repeat(36));
    expect(loginPasswordOrNull('ç'.repeat(37))).toBeNull();
  });

  it('token de verificacao: exatamente 43 caracteres base64url', () => {
    expect(isProfessionalLinkToken('a'.repeat(43))).toBe(true);
    expect(isProfessionalLinkToken('a'.repeat(42))).toBe(false);
    expect(isProfessionalLinkToken('a'.repeat(43) + '=')).toBe(false);
    expect(isProfessionalLinkToken(undefined)).toBe(false);
  });
});
