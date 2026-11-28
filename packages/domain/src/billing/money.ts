// H-046 (Issue 59) | Formatacao de centavos em reais (docs/factory/120-DESENHO-H046.md, §4; CA-H046-13). Funcao pura.
// Sem Intl: a saida nao depende de ICU nem do espaco nao separavel do navegador. Valor invalido vira PlanPricingError.
import { PlanPricingError } from './plans.js';

/** 2990 -> "R$ 29,90"; 123456 -> "R$ 1.234,56". Aceita so inteiro seguro e nao negativo. */
export function formatarCentavosBRL(cents: number): string {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0) {
    throw new PlanPricingError('preco_invalido');
  }
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${inteiro},${String(centavos).padStart(2, '0')}`;
}
