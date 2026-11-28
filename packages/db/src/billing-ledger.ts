// E5 (Issues 60 a 67) | Adaptador Pg do livro de cobranca (migracao 20261122100000_billing_checkout_payment).
// So chama funcoes private.billing_* (papel app_system), com parametros posicionais. Recebe um SqlClient injetado:
// nao abre conexao nem le variavel de ambiente. Erro do banco sobe como BillingLedgerError fixo, sem mensagem do banco.
import {
  aceitarEstado,
  ehCodigoDePlano,
  type AplicarPagamentoCodigo,
  type BillingLedgerPort,
  type CheckoutCriado,
  type CheckoutRegistro,
  type CriarCheckoutCodigo,
  type MetodoPagamento,
  type ModoCheckout,
  type PagamentoResumo,
  type SituacaoCobranca,
  type StatusPagamento,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export class BillingLedgerError extends Error {
  constructor() {
    super('livro_de_cobranca_indisponivel');
    this.name = 'BillingLedgerError';
  }
}

function data(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(valor: unknown): string | null {
  const d = data(valor);
  return d === null ? null : d.toISOString();
}

async function linhas(
  client: SqlClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } catch {
    throw new BillingLedgerError();
  }
}

function comoCheckout(l: Record<string, unknown>): CheckoutRegistro {
  return {
    checkoutId: String(l.out_checkout_id),
    professionalId: String(l.out_professional_id),
    amountCents: Number(l.out_amount_cents),
    months: Number(l.out_months),
    method: l.out_method as MetodoPagamento,
    mode: l.out_mode as ModoCheckout,
    providerRef: typeof l.out_provider_ref === 'string' ? l.out_provider_ref : null,
  };
}

export function createPgBillingLedger(client: SqlClient): BillingLedgerPort {
  return {
    async criarCheckout(input): Promise<CheckoutCriado> {
      const [l] = await linhas(
        client,
        'select * from private.billing_checkout_create($1::uuid, $2::text, $3::text, $4::boolean, $5::text, $6::timestamptz)',
        [
          input.professionalId,
          input.planCode,
          input.method,
          input.autoRenew,
          input.autoRenewTextVersion,
          input.at.toISOString(),
        ],
      );
      if (!l) throw new BillingLedgerError();
      const code = String(l.out_code) as CriarCheckoutCodigo;
      if (code !== 'ok') return { code };
      return {
        code,
        checkoutId: String(l.out_checkout_id),
        amountCents: Number(l.out_amount_cents),
        months: Number(l.out_months),
        mode: l.out_mode as ModoCheckout,
      };
    },
    async definirReferencia(checkoutId, providerRef) {
      const [l] = await linhas(
        client,
        'select private.billing_checkout_set_provider_ref($1::uuid, $2::text) as ok',
        [checkoutId, providerRef],
      );
      return l?.ok === true;
    },
    async lerCheckout(ref) {
      const [l] = await linhas(
        client,
        'select * from private.billing_checkout_get($1::uuid, $2::text)',
        [ref.checkoutId ?? null, ref.providerRef ?? null],
      );
      return l ? comoCheckout(l) : null;
    },
    async aplicarPagamento(p, at) {
      const [l] = await linhas(
        client,
        'select * from private.billing_payment_apply($1::uuid, $2::text, $3::text, $4::integer, $5::text, $6::timestamptz, $7::timestamptz, $8::text, $9::timestamptz)',
        [
          p.checkoutId,
          p.providerPaymentId,
          p.method,
          p.amountCents,
          p.status,
          p.paidAt?.toISOString() ?? null,
          p.providerUpdatedAt?.toISOString() ?? null,
          p.providerSubscriptionId,
          at.toISOString(),
        ],
      );
      if (!l) throw new BillingLedgerError();
      return {
        code: String(l.out_code) as AplicarPagamentoCodigo,
        periodStart: data(l.out_period_start),
        periodEnd: data(l.out_period_end),
      };
    },
    async ligarAssinatura(checkoutId, providerSubscriptionId, statusProvider, at) {
      const [l] = await linhas(
        client,
        'select private.billing_subscription_link($1::uuid, $2::text, $3::text, $4::timestamptz) as code',
        [checkoutId, providerSubscriptionId, statusProvider, at.toISOString()],
      );
      return String(l?.code ?? 'checkout_desconhecido');
    },
    async cancelarAssinatura(professionalId, at) {
      const [l] = await linhas(
        client,
        'select * from private.billing_subscription_cancel($1::uuid, $2::timestamptz)',
        [professionalId, at.toISOString()],
      );
      if (!l) throw new BillingLedgerError();
      return {
        code: String(l.out_code) as 'ok' | 'ja_cancelada' | 'sem_assinatura',
        providerSubscriptionId:
          typeof l.out_provider_subscription_id === 'string'
            ? l.out_provider_subscription_id
            : null,
      };
    },
    async situacao(professionalId, at): Promise<SituacaoCobranca> {
      const [l] = await linhas(
        client,
        'select * from private.billing_status($1::uuid, $2::timestamptz)',
        [professionalId, at.toISOString()],
      );
      if (!l) throw new BillingLedgerError();
      const pagamentos = Array.isArray(l.out_payments)
        ? (l.out_payments as Record<string, unknown>[])
        : [];
      const modo =
        l.out_mode === 'cartao_recorrente' || l.out_mode === 'manual' ? l.out_mode : null;
      return {
        estado: aceitarEstado(l.out_estado),
        accessUntil: data(l.out_access_until),
        planCode: ehCodigoDePlano(l.out_plan_code) ? l.out_plan_code : null,
        mode: modo,
        cancelAtPeriodEnd: l.out_cancel_at_period_end === true,
        autoRenew: l.out_auto_renew === true,
        payments: pagamentos.map((p): PagamentoResumo => ({
          method: p.method as MetodoPagamento,
          amountCents: Number(p.amount_cents),
          status: p.status as StatusPagamento,
          paidAt: iso(p.paid_at),
          periodStart: iso(p.period_start),
          periodEnd: iso(p.period_end),
        })),
      };
    },
    async registrarEvento(input) {
      const [l] = await linhas(
        client,
        'select * from private.billing_event_record($1::text, $2::text, $3::text, $4::boolean, $5::timestamptz)',
        [input.eventKey, input.topic, input.resourceId, input.signatureOk, input.at.toISOString()],
      );
      if (!l) throw new BillingLedgerError();
      return { eventId: String(l.out_event_id), novo: l.out_new === true };
    },
    async concluirEvento(eventId, outcome, at) {
      await linhas(
        client,
        'select private.billing_event_finish($1::uuid, $2::text, $3::timestamptz)',
        [eventId, outcome, at.toISOString()],
      );
    },
    async alvosReconciliacao(desde) {
      const ls = await linhas(
        client,
        'select * from private.billing_reconciliation_targets($1::timestamptz)',
        [desde.toISOString()],
      );
      return ls.map((l) => ({
        checkoutId: String(l.out_checkout_id),
        amountCents: Number(l.out_amount_cents),
      }));
    },
    async pagamentoNoLivro(providerPaymentId) {
      const [l] = await linhas(client, 'select * from private.billing_payment_ledger($1::text)', [
        providerPaymentId,
      ]);
      return l ? { status: String(l.out_status), amountCents: Number(l.out_amount_cents) } : null;
    },
    async registrarDivergencia(d, at) {
      const [l] = await linhas(
        client,
        'select private.billing_reconciliation_record($1::text, $2::text, $3::text, $4::text, $5::timestamptz) as novo',
        [d.kind, d.providerPaymentId, d.providerStatus, d.ledgerStatus, at.toISOString()],
      );
      return l?.novo === true;
    },
  };
}
