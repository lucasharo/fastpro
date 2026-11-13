// Issue 46 (H-033) | T-01 (docs/factory/129-DESENHO-H033.md, §8): normalizacao do telefone brasileiro.
// Doze entradas validas e invalidas, mais idempotencia. Valores sinteticos. Sem rede, sem banco.
import { describe, it, expect } from 'vitest';
import { normalizePhoneBr, maskForLog } from '../src/contact/phone.js';

describe('H033 contato | telefone brasileiro', () => {
  it('T-01 | normalizePhoneBr: doze entradas (mascara, DDD, 8 e 9 digitos, +55, letras, vazio) viram E.164 ou nulo', () => {
    const casos: Array<[unknown, string | null]> = [
      ['(11) 98765-4321', '+5511987654321'],
      ['11 98765-4321', '+5511987654321'],
      ['11 8765-4321', '+551187654321'],
      ['+55 11 98765-4321', '+5511987654321'],
      ['+5511987654321', '+5511987654321'],
      ['5511987654321', '+5511987654321'],
      ['55 11 8765-4321', '+551187654321'],
      ['98765-4321', null],
      ['', null],
      ['11 9876-4321a', null],
      ['+1 415 555 2671', null],
      ['(00) 98765-4321', null],
    ];
    expect(casos).toHaveLength(12);
    for (const [entrada, esperado] of casos) {
      expect(normalizePhoneBr(entrada), String(entrada)).toBe(esperado);
    }
  });

  it('T-01 | recusa tipo errado, texto longo demais e numero curto', () => {
    expect(normalizePhoneBr(1198765432)).toBeNull();
    expect(normalizePhoneBr(null)).toBeNull();
    expect(normalizePhoneBr('(11) 9876')).toBeNull();
    expect(normalizePhoneBr(`11 ${'9'.repeat(60)}`)).toBeNull();
  });

  it('T-01 | idempotente: normalizar o resultado devolve o mesmo valor', () => {
    for (const entrada of ['(11) 98765-4321', '55 11 8765-4321', '+5511987654321']) {
      const uma = normalizePhoneBr(entrada);
      expect(uma).not.toBeNull();
      expect(normalizePhoneBr(uma)).toBe(uma);
    }
  });

  it('T-01 | maskForLog nunca devolve o numero completo', () => {
    const mascara = maskForLog('+5511987654321');
    expect(mascara).not.toContain('98765');
    expect(mascara).toContain('21');
  });
});
