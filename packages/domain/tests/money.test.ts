// H-046 (Issue 59) | Testes unitarios da formatacao de centavos (docs/factory/120-DESENHO-H046.md, §4, T-14; CA-H046-13).
// Sem rede, sem banco. Valores sinteticos e os quatro valores aprovados da carga.
import { describe, it, expect } from 'vitest';
import { PlanPricingError, formatarCentavosBRL } from '../src/billing/index.js';

describe('formatarCentavosBRL (CA-H046-13)', () => {
  it('formata os quatro valores aprovados da carga', () => {
    expect(formatarCentavosBRL(2990)).toBe('R$ 29,90');
    expect(formatarCentavosBRL(8070)).toBe('R$ 80,70');
    expect(formatarCentavosBRL(14940)).toBe('R$ 149,40');
    expect(formatarCentavosBRL(23880)).toBe('R$ 238,80');
  });

  it('separa milhar com ponto e usa virgula decimal', () => {
    expect(formatarCentavosBRL(123456)).toBe('R$ 1.234,56');
    expect(formatarCentavosBRL(100000000)).toBe('R$ 1.000.000,00');
  });

  it('completa centavos com dois digitos e aceita zero', () => {
    expect(formatarCentavosBRL(5)).toBe('R$ 0,05');
    expect(formatarCentavosBRL(0)).toBe('R$ 0,00');
  });

  it('recusa negativo, fracionario, NaN, infinito e alem do inteiro seguro', () => {
    for (const valor of [-1, 29.9, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => formatarCentavosBRL(valor)).toThrow(PlanPricingError);
      try {
        formatarCentavosBRL(valor);
      } catch (erro) {
        expect((erro as PlanPricingError).code).toBe('preco_invalido');
      }
    }
  });
});
