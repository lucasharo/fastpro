// S-03 / H-047 / H-048 | Cliente minimo da API do Mercado Pago (assinatura por preapproval, Pix e cartao).
// Nao le variavel de ambiente: a credencial entra por parametro, para o ambiente ficar na borda da aplicacao.
// Nenhum valor de credencial e registrado em log, erro ou resultado. Valores monetarios entram em centavos
// (RF-055) e saem em reais, como a API exige.
import { randomUUID } from 'node:crypto';

export const MERCADO_PAGO_BASE_URL = 'https://api.mercadopago.com';
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface MercadoPagoOptions {
  /** Credencial de acesso (nome da variavel: MERCADO_PAGO_ACCESS_TOKEN). Nunca registrada. */
  readonly accessToken: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

/** Erro devolvido pela API. Guarda o status e a mensagem literal da API, nunca a credencial. */
export class MercadoPagoError extends Error {
  readonly status: number;
  readonly apiMessage: string;

  constructor(status: number, apiMessage: string) {
    super(`Mercado Pago recusou a requisicao (HTTP ${status}): ${apiMessage}`);
    this.name = 'MercadoPagoError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

/** Meses de cada ciclo aprovado para a assinatura (RF-055 e 30-REFINO-S03 CA-S03-01). */
export type CicloMeses = 1 | 3 | 6 | 12;

export interface PreapprovalInput {
  readonly reason: string;
  readonly payerEmail: string;
  readonly amountCents: number;
  readonly ciclo: CicloMeses;
  readonly backUrl: string;
  readonly externalReference: string;
  /** Token de cartao gerado no navegador pelo Bricks. Ausente: assinatura pendente de adesao. */
  readonly cardTokenId?: string;
  readonly idempotencyKey: string;
}

export interface PaymentInput {
  readonly amountCents: number;
  readonly payerEmail: string;
  readonly description: string;
  readonly externalReference: string;
  readonly idempotencyKey: string;
}

export interface CardPaymentInput extends PaymentInput {
  /** Token gerado no navegador pelo Bricks. O servidor nunca recebe numero, validade ou codigo de seguranca. */
  readonly cardTokenId: string;
  /** Bandeira informada pelo Bricks (ex.: visa, master). */
  readonly paymentMethodId: string;
}

/** Campos do recurso que o sistema usa. A consulta ao recurso e a fonte do estado (RF-060). */
export interface MpPayment {
  readonly id: number;
  readonly status: string;
  readonly status_detail: string;
  readonly date_approved: string | null;
}

export interface MpPreapproval {
  readonly id: string;
  readonly status: string;
}

/** Converte centavos inteiros em reais (2990 -> 29.9, valor de R$ 29,90). */
export function centavosParaReais(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new RangeError('valor em centavos deve ser inteiro positivo');
  }
  return Number((cents / 100).toFixed(2));
}

function mensagemDaApi(json: unknown): string {
  if (typeof json === 'object' && json !== null && 'message' in json) {
    const message = (json as { message: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return 'sem detalhe';
}

export class MercadoPagoClient {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: MercadoPagoOptions) {
    if (options.accessToken.trim() === '') {
      throw new Error('credencial do Mercado Pago ausente');
    }
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? MERCADO_PAGO_BASE_URL;
  }

  /** Cria a assinatura (preapproval) com recorrencia mensal no ciclo escolhido. */
  async criarAssinatura(input: PreapprovalInput): Promise<MpPreapproval> {
    const body: Record<string, unknown> = {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      auto_recurring: {
        frequency: input.ciclo,
        frequency_type: 'months',
        transaction_amount: centavosParaReais(input.amountCents),
        currency_id: 'BRL',
      },
      status: input.cardTokenId ? 'authorized' : 'pending',
    };
    if (input.cardTokenId) body.card_token_id = input.cardTokenId;
    return this.request<MpPreapproval>('POST', '/preapproval', body, input.idempotencyKey);
  }

  /** Consulta a assinatura pelo ID devolvido ao criar (fonte do estado, nao o corpo do webhook). */
  async consultarAssinatura(id: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>('GET', `/preapproval/${encodeURIComponent(id)}`);
  }

  /** Pagamento Pix avulso por ciclo (RF-058). O QR e o codigo ficam na resposta e nao sao registrados. */
  async criarPagamentoPix(input: PaymentInput): Promise<MpPayment> {
    return this.criarPagamento(
      {
        transaction_amount: centavosParaReais(input.amountCents),
        description: input.description,
        payment_method_id: 'pix',
        payer: { email: input.payerEmail },
        external_reference: input.externalReference,
      },
      input.idempotencyKey,
    );
  }

  /** Pagamento com cartao (token do Bricks), sempre a vista. */
  async criarPagamentoCartao(input: CardPaymentInput): Promise<MpPayment> {
    return this.criarPagamento(
      {
        transaction_amount: centavosParaReais(input.amountCents),
        description: input.description,
        token: input.cardTokenId,
        installments: 1,
        payment_method_id: input.paymentMethodId,
        payer: { email: input.payerEmail },
        external_reference: input.externalReference,
      },
      input.idempotencyKey,
    );
  }

  async consultarPagamento(id: number): Promise<MpPayment> {
    return this.request<MpPayment>('GET', `/v1/payments/${id}`);
  }

  private async criarPagamento(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<MpPayment> {
    return this.request<MpPayment>('POST', '/v1/payments', body, idempotencyKey);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey !== undefined) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await this.fetchImpl(this.baseUrl + path, init);
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new MercadoPagoError(res.status, mensagemDaApi(json));
    }
    return json as T;
  }
}

/** Chave de idempotencia nova por operacao (o chamador deve reaproveitar a mesma ao repetir a mesma intencao). */
export function novaChaveIdempotencia(prefixo: string): string {
  return `${prefixo}-${randomUUID()}`;
}
