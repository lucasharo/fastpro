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
  readonly date_last_updated?: string | null;
  readonly external_reference?: string | null;
  readonly transaction_amount?: number;
  readonly payment_type_id?: string;
  readonly payment_method_id?: string;
  /** Pagamento de assinatura: identificador da assinatura (preapproval) quando o provedor informa. */
  readonly metadata?: Record<string, unknown> | null;
  readonly point_of_interaction?: {
    readonly transaction_data?: { readonly subscription_id?: string };
  } | null;
}

export interface MpPreapproval {
  readonly id: string;
  readonly status: string;
  readonly preapproval_plan_id?: string | null;
  readonly external_reference?: string | null;
  readonly init_point?: string;
}

/** Preferencia do checkout hospedado (Checkout Pro): o cartao e o Pix sao digitados no Mercado Pago. */
export interface PreferenceInput {
  readonly title: string;
  readonly amountCents: number;
  readonly externalReference: string;
  readonly method: 'cartao' | 'pix';
  readonly backUrl: string;
  readonly notificationUrl?: string;
  readonly idempotencyKey: string;
}

export interface MpPreference {
  readonly id: string;
  readonly init_point: string;
  readonly sandbox_init_point?: string;
}

/** Plano de assinatura (preapproval_plan) de uma unica intencao: so cartao, renovacao a cada ciclo. */
export interface SubscriptionPlanInput {
  readonly reason: string;
  readonly amountCents: number;
  readonly ciclo: CicloMeses;
  readonly backUrl: string;
  readonly idempotencyKey: string;
}

export interface MpSubscriptionPlan {
  readonly id: string;
  readonly init_point: string;
}

export interface MpAuthorizedPayment {
  readonly id: number | string;
  readonly preapproval_id?: string;
  readonly payment?: { readonly id?: number | string; readonly status?: string } | null;
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

  async consultarPagamento(id: number | string): Promise<MpPayment> {
    return this.request<MpPayment>('GET', `/v1/payments/${encodeURIComponent(String(id))}`);
  }

  /** Checkout hospedado de pagamento avulso por ciclo (Pix ou cartao a vista). Boleto e loterica excluidos (H5). */
  async criarPreferencia(input: PreferenceInput): Promise<MpPreference> {
    const excluidos =
      input.method === 'pix'
        ? ['ticket', 'atm', 'credit_card', 'debit_card', 'prepaid_card']
        : ['ticket', 'atm', 'bank_transfer'];
    const body: Record<string, unknown> = {
      items: [
        {
          title: input.title,
          quantity: 1,
          unit_price: centavosParaReais(input.amountCents),
          currency_id: 'BRL',
        },
      ],
      external_reference: input.externalReference,
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      payment_methods: { excluded_payment_types: excluidos.map((id) => ({ id })), installments: 1 },
      statement_descriptor: 'FASTPRO',
    };
    // O provedor so aceita volta automatica para endereco https (em localhost o usuario clica em voltar).
    if (input.backUrl.startsWith('https://')) body.auto_return = 'approved';
    if (input.notificationUrl) body.notification_url = input.notificationUrl;
    return this.request<MpPreference>('POST', '/checkout/preferences', body, input.idempotencyKey);
  }

  /** Plano de assinatura no cartao com renovacao a cada ciclo (1, 3, 6 ou 12 meses). */
  async criarPlanoAssinatura(input: SubscriptionPlanInput): Promise<MpSubscriptionPlan> {
    return this.request<MpSubscriptionPlan>(
      'POST',
      '/preapproval_plan',
      {
        reason: input.reason,
        back_url: input.backUrl,
        auto_recurring: {
          frequency: input.ciclo,
          frequency_type: 'months',
          transaction_amount: centavosParaReais(input.amountCents),
          currency_id: 'BRL',
        },
        payment_methods_allowed: { payment_types: [{ id: 'credit_card' }] },
      },
      input.idempotencyKey,
    );
  }

  /** Cancela a assinatura no provedor (sem nova cobranca). O acesso ate o fim do periodo e regra do livro. */
  async cancelarAssinatura(id: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>('PUT', `/preapproval/${encodeURIComponent(id)}`, {
      status: 'cancelled',
    });
  }

  /** Cobranca de uma assinatura (topico subscription_authorized_payment): traz o pagamento gerado. */
  async consultarCobrancaAutorizada(id: string): Promise<MpAuthorizedPayment> {
    return this.request<MpAuthorizedPayment>(
      'GET',
      `/authorized_payments/${encodeURIComponent(id)}`,
    );
  }

  /** Pagamentos de uma intencao (reconciliacao): busca por external_reference. */
  async buscarPagamentos(externalReference: string): Promise<readonly MpPayment[]> {
    const r = await this.request<{ results?: MpPayment[] }>(
      'GET',
      `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&limit=50`,
    );
    return Array.isArray(r.results) ? r.results : [];
  }

  /** Conta dona da credencial: usada pela trava de cobranca real (so conta de teste em sandbox). */
  async conta(): Promise<{ readonly tags: readonly string[]; readonly site_id: string }> {
    const r = await this.request<{ tags?: string[]; site_id?: string }>('GET', '/users/me');
    return { tags: Array.isArray(r.tags) ? r.tags : [], site_id: String(r.site_id ?? '') };
  }

  private async criarPagamento(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<MpPayment> {
    return this.request<MpPayment>('POST', '/v1/payments', body, idempotencyKey);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
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
