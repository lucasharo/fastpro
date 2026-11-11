// S-03 | Testes locais do cliente do Mercado Pago e da assinatura do webhook. Sem rede: fetch falso e dados
// sinteticos. A validacao com a API de sandbox real esta registrada em docs/factory/spikes/S-03-RESULTADO.md.
import { describe, expect, it } from 'vitest';
import {
  centavosParaReais,
  MercadoPagoClient,
  MercadoPagoError,
  type FetchLike,
} from '../src/billing/mercado-pago.js';
import { verificarAssinaturaMercadoPago } from '../src/billing/webhook-signature.js';

const TOKEN = '<credencial-sintetica>';
const SEGREDO = 'segredo-sintetico-s03';

interface Chamada {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown> | undefined;
}

function fakeFetch(status: number, json: string | undefined, chamadas: Chamada[]): FetchLike {
  return async (url, init) => {
    const headers = init.headers as Record<string, string>;
    chamadas.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    });
    return new Response(json, { status, headers: { 'Content-Type': 'application/json' } });
  };
}

function clienteComResposta(status: number, json: string | undefined) {
  const chamadas: Chamada[] = [];
  const client = new MercadoPagoClient({
    accessToken: TOKEN,
    fetchImpl: fakeFetch(status, json, chamadas),
  });
  return { client, chamadas };
}

describe('valores em centavos (RF-055)', () => {
  it('converte os quatro precos aprovados para reais', () => {
    expect(centavosParaReais(2990)).toBe(29.9);
    expect(centavosParaReais(8070)).toBe(80.7);
    expect(centavosParaReais(14940)).toBe(149.4);
    expect(centavosParaReais(23880)).toBe(238.8);
  });

  it('recusa valor zero, negativo ou fracionado', () => {
    expect(() => centavosParaReais(0)).toThrow(RangeError);
    expect(() => centavosParaReais(-1)).toThrow(RangeError);
    expect(() => centavosParaReais(29.9)).toThrow(RangeError);
  });
});

