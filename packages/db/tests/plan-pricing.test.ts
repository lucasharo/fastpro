// H-046 (Issue 59) | Testes do adaptador Pg de planos e precos (docs/factory/120-DESENHO-H046.md, §4, §6, T-12 e T-15).
// Sem banco e sem rede: cliente falso. Prova parametros posicionais, validacao de linha, codigo fixo de erro
// e que o relogio injetado chega ao banco como instante ISO-8601.
import { describe, it, expect } from 'vitest';
import { PlanPricingError, listarPrecosVigentes, lerPrecoVigente } from '@fastpro/domain';
import { SQL_PLAN_PRICE_AT, createPgPlanPricing } from '../src/plan-pricing.js';
import type { SqlClient } from '../src/jobs-tick.js';

const ID_PRECO = '11111111-2222-4333-8444-555555555555';
const AT = new Date('2030-03-01T10:00:00.000Z');

function clienteFalso(resposta: () => Promise<{ rows: Record<string, unknown>[] }>) {
  const chamadas: Array<{ text: string; params: unknown[] | undefined }> = [];
  const client: SqlClient = {
    query: (text, params) => {
      chamadas.push({ text, params });
      return resposta();
    },
  };
  return { client, chamadas };
}

function linhaMensal(sobrescrita: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_code: 'mensal',
    months: 1,
    plan_price_id: ID_PRECO,
    amount_cents: 2990,
    currency: 'BRL',
    ...sobrescrita,
  };
}

describe('createPgPlanPricing: SQL e parametros', () => {
  it('usa o SQL fixo com parametros posicionais; codigo nulo na listagem', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [linhaMensal()] }));
    await createPgPlanPricing(client).listAt(AT);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.text).toBe(SQL_PLAN_PRICE_AT);
    expect(SQL_PLAN_PRICE_AT).toBe(
      'select plan_code, months, plan_price_id, amount_cents, currency from private.plan_price_at($1::timestamptz, $2::text)',
    );
    expect(chamadas[0]?.params).toEqual(['2030-03-01T10:00:00.000Z', null]);
  });

  it('passa o codigo do plano na leitura de um plano', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [linhaMensal()] }));
    await createPgPlanPricing(client).getAt('mensal', AT);
    expect(chamadas[0]?.params).toEqual(['2030-03-01T10:00:00.000Z', 'mensal']);
  });
});

describe('createPgPlanPricing: mapeamento e contrato', () => {
  it('devolve planCode, months, planPriceId, amountCents e currency (T-12)', async () => {
    const { client } = clienteFalso(async () => ({ rows: [linhaMensal()] }));
    const preco = await createPgPlanPricing(client).getAt('mensal', AT);
    expect(preco).toEqual({
      planCode: 'mensal',
      months: 1,
      planPriceId: ID_PRECO,
      amountCents: 2990,
      currency: 'BRL',
    });
  });

  it('aceita amount_cents e months vindos como texto do driver', async () => {
    const { client } = clienteFalso(async () => ({
      rows: [linhaMensal({ months: '12', amount_cents: '23880', plan_code: 'anual' })],
    }));
    const preco = await createPgPlanPricing(client).getAt('anual', AT);
    expect(preco.amountCents).toBe(23880);
    expect(preco.months).toBe(12);
  });

  it('rejeita linha fora do contrato como preco_invalido (codigo, valor, moeda)', async () => {
    const casos: Array<Record<string, unknown>> = [
      { plan_code: 'bienal' },
      { amount_cents: 0 },
      { amount_cents: 29.9 },
      { amount_cents: null },
      { currency: 'USD' },
      { plan_price_id: 42 },
    ];
    for (const sobrescrita of casos) {
      const { client } = clienteFalso(async () => ({ rows: [linhaMensal(sobrescrita)] }));
      await expect(createPgPlanPricing(client).getAt('mensal', AT)).rejects.toMatchObject({
        code: 'preco_invalido',
      });
    }
  });

  it('zero linhas na leitura de um plano vira preco_indisponivel, nunca valor padrao', async () => {
    const { client } = clienteFalso(async () => ({ rows: [] }));
    await expect(createPgPlanPricing(client).getAt('mensal', AT)).rejects.toMatchObject({
      code: 'preco_indisponivel',
    });
  });

  it('listagem vazia devolve lista vazia (antes da carga, sem valor padrao)', async () => {
    const { client } = clienteFalso(async () => ({ rows: [] }));
    await expect(createPgPlanPricing(client).listAt(AT)).resolves.toEqual([]);
  });
});

describe('createPgPlanPricing: erros e entradas invalidas', () => {
  it('erro do banco vira precos_indisponivel sem repassar a mensagem', async () => {
    const { client } = clienteFalso(async () => {
      throw new Error('segredo do banco: detalhe interno');
    });
    const adaptador = createPgPlanPricing(client);
    const erroLista = await adaptador.listAt(AT).catch((e: unknown) => e);
    expect(erroLista).toBeInstanceOf(PlanPricingError);
    expect((erroLista as PlanPricingError).code).toBe('precos_indisponivel');
    expect((erroLista as PlanPricingError).message).toBe('precos_indisponivel');
    await expect(adaptador.getAt('mensal', AT)).rejects.toMatchObject({ code: 'precos_indisponivel' });
  });

  it('Date invalida ou codigo invalido nao chega ao banco', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [linhaMensal()] }));
    const adaptador = createPgPlanPricing(client);
    await expect(adaptador.listAt(new Date('x'))).rejects.toMatchObject({ code: 'preco_invalido' });
    await expect(
      adaptador.getAt('bienal' as 'mensal', AT),
    ).rejects.toMatchObject({ code: 'preco_invalido' });
    await expect(adaptador.getAt('mensal', new Date('x'))).rejects.toMatchObject({ code: 'preco_invalido' });
    expect(chamadas).toHaveLength(0);
  });
});

describe('relogio injetado chega ao banco (CA-H046-09)', () => {
  it('lerPrecoVigente e listarPrecosVigentes usam o instante do relogio', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [linhaMensal()] }));
    const adaptador = createPgPlanPricing(client);
    const relogio = { now: () => AT };
    await lerPrecoVigente(adaptador, relogio, 'mensal');
    await listarPrecosVigentes(adaptador, relogio);
    expect(chamadas.map((c) => c.params?.[0])).toEqual([
      '2030-03-01T10:00:00.000Z',
      '2030-03-01T10:00:00.000Z',
    ]);
  });
});
