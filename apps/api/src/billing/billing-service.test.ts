// E5 (Issues 60 a 67) | Servico de cobranca com livro e provedor falsos (sem rede, sem banco).
import { describe, expect, it } from 'vitest';
import {
  TEXTO_ADESAO_VERSAO,
  type BillingLedgerPort,
  type CheckoutRegistro,
  type PagamentoDoProvedor,
} from '@fastpro/domain';
import { BillingService, type MercadoPagoPort } from './billing-service.js';
import { criarTravaCobranca, urlDoWebhook } from './billing-composicao.js';
import { createHmac } from 'node:crypto';

const PRO = '11111111-1111-4111-8111-111111111111';
const CK = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2031-01-01T12:00:00.000Z');

function livroFalso() {
  const aplicados: PagamentoDoProvedor[] = [];
  const eventos = new Set<string>();
  const ligadas: string[] = [];
  const divergencias: string[] = [];
  const checkout: CheckoutRegistro = {
    checkoutId: CK,
    professionalId: PRO,
    amountCents: 2990,
    months: 1,
    method: 'pix',
    mode: 'avulso',
    providerRef: 'pref-1',
  };
  const ledger: BillingLedgerPort = {
    async criarCheckout(i) {
      if (i.planCode === 'anual' && i.method === 'pix') return { code: 'not_verified' };
      return {
        code: 'ok',
        checkoutId: CK,
        amountCents: 2990,
        months: 1,
        mode: i.autoRenew ? 'recorrente' : 'avulso',
      };
    },
    async definirReferencia() {
      return true;
    },
    async lerCheckout(ref) {
      if (ref.checkoutId === CK || ref.providerRef === 'plano-1') return checkout;
      return null;
    },
    async aplicarPagamento(p) {
      aplicados.push(p);
      return { code: 'concedido', periodStart: AGORA, periodEnd: AGORA };
    },
    async ligarAssinatura(_c, id) {
      ligadas.push(id);
      return 'ok';
    },
    async cancelarAssinatura() {
      return { code: 'ok', providerSubscriptionId: 'pre-1' };
    },
    async situacao() {
      return {
        estado: 'ativa',
        accessUntil: AGORA,
        planCode: 'mensal',
        mode: 'manual',
        cancelAtPeriodEnd: false,
        autoRenew: false,
        payments: [],
      };
    },
    async registrarEvento(i) {
      const novo = !eventos.has(i.eventKey);
      eventos.add(i.eventKey);
      return { eventId: 'ev-1', novo };
    },
    async concluirEvento() {},
    async alvosReconciliacao() {
      return [{ checkoutId: CK, amountCents: 2990 }];
    },
    async pagamentoNoLivro(id) {
      return id === '900' ? { status: 'aprovado', amountCents: 2990 } : null;
    },
    async registrarDivergencia(d) {
      divergencias.push(`${d.kind}:${d.providerPaymentId}`);
      return true;
    },
  };
  return { ledger, aplicados, ligadas, divergencias };
}

function provedorFalso(over: Partial<MercadoPagoPort> = {}) {
  const chamadas: string[] = [];
  const mp: MercadoPagoPort = {
    async criarPreferencia(i) {
      chamadas.push(`pref:${i.method}:${i.externalReference}`);
      return { id: 'pref-1', init_point: 'https://mp.test/pref' };
    },
    async criarPlanoAssinatura(i) {
      chamadas.push(`plano:${i.ciclo}`);
      return { id: 'plano-1', init_point: 'https://mp.test/plano' };
    },
    async consultarPagamento(id) {
      chamadas.push(`pagamento:${id}`);
      return {
        id: Number(id),
        status: 'approved',
        status_detail: 'accredited',
        date_approved: AGORA.toISOString(),
        external_reference: CK,
        transaction_amount: 29.9,
        payment_type_id: 'bank_transfer',
        payment_method_id: 'pix',
      };
    },
    async consultarAssinatura(id) {
      return { id, status: 'authorized', preapproval_plan_id: 'plano-1' };
    },
    async cancelarAssinatura(id) {
      chamadas.push(`cancelar:${id}`);
      return { id, status: 'cancelled' };
    },
    async consultarCobrancaAutorizada() {
      return { id: 1, payment: { id: 77 } };
    },
    async buscarPagamentos() {
      return [
        {
          id: 900,
          status: 'refunded',
          status_detail: '',
          date_approved: null,
          transaction_amount: 29.9,
        },
        {
          id: 901,
          status: 'approved',
          status_detail: '',
          date_approved: null,
          transaction_amount: 29.9,
        },
      ];
    },
    ...over,
  };
  return { mp, chamadas };
}

