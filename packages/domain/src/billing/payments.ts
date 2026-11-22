// E5 (Issues 60 a 67, H-047 a H-054) | Cobranca: tipos, porta do livro e traducao pura do recurso do Mercado Pago.
// Sem I/O. O estado vem sempre do recurso consultado no provedor (RF-060), nunca do corpo do webhook.
import type { PlanCode } from './plans.js';
import type { EstadoAcessoComercial } from './types.js';

export type MetodoPagamento = 'cartao' | 'pix';
export type ModoCheckout = 'avulso' | 'recorrente';
export type StatusPagamento = 'aprovado' | 'pendente' | 'recusado' | 'estornado' | 'chargeback';

/** Versao vigente do texto de adesao a renovacao automatica no cartao (H-051). */
export const TEXTO_ADESAO_VERSAO = 'renovacao-cartao-v1';
export const TEXTO_ADESAO =
  'Autorizo a renovação automática da assinatura no cartão a cada ciclo do plano escolhido, pelo valor vigente, até eu cancelar.';

export type CriarCheckoutCodigo =
  'ok' | 'not_verified' | 'plano_invalido' | 'metodo_invalido' | 'adesao_obrigatoria';

export interface CheckoutCriado {
  readonly code: CriarCheckoutCodigo;
  readonly checkoutId?: string;
  readonly amountCents?: number;
  readonly months?: number;
  readonly mode?: ModoCheckout;
}

export interface CheckoutRegistro {
  readonly checkoutId: string;
  readonly professionalId: string;
  readonly amountCents: number;
  readonly months: number;
  readonly method: MetodoPagamento;
  readonly mode: ModoCheckout;
  readonly providerRef: string | null;
}

export type AplicarPagamentoCodigo =
  | 'concedido'
  | 'registrado'
  | 'sem_mudanca'
  | 'checkout_desconhecido'
  | 'valor_divergente'
  | 'metodo_invalido';

export interface PagamentoDoProvedor {
  readonly checkoutId: string;
  readonly providerPaymentId: string;
  readonly method: MetodoPagamento;
  readonly amountCents: number;
  readonly status: StatusPagamento;
  readonly paidAt: Date | null;
  readonly providerUpdatedAt: Date | null;
  readonly providerSubscriptionId: string | null;
}

export interface PagamentoAplicado {
  readonly code: AplicarPagamentoCodigo;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

export interface PagamentoResumo {
  readonly method: MetodoPagamento;
  readonly amountCents: number;
  readonly status: StatusPagamento;
  readonly paidAt: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface SituacaoCobranca {
  readonly estado: EstadoAcessoComercial;
  readonly accessUntil: Date | null;
  readonly planCode: PlanCode | null;
  readonly mode: 'cartao_recorrente' | 'manual' | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly autoRenew: boolean;
  readonly payments: readonly PagamentoResumo[];
}

export interface DivergenciaReconciliacao {
  readonly kind: 'ausente_no_livro' | 'status_divergente' | 'valor_divergente';
  readonly providerPaymentId: string;
  readonly providerStatus: string | null;
  readonly ledgerStatus: string | null;
}

/** Porta do livro de cobranca (adaptador Pg em @fastpro/db). Toda escrita e por funcao do banco. */
export interface BillingLedgerPort {
  criarCheckout(input: {
    professionalId: string;
    planCode: string;
    method: string;
    autoRenew: boolean;
    autoRenewTextVersion: string | null;
    at: Date;
  }): Promise<CheckoutCriado>;
  definirReferencia(checkoutId: string, providerRef: string): Promise<boolean>;
  lerCheckout(ref: { checkoutId?: string; providerRef?: string }): Promise<CheckoutRegistro | null>;
  aplicarPagamento(pagamento: PagamentoDoProvedor, at: Date): Promise<PagamentoAplicado>;
  ligarAssinatura(
    checkoutId: string,
    providerSubscriptionId: string,
    statusProvider: string,
    at: Date,
  ): Promise<string>;
  cancelarAssinatura(
    professionalId: string,
    at: Date,
  ): Promise<{
    code: 'ok' | 'ja_cancelada' | 'sem_assinatura';
    providerSubscriptionId: string | null;
  }>;
  situacao(professionalId: string, at: Date): Promise<SituacaoCobranca>;
  registrarEvento(input: {
    eventKey: string;
    topic: string;
    resourceId: string;
    signatureOk: boolean;
    at: Date;
  }): Promise<{ eventId: string; novo: boolean }>;
  concluirEvento(eventId: string, outcome: string, at: Date): Promise<void>;
  alvosReconciliacao(desde: Date): Promise<readonly { checkoutId: string; amountCents: number }[]>;
  pagamentoNoLivro(
    providerPaymentId: string,
  ): Promise<{ status: string; amountCents: number } | null>;
  registrarDivergencia(d: DivergenciaReconciliacao, at: Date): Promise<boolean>;
}

/** Status do Mercado Pago -> status do livro. Desconhecido vira null (registrado sem efeito). */
export function statusDoProvedor(status: string): StatusPagamento | null {
  switch (status) {
    case 'approved':
      return 'aprovado';
    case 'pending':
    case 'in_process':
    case 'authorized':
    case 'in_mediation':
      return 'pendente';
    case 'rejected':
    case 'cancelled':
      return 'recusado';
    case 'refunded':
      return 'estornado';
    case 'charged_back':
      return 'chargeback';
    default:
      return null;
  }
}

/** Meio do Mercado Pago -> meio aceito. Boleto, lotérica e qualquer outro: null (method_not_supported, H5). */
export function metodoDoProvedor(
  paymentTypeId: string | undefined,
  paymentMethodId: string | undefined,
): MetodoPagamento | null {
  if (paymentTypeId === 'credit_card' || paymentTypeId === 'debit_card') return 'cartao';
  if (paymentTypeId === 'bank_transfer' && paymentMethodId === 'pix') return 'pix';
  return null;
}

/** Valor em reais do provedor -> centavos inteiros (29.9 -> 2990), sem erro de ponto flutuante. */
export function reaisParaCentavos(valor: number): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  return Math.round(valor * 100);
}

/** Identificador de checkout aceito como external_reference (uuid). */
export function ehIdDeCheckout(valor: unknown): valor is string {
  return (
    typeof valor === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)
  );
}
