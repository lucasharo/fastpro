// Testes unitarios do batimento R-MP (H-114, Issue #123, fatia S6; desenho 165 §5 CA-11 e CA-12).
// Offline: sem banco, sem rede, sem credenciais. Entradas sinteticas com marcador [TESTE-H114]
// e dominios .invalid. Agora e injetado (instante fixo), nunca lido do relogio.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  reconciliarMercadoPagoComLivro,
  mascararIdExterno,
  TOLERANCIA_RMP_MS,
} from '../scripts/lib/runbook-h114-rmp.mjs';

const AGORA = '2026-11-20T12:00:00.000Z';
const HA = (horas) => new Date(Date.parse(AGORA) - horas * 3600_000).toISOString();

// Plano sintetico de 2 h atras (fora da tolerancia) para os casos de achado.
const pagamentoAprovado = (id, amountCents, horas = 3, planCode = 'plano_teste_h114') => ({
  externalId: id,
  status: 'approved',
  amountCents,
  approvedAt: HA(horas),
  planCode,
  subscriptionExternalId: null,
});
const concessaoPaga = (id, amountCents, horas = 3, planCode = 'plano_teste_h114') => ({
  externalId: id,
  grantId: `grant-${id}`,
  kind: 'paid',
  amountCents,
  planCode,
  startsAt: HA(horas),
  endsAt: HA(horas - 720),
  cancelAtPeriodEnd: false,
});

/**
 * Cenario de DEV com exatamente tres divergencias intencionais (CA-11):
 *  - T1: pagamento aprovado no gateway (3 h) sem linha no livro;
 *  - T2: concessao paid com estorno no gateway;
 *  - T3: mesmo pagamento com valor 2000 no gateway e 1900 no livro.
 * Controles que NAO podem gerar achado: pagamento correto e pagamento aprovado ha 30 min.
 */
function cenarioTresDivergencias() {
  return {
    agora: AGORA,
    pagamentos: [
      pagamentoAprovado('TESTE-H114-0001', 1000), // T1 (ausente no livro)
      { ...pagamentoAprovado('TESTE-H114-0002', 1500), status: 'refunded' }, // T2 (estorno)
      pagamentoAprovado('TESTE-H114-0003', 2000), // T3 (valor no livro = 1900)
      pagamentoAprovado('TESTE-H114-0004', 1800), // controle: bate com o livro
      pagamentoAprovado('TESTE-H114-0005', 900, 0.5), // controle: aprovado ha 30 min, dentro da tolerancia
    ],
    livro: [
      concessaoPaga('TESTE-H114-0002', 1500, 3), // paga sem pagamento valido (T2)
      { ...concessaoPaga('TESTE-H114-0003', 1900, 3) }, // T3
      concessaoPaga('TESTE-H114-0004', 1800, 3), // controle
    ],
    precos: [],
  };
}

describe('CA-11: tres divergencias intencionais geram tres achados', () => {
  it('cada divergencia gera exatamente um achado do tipo esperado', () => {
    const r = reconciliarMercadoPagoComLivro(cenarioTresDivergencias());
    expect(r.achados.map((a) => [a.type, a.externalIdMasked])).toEqual([
      ['T1_faltando_local', '***0001'],
      ['T3_valor_divergente', '***0003'],
      ['T2_concessao_sem_pagamento', '***0002'],
    ]);
  });

  it('contagens por tipo batem com os achados (T4 zerado)', () => {
    const r = reconciliarMercadoPagoComLivro(cenarioTresDivergencias());
    expect(r.contagens).toEqual({
      T1_faltando_local: 1,
      T2_concessao_sem_pagamento: 1,
      T3_valor_divergente: 1,
      T4_recorrencia_divergente: 0,
    });
    expect(r.achados).toHaveLength(3);
  });

  it('os controles (pagamento correto e aprovado ha 30 min) nao geram achado', () => {
    const r = reconciliarMercadoPagoComLivro(cenarioTresDivergencias());
    const ids = r.achados.map((a) => a.externalIdMasked);
    expect(ids).not.toContain('***0004');
    expect(ids).not.toContain('***0005');
  });

  it('valores do achado T3 indicam o esperado (gateway) e o encontrado (livro)', () => {
    const r = reconciliarMercadoPagoComLivro(cenarioTresDivergencias());
    const t3 = r.achados.find((a) => a.type === 'T3_valor_divergente');
    expect(t3).toMatchObject({ expected: 2000, found: 1900, severity: 'media' });
  });

  it('o identificador externo nunca sai inteiro na saida', () => {
    const r = reconciliarMercadoPagoComLivro(cenarioTresDivergencias());
    expect(JSON.stringify(r)).not.toContain('TESTE-H114-0001');
    expect(mascararIdExterno('TESTE-H114-0001')).toBe('***0001');
  });
});

describe('CA-12: a entrada nao muda e nada e escrito em billing', () => {
  it('copia profunda antes e depois da execucao e identica', () => {
    const entrada = cenarioTresDivergencias();
    const antes = JSON.stringify(entrada);
    reconciliarMercadoPagoComLivro(entrada);
    expect(JSON.stringify(entrada)).toBe(antes);
  });

  it('entrada somente leitura (proxy que lanca em qualquer escrita) nao dispara escrita', () => {
    const somenteLeitura = (alvo) =>
      new Proxy(alvo, {
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          return v !== null && typeof v === 'object' ? somenteLeitura(v) : v;
        },
        set() {
          throw new Error('escrita proibida na entrada do batimento');
        },
        defineProperty() {
          throw new Error('escrita proibida na entrada do batimento');
        },
        deleteProperty() {
          throw new Error('escrita proibida na entrada do batimento');
        },
      });
    const r = reconciliarMercadoPagoComLivro(somenteLeitura(cenarioTresDivergencias()));
    expect(r.achados).toHaveLength(3);
  });

  it('o modulo nao contem SQL de escrita nem referencia tabelas de cobranca', () => {
    const fonte = readFileSync(
      new URL('../scripts/lib/runbook-h114-rmp.mjs', import.meta.url),
      'utf8',
    );
    expect(fonte).not.toMatch(/\b(insert|update|delete|truncate)\s+(into|from)?\s*\w*\s*(billing|app)\./i);
    expect(fonte).not.toContain('billing.');
    expect(fonte).not.toMatch(/\bquery\s*\(/);
  });
});