function servico(
  over: { mp?: Partial<MercadoPagoPort>; permitida?: boolean; segredo?: string } = {},
) {
  const l = livroFalso();
  const p = provedorFalso(over.mp);
  const s = new BillingService({
    ledger: l.ledger,
    mp: p.mp,
    siteUrl: 'https://fastpro.test',
    ...(over.segredo ? { webhookSecret: over.segredo } : {}),
    cobrancaPermitida: async () => over.permitida ?? true,
    agora: () => AGORA,
  });
  return { s, ...l, ...p };
}

describe('checkout (H-047, H-051)', () => {
  it('Pix e cartao a vista usam a preferencia hospedada; boleto e recusado', async () => {
    const { s, chamadas } = servico();
    const r = await s.iniciarCheckout(PRO, {
      plan: 'mensal',
      method: 'pix',
      autoRenew: false,
      acceptTextVersion: undefined,
    });
    expect(r).toEqual({ code: 'ok', redirectUrl: 'https://mp.test/pref', mode: 'avulso' });
    expect(chamadas).toEqual([`pref:pix:${CK}`]);
    expect(
      (
        await s.iniciarCheckout(PRO, {
          plan: 'mensal',
          method: 'boleto',
          autoRenew: false,
          acceptTextVersion: undefined,
        })
      ).code,
    ).toBe('metodo_invalido');
    expect(
      (
        await s.iniciarCheckout(PRO, {
          plan: 'bienal',
          method: 'pix',
          autoRenew: false,
          acceptTextVersion: undefined,
        })
      ).code,
    ).toBe('plano_invalido');
  });

  it('renovacao no cartao exige a adesao expressa na versao vigente e cria o plano de assinatura', async () => {
    const { s, chamadas } = servico();
    expect(
      (
        await s.iniciarCheckout(PRO, {
          plan: 'mensal',
          method: 'cartao',
          autoRenew: true,
          acceptTextVersion: 'velha',
        })
      ).code,
    ).toBe('adesao_obrigatoria');
    const r = await s.iniciarCheckout(PRO, {
      plan: 'mensal',
      method: 'cartao',
      autoRenew: true,
      acceptTextVersion: TEXTO_ADESAO_VERSAO,
    });
    expect(r).toEqual({ code: 'ok', redirectUrl: 'https://mp.test/plano', mode: 'recorrente' });
    expect(chamadas).toEqual(['plano:1']);
  });

  it('trava de cobranca real bloqueia antes de criar qualquer coisa (H-054)', async () => {
    const { s, chamadas } = servico({ permitida: false });
    expect(
      (
        await s.iniciarCheckout(PRO, {
          plan: 'mensal',
          method: 'pix',
          autoRenew: false,
          acceptTextVersion: undefined,
        })
      ).code,
    ).toBe('cobranca_bloqueada');
    expect(chamadas).toEqual([]);
  });

  it('falha do provedor vira provedor_indisponivel', async () => {
    const { s } = servico({
      mp: { criarPreferencia: async () => Promise.reject(new Error('rede')) },
    });
    expect(
      (
        await s.iniciarCheckout(PRO, {
          plan: 'mensal',
          method: 'pix',
          autoRenew: false,
          acceptTextVersion: undefined,
        })
      ).code,
    ).toBe('provedor_indisponivel');
  });
});