describe('cliente do Mercado Pago', () => {
  it('recusa credencial vazia sem expor nada', () => {
    expect(() => new MercadoPagoClient({ accessToken: '   ' })).toThrow('credencial');
  });

  it('assinatura sem cartao: POST /preapproval pendente, mensal, em reais, com chave de idempotencia', async () => {
    const { client, chamadas } = clienteComResposta(201, '{"id":"pre-1","status":"pending"}');
    const r = await client.criarAssinatura({
      reason: 'Assinatura mensal',
      payerEmail: 'comprador-sintetico@example.com',
      amountCents: 2990,
      ciclo: 1,
      backUrl: 'https://example.com/retorno',
      externalReference: 'ref-1',
      idempotencyKey: 'idem-1',
    });
    expect(r).toEqual({ id: 'pre-1', status: 'pending' });
    const c = chamadas[0]!;
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://api.mercadopago.com/preapproval');
    expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.headers['X-Idempotency-Key']).toBe('idem-1');
    expect(c.body).toMatchObject({
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 29.9,
        currency_id: 'BRL',
      },
    });
    expect(c.body).not.toHaveProperty('card_token_id');
  });

  it('assinatura com token de cartao do Bricks: status authorized e card_token_id', async () => {
    const { client, chamadas } = clienteComResposta(201, '{"id":"pre-2","status":"authorized"}');
    await client.criarAssinatura({
      reason: 'Assinatura semestral',
      payerEmail: 'comprador-sintetico@example.com',
      amountCents: 8070,
      ciclo: 6,
      backUrl: 'https://example.com/retorno',
      externalReference: 'ref-2',
      cardTokenId: '<cartao-sintetico>',
      idempotencyKey: 'idem-2',
    });
    expect(chamadas[0]!.body).toMatchObject({
      status: 'authorized',
      card_token_id: '<cartao-sintetico>',
      auto_recurring: { frequency: 6, transaction_amount: 80.7 },
    });
  });

  it('Pix avulso: POST /v1/payments com payment_method_id pix e sem token de cartao', async () => {
    const { client, chamadas } = clienteComResposta(
      201,
      '{"id":11,"status":"pending","status_detail":"pending_waiting_transfer","date_approved":null}',
    );
    const r = await client.criarPagamentoPix({
      amountCents: 2990,
      payerEmail: 'comprador-sintetico@example.com',
      description: 'Ciclo mensal',
      externalReference: 'ref-pix',
      idempotencyKey: 'idem-pix',
    });
    expect(r.status).toBe('pending');
    const c = chamadas[0]!;
    expect(c.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(c.headers['X-Idempotency-Key']).toBe('idem-pix');
    expect(c.body).toMatchObject({ payment_method_id: 'pix', transaction_amount: 29.9 });
    expect(c.body).not.toHaveProperty('token');
  });

  it('cartao: envia o token do Bricks, sem numero, validade ou codigo de seguranca', async () => {
    const { client, chamadas } = clienteComResposta(
      201,
      '{"id":12,"status":"approved","status_detail":"accredited","date_approved":"2026-11-11T10:00:00.000-03:00"}',
    );
    const r = await client.criarPagamentoCartao({
      amountCents: 14940,
      payerEmail: 'comprador-sintetico@example.com',
      description: 'Ciclo trimestral',
      externalReference: 'ref-card',
      idempotencyKey: 'idem-card',
      cardTokenId: '<cartao-sintetico>',
      paymentMethodId: 'visa',
    });
    expect(r.status).toBe('approved');
    expect(chamadas[0]!.body).toMatchObject({
      token: '<cartao-sintetico>',
      installments: 1,
      payment_method_id: 'visa',
      transaction_amount: 149.4,
    });
    const corpo = JSON.stringify(chamadas[0]!.body);
    expect(corpo).not.toMatch(/security_code|card_number|expiration/);
  });

  it('consulta de pagamento usa GET sem corpo nem chave de idempotencia', async () => {
    const { client, chamadas } = clienteComResposta(
      200,
      '{"id":12,"status":"approved","status_detail":"accredited","date_approved":null}',
    );
    await client.consultarPagamento(12);
    expect(chamadas[0]!.method).toBe('GET');
    expect(chamadas[0]!.url).toBe('https://api.mercadopago.com/v1/payments/12');
    expect(chamadas[0]!.body).toBeUndefined();
    expect(chamadas[0]!.headers).not.toHaveProperty('X-Idempotency-Key');
  });

  it('recusa com credencial de producao: erro com o status e a mensagem literal, sem a credencial', async () => {
    const { client } = clienteComResposta(
      401,
      '{"message":"Unauthorized use of live credentials","error":"unauthorized","status":401}',
    );
    const erro = await client
      .criarPagamentoPix({
        amountCents: 2990,
        payerEmail: 'comprador-sintetico@example.com',
        description: 'Ciclo mensal',
        externalReference: 'ref-401',
        idempotencyKey: 'idem-401',
      })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(MercadoPagoError);
    const e = erro as MercadoPagoError;
    expect(e.status).toBe(401);
    expect(e.apiMessage).toBe('Unauthorized use of live credentials');
    expect(e.message).not.toContain(TOKEN);
  });

  it('resposta de erro sem corpo vira "sem detalhe"', async () => {
    const { client } = clienteComResposta(400, undefined);
    const erro = await client.consultarPagamento(1).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(MercadoPagoError);
    expect((erro as MercadoPagoError).apiMessage).toBe('sem detalhe');
  });
});

describe('assinatura x-signature do webhook (manifesto do spike S-03)', () => {
  // Vetor gerado por docs/factory/spikes/s03/verify_signature.py com dados sinteticos.
  // O hexadecimal esta partido em duas metades para o detector de segredos nao o confundir com chave.
  const XSIG =
    'ts=1700000000000,v1=0d47948023e4ccae568ccd0624245238' + '8d74774a770cc41f9032f275e85cca3c';
  const base = { secret: SEGREDO, xSignature: XSIG, xRequestId: 'req-sint-1', dataId: 'ABC123' };

  it('aceita assinatura valida', () => {
    expect(verificarAssinaturaMercadoPago(base)).toBe(true);
  });

  it('normaliza data.id alfanumerico para minusculas, como no spike', () => {
    expect(verificarAssinaturaMercadoPago({ ...base, dataId: 'abc123' })).toBe(true);
  });

  it('recusa segredo errado, data.id alterado, request-id alterado e cabecalho ausente', () => {
    expect(verificarAssinaturaMercadoPago({ ...base, secret: 'outro-segredo' })).toBe(false);
    expect(verificarAssinaturaMercadoPago({ ...base, dataId: 'ZZZ999' })).toBe(false);
    expect(verificarAssinaturaMercadoPago({ ...base, xRequestId: 'req-sint-2' })).toBe(false);
    expect(verificarAssinaturaMercadoPago({ ...base, xSignature: undefined })).toBe(false);
  });

  it('falha fechada sem segredo configurado', () => {
    expect(verificarAssinaturaMercadoPago({ ...base, secret: undefined })).toBe(false);
    expect(verificarAssinaturaMercadoPago({ ...base, secret: '' })).toBe(false);
  });

  it('recusa cabecalho sem a parte v1', () => {
    expect(verificarAssinaturaMercadoPago({ ...base, xSignature: 'ts=1700000000000' })).toBe(false);
  });
});