describe('regras do batimento', () => {
  it('aprovado ha menos de 2 h fica fora do batimento (T1 nao dispara)', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [pagamentoAprovado('TESTE-H114-0101', 1000, 1.9)],
      livro: [],
    });
    expect(r.contagens.T1_faltando_local).toBe(0);
    expect(r.janela.toleranciaMs).toBe(TOLERANCIA_RMP_MS);
  });

  it('aprovado ha mais de 2 h sem linha no livro dispara T1', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [pagamentoAprovado('TESTE-H114-0102', 1000, 2.5)],
      livro: [],
    });
    expect(r.contagens.T1_faltando_local).toBe(1);
  });

  it('concessao paid recente (menos de 2 h) nao dispara T2', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [],
      livro: [concessaoPaga('TESTE-H114-0103', 1000, 1)],
    });
    expect(r.contagens.T2_concessao_sem_pagamento).toBe(0);
  });

  it('concessao paid com pagamento rejeitado dispara T2 com estado do gateway', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [{ ...pagamentoAprovado('TESTE-H114-0104', 1000), status: 'rejected' }],
      livro: [concessaoPaga('TESTE-H114-0104', 1000, 3)],
    });
    expect(r.achados).toEqual([
      expect.objectContaining({
        type: 'T2_concessao_sem_pagamento',
        externalIdMasked: '***0104',
        found: { status: 'rejected' },
      }),
    ]);
  });

  it('valor igual ao livro mas diferente do preco vigente na data dispara T3', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [pagamentoAprovado('TESTE-H114-0105', 1500, 3)],
      livro: [concessaoPaga('TESTE-H114-0105', 1500, 3)],
      precos: [
        {
          planCode: 'plano_teste_h114',
          amountCents: 1600,
          validoDe: HA(100 * 24),
          validoAte: null,
        },
      ],
    });
    expect(r.achados).toEqual([
      expect.objectContaining({ type: 'T3_valor_divergente', expected: 1600, found: 1500 }),
    ]);
  });

  it('sem preco cadastrado para o plano, a checagem de preco vigente nao gera achado', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [pagamentoAprovado('TESTE-H114-0106', 1500, 3)],
      livro: [concessaoPaga('TESTE-H114-0106', 1500, 3)],
      precos: [],
    });
    expect(r.achados).toEqual([]);
  });

  it('T4 cancelado no gateway e ativo no livro (recorrencia) e reportado', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [{ ...pagamentoAprovado('TESTE-H114-0107', 1000, 5), status: 'cancelled' }],
      livro: [{ ...concessaoPaga('TESTE-H114-0107', 1000, 5), kind: 'recorrencia' }],
    });
    expect(r.contagens.T4_recorrencia_divergente).toBe(1);
    expect(r.achados[0]).toMatchObject({ expected: 'cancelado', found: 'ativo' });
  });

  it('T4 aprovado no gateway e cancelado no livro (ate agora) e reportado', () => {
    const r = reconciliarMercadoPagoComLivro({
      agora: AGORA,
      pagamentos: [pagamentoAprovado('TESTE-H114-0108', 1000, 5)],
      livro: [
        {
          ...concessaoPaga('TESTE-H114-0108', 1000, 5),
          kind: 'recorrencia',
          cancelAtPeriodEnd: true,
          endsAt: HA(1),
        },
      ],
    });
    expect(r.contagens.T4_recorrencia_divergente).toBe(1);
    expect(r.achados[0]).toMatchObject({ expected: 'ativo', found: 'cancelado' });
  });

  it('o instante agora e injetado: o mesmo dado muda de resultado conforme o instante', () => {
    const dado = { pagamentos: [pagamentoAprovado('TESTE-H114-0109', 1000, 2.5)], livro: [] };
    const emAgora = reconciliarMercadoPagoComLivro({ ...dado, agora: AGORA });
    const meiaHoraDepois = reconciliarMercadoPagoComLivro({
      ...dado,
      agora: new Date(Date.parse(AGORA) - 2 * 3600_000 - 1800_000).toISOString(),
    });
    expect(emAgora.contagens.T1_faltando_local).toBe(1);
    expect(meiaHoraDepois.contagens.T1_faltando_local).toBe(0);
  });

  it('pagamento aprovado sem data interrompe o batimento (falha clara, sem achado silencioso)', () => {
    expect(() =>
      reconciliarMercadoPagoComLivro({
        agora: AGORA,
        pagamentos: [{ ...pagamentoAprovado('TESTE-H114-0110', 1000), approvedAt: null }],
        livro: [],
      }),
    ).toThrow(TypeError);
  });

  it('agora invalido e recusado', () => {
    expect(() => reconciliarMercadoPagoComLivro({ agora: 'nao-e-data', pagamentos: [], livro: [] })).toThrow(
      TypeError,
    );
  });
});