describe('retorno e webhook (H-048, H-049)', () => {
  it('o retorno aplica o pagamento lido no provedor, nao o que veio do navegador', async () => {
    const { s, aplicados } = servico();
    const r = await s.confirmarRetorno(PRO, { paymentId: '555' });
    expect(r.code).toBe('ok');
    expect(aplicados[0]).toMatchObject({
      checkoutId: CK,
      providerPaymentId: '555',
      method: 'pix',
      amountCents: 2990,
      status: 'aprovado',
    });
  });

  it('pagamento de outro profissional responde nao_encontrado', async () => {
    const { s } = servico();
    expect(
      (await s.confirmarRetorno('33333333-3333-4333-8333-333333333333', { paymentId: '555' })).code,
    ).toBe('nao_encontrado');
  });

  it('boleto vindo do provedor nao gera efeito', async () => {
    const { s, aplicados } = servico({
      mp: {
        consultarPagamento: async () => ({
          id: 1,
          status: 'approved',
          status_detail: '',
          date_approved: null,
          external_reference: CK,
          transaction_amount: 29.9,
          payment_type_id: 'ticket',
          payment_method_id: 'bolbradesco',
        }),
      },
    });
    expect((await s.processarPagamento('1')).resultado).toBe('metodo_invalido');
    expect(aplicados).toHaveLength(0);
  });

  it('webhook repetido e processado uma vez so', async () => {
    const { s, aplicados } = servico();
    const ev = {
      topic: 'payment',
      dataId: '555',
      notificationId: 'n1',
      action: 'payment.updated',
      xSignature: undefined,
      xRequestId: undefined,
    };
    expect(await s.receberWebhook(ev)).toEqual({ status: 200, outcome: 'concedido' });
    expect(await s.receberWebhook(ev)).toEqual({ status: 200, outcome: 'duplicado' });
    expect(aplicados).toHaveLength(1);
  });

  it('com segredo, assinatura invalida responde 401 sem gravar; valida processa', async () => {
    const { s, aplicados } = servico({ segredo: 'segredo-de-teste' });
    const base = {
      topic: 'payment',
      dataId: '555',
      notificationId: 'n2',
      action: 'payment.created',
      xRequestId: 'req-1',
    };
    expect((await s.receberWebhook({ ...base, xSignature: 'ts=1,v1=00' })).status).toBe(401);
    expect(aplicados).toHaveLength(0);
    const v1 = createHmac('sha256', 'segredo-de-teste')
      .update('id:555;request-id:req-1;ts:1;')
      .digest('hex');
    expect((await s.receberWebhook({ ...base, xSignature: `ts=1,v1=${v1}` })).status).toBe(200);
    expect(aplicados).toHaveLength(1);
  });

  it('cobranca da assinatura liga a recorrencia e aplica o pagamento gerado', async () => {
    const { s, aplicados, ligadas } = servico({
      mp: {
        consultarPagamento: async (id) => ({
          id: Number(id),
          status: 'approved',
          status_detail: '',
          date_approved: AGORA.toISOString(),
          external_reference: null,
          transaction_amount: 29.9,
          payment_type_id: 'credit_card',
          payment_method_id: 'master',
          metadata: { preapproval_id: 'pre-9' },
        }),
      },
    });
    const r = await s.receberWebhook({
      topic: 'subscription_authorized_payment',
      dataId: '4',
      notificationId: 'n3',
      action: undefined,
      xSignature: undefined,
      xRequestId: undefined,
    });
    expect(r.outcome).toBe('concedido');
    expect(ligadas).toEqual(['pre-9']);
    expect(aplicados[0]).toMatchObject({
      method: 'cartao',
      providerPaymentId: '77',
      providerSubscriptionId: 'pre-9',
    });
  });
});

describe('cancelamento e reconciliacao (H-052, H-053)', () => {
  it('cancela no livro e interrompe a renovacao no provedor', async () => {
    const { s, chamadas } = servico();
    expect(await s.cancelar(PRO)).toEqual({ code: 'ok', provedor: 'ok' });
    expect(chamadas).toEqual(['cancelar:pre-1']);
  });

  it('reconciliacao so registra divergencias', async () => {
    const { s, divergencias, aplicados } = servico();
    expect(await s.reconciliar()).toEqual({ conferidos: 2, divergencias: 2 });
    expect(divergencias).toEqual(['status_divergente:900', 'ausente_no_livro:901']);
    expect(aplicados).toHaveLength(0);
  });
});

describe('montagem', () => {
  it('webhook so com https publico; leva o bypass do preview quando existe', () => {
    expect(urlDoWebhook({ SITE_URL: 'http://127.0.0.1:3010' })).toBeUndefined();
    expect(urlDoWebhook({ SITE_URL: 'https://fastpro.test/' })).toBe(
      'https://fastpro.test/api/v1/billing/webhook/mercadopago',
    );
    expect(
      urlDoWebhook({ SITE_URL: 'https://x.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'abc' }),
    ).toBe(
      'https://x.vercel.app/api/v1/billing/webhook/mercadopago?x-vercel-protection-bypass=abc',
    );
  });

  it('trava: conta de teste libera; conta real em sandbox bloqueia; producao exige liberacao explicita', async () => {
    expect(
      await criarTravaCobranca(
        {},
        { conta: async () => ({ tags: ['test_user'], site_id: 'MLB' }) },
      )(),
    ).toBe(true);
    expect(
      await criarTravaCobranca({}, { conta: async () => ({ tags: ['normal'], site_id: 'MLB' }) })(),
    ).toBe(false);
    expect(
      await criarTravaCobranca(
        { MP_ENV: 'production' },
        { conta: async () => ({ tags: [], site_id: 'MLB' }) },
      )(),
    ).toBe(false);
    expect(
      await criarTravaCobranca(
        { MP_ENV: 'production', BILLING_REAL_CHARGES_ENABLED: '1' },
        { conta: async () => ({ tags: [], site_id: 'MLB' }) },
      )(),
    ).toBe(true);
  });
});

describe('webhook de recurso inexistente', () => {
  it('encerra com 200 em vez de pedir reenvio', async () => {
    const { MercadoPagoError } = await import('./mercado-pago.js');
    const { s } = servico({
      mp: {
        consultarPagamento: async () => Promise.reject(new MercadoPagoError(404, 'not found')),
      },
    });
    const r = await s.receberWebhook({
      topic: 'payment',
      dataId: '1',
      notificationId: 'x',
      action: undefined,
      xSignature: undefined,
      xRequestId: undefined,
    });
    expect(r).toEqual({ status: 200, outcome: 'recurso_inexistente' });
  });
});
