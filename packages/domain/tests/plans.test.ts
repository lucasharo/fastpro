// H-046 (Issue 59) | Testes unitarios dos planos e precos (docs/factory/120-DESENHO-H046.md, §4 e §6, T-15).
// Sem rede, sem banco. Relogio e porta falsos. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  MOEDA_PLANOS,
  PLAN_CODES,
  PlanPricingError,
  ehCodigoDePlano,
  listarPrecosVigentes,
  lerPrecoVigente,
  type Clock,
  type PlanPrice,
  type PlanPricingPort,
} from '../src/billing/index.js';

const AGORA = new Date('2030-03-01T10:00:00.000Z');

function relogioFixo(instante: unknown): Clock {
  return { now: () => instante as Date };
}

function precoSintetico(code: (typeof PLAN_CODES)[number], months: number, cents: number): PlanPrice {
  return {
    planCode: code,
    months,
    planPriceId: '11111111-2222-4333-8444-555555555555',
    amountCents: cents,
    currency: 'BRL',
  };
}

function portaFalsa(): PlanPricingPort & { chamadas: Array<[string, Date]> } {
  const chamadas: Array<[string, Date]> = [];
  return {
    chamadas,
    listAt: async (at: Date) => {
      chamadas.push(['*', at]);
      return [precoSintetico('mensal', 1, 2990)];
    },
    getAt: async (code, at: Date) => {
      chamadas.push([code, at]);
      return precoSintetico(code, 1, 2990);
    },
  };
}

describe('catalogo fixo de planos (CA-H046-01)', () => {
  it('tem os quatro codigos na ordem crescente de meses e moeda BRL', () => {
    expect([...PLAN_CODES]).toEqual(['mensal', 'trimestral', 'semestral', 'anual']);
    expect(MOEDA_PLANOS).toBe('BRL');
  });

  it('aceita so os quatro codigos', () => {
    for (const code of PLAN_CODES) expect(ehCodigoDePlano(code)).toBe(true);
    for (const valor of ['bienal', 'MENSAL', '', null, undefined, 1]) {
      expect(ehCodigoDePlano(valor)).toBe(false);
    }
  });
});

describe('lerPrecoVigente (CA-H046-03, relogio injetado)', () => {
  it('usa o instante do relogio injetado e devolve o preco da porta', async () => {
    const porta = portaFalsa();
    const preco = await lerPrecoVigente(porta, relogioFixo(AGORA), 'trimestral');
    expect(porta.chamadas).toEqual([['trimestral', AGORA]]);
    expect(preco.planCode).toBe('trimestral');
    expect(preco.amountCents).toBe(2990);
  });

  it('recusa codigo fora do catalogo sem chamar a porta (preco_invalido)', async () => {
    const porta = portaFalsa();
    await expect(
      lerPrecoVigente(porta, relogioFixo(AGORA), 'bienal' as (typeof PLAN_CODES)[number]),
    ).rejects.toMatchObject({ code: 'preco_invalido' });
    expect(porta.chamadas).toHaveLength(0);
  });

  it('relogio com data invalida vira preco_indisponivel sem chamar a porta', async () => {
    const porta = portaFalsa();
    await expect(
      lerPrecoVigente(porta, relogioFixo(new Date('nao-e-data')), 'anual'),
    ).rejects.toBeInstanceOf(PlanPricingError);
    await expect(lerPrecoVigente(porta, relogioFixo('2030-03-01'), 'anual')).rejects.toMatchObject({
      code: 'preco_indisponivel',
    });
    expect(porta.chamadas).toHaveLength(0);
  });
});

describe('listarPrecosVigentes (CA-H046-03, relogio injetado)', () => {
  it('usa o instante do relogio injetado e devolve a lista da porta', async () => {
    const porta = portaFalsa();
    const lista = await listarPrecosVigentes(porta, relogioFixo(AGORA));
    expect(porta.chamadas).toEqual([['*', AGORA]]);
    expect(lista).toHaveLength(1);
  });

  it('relogio invalido vira precos_indisponivel sem chamar a porta', async () => {
    const porta = portaFalsa();
    await expect(listarPrecosVigentes(porta, relogioFixo(new Date(Number.NaN)))).rejects.toMatchObject({
      code: 'precos_indisponivel',
    });
    expect(porta.chamadas).toHaveLength(0);
  });
});

describe('PlanPricingError', () => {
  it('carrega codigo fixo e nome da classe, sem mensagem livre', () => {
    const erro = new PlanPricingError('preco_indisponivel');
    expect(erro.code).toBe('preco_indisponivel');
    expect(erro.message).toBe('preco_indisponivel');
    expect(erro.name).toBe('PlanPricingError');
    expect(erro).toBeInstanceOf(Error);
  });
});
