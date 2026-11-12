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

/** Aplica tentativas que passam e devolve o estado seguinte (falha registrada). */
function falhas(estado: LoginThrottleState, n: number, agora: number): LoginThrottleState {
  let atual = estado;
  for (let i = 0; i < n; i++) {
    const portao = gateProfessionalLogin(atual, agora);
    expect(portao.kind).toBe('tentativa');
    atual = portao.next;
  }
  return atual;
}

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

describe('T-H016-12 contador de tentativas (quatro verificacoes, depois espera)', () => {
  it('as quatro primeiras passam e contam; a quinta e barrada com 30 s e nao conta', () => {
    const estado = falhas(LOGIN_THROTTLE_EMPTY, 4, T0);
    expect(estado.failures).toBe(4);
    const barrada = gateProfessionalLogin(estado, T0);
    expect(barrada.kind).toBe('bloqueada');
    if (barrada.kind !== 'bloqueada') return;
    expect(barrada.retryAfterSeconds).toBe(30);
    expect(barrada.next.failures).toBe(4);
  });

  it('durante a espera nada passa, nem a senha certa, e o pedido nao muda o contador', () => {
    const barrada = gateProfessionalLogin(falhas(LOGIN_THROTTLE_EMPTY, 4, T0), T0);
    if (barrada.kind !== 'bloqueada') throw new Error('esperava bloqueio');
    const durante = gateProfessionalLogin(barrada.next, T0 + 1000);
    expect(durante).toEqual({ kind: 'bloqueada', retryAfterSeconds: 29, next: barrada.next });
  });

  it('depois da espera, uma tentativa passa e conta; se falhar, a espera dobra', () => {
    const barrada = gateProfessionalLogin(falhas(LOGIN_THROTTLE_EMPTY, 4, T0), T0);
    if (barrada.kind !== 'bloqueada') throw new Error('esperava bloqueio');
    const servida = gateProfessionalLogin(barrada.next, T0 + 30_000);
    expect(servida.kind).toBe('tentativa');
    if (servida.kind !== 'tentativa') return;
    expect(servida.next.failures).toBe(5);
    expect(servida.next.lockedUntilMs).toBe(T0 + 30_000 + 30_000);
    const seguinte = gateProfessionalLogin(servida.next, T0 + 61_000);
    expect(seguinte.kind).toBe('tentativa');
    if (seguinte.kind !== 'tentativa') return;
    expect(seguinte.next.failures).toBe(6);
    expect(seguinte.next.lockedUntilMs).toBe(T0 + 61_000 + 60_000);
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
