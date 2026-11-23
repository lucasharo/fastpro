// E5 (Issues 60 a 67, H-047 a H-054) | Servico de cobranca pelo Mercado Pago.
//   - Checkout hospedado (o cartao e o Pix sao digitados no Mercado Pago; nenhum dado de cartao passa aqui).
//     Pix e cartao a vista: preferencia do Checkout Pro (pagamento avulso por ciclo, RF-058).
//     Cartao com renovacao: plano de assinatura de uma so intencao (adesao expressa registrada, H-051).
//   - Retorno, webhook e reconciliacao consultam SEMPRE o recurso na API (RF-060), nunca o corpo recebido.
//   - Trava de cobranca real (H-054): so conta de teste, salvo MP_ENV=production com liberacao explicita.
// Nenhuma credencial, e-mail ou dado de pagamento vai a log ou resposta.
import {
  ehCodigoDePlano,
  ehIdDeCheckout,
  metodoDoProvedor,
  reaisParaCentavos,
  statusDoProvedor,
  TEXTO_ADESAO_VERSAO,
  type BillingLedgerPort,
  type CheckoutRegistro,
  type SituacaoCobranca,
} from '@fastpro/domain';
import {
  MercadoPagoError,
  novaChaveIdempotencia,
  type CicloMeses,
  type MercadoPagoClient,
  type MpPayment,
} from './mercado-pago.js';
import { verificarAssinaturaMercadoPago } from './webhook-signature.js';

/** Subconjunto do cliente usado pelo servico (os testes injetam um falso). */
export type MercadoPagoPort = Pick<
  MercadoPagoClient,
  | 'criarPreferencia'
  | 'criarPlanoAssinatura'
  | 'consultarPagamento'
  | 'consultarAssinatura'
  | 'cancelarAssinatura'
  | 'consultarCobrancaAutorizada'
  | 'buscarPagamentos'
>;

export interface BillingServiceDeps {
  readonly ledger: BillingLedgerPort;
  readonly mp: MercadoPagoPort;
  /** Origem publica do site (SITE_URL), para a volta do checkout. */
  readonly siteUrl: string;
  /** URL publica do webhook; ausente em ambiente local (a confirmacao vem pelo retorno). */
  readonly notificationUrl?: string;
  /** Segredo do webhook (MP_WEBHOOK_SECRET). Com ele, assinatura invalida responde 401. */
  readonly webhookSecret?: string;
  /** Trava de cobranca real: resolve true quando cobrar e permitido (sandbox de teste ou liberacao explicita). */
  readonly cobrancaPermitida: () => Promise<boolean>;
  readonly agora: () => Date;
}

const NOMES_PLANO: Record<string, string> = {
  mensal: 'mensal',
  trimestral: 'trimestral',
  semestral: 'semestral',
  anual: 'anual',
};

export type CheckoutResultado =
  | { readonly code: 'ok'; readonly redirectUrl: string; readonly mode: 'avulso' | 'recorrente' }
  | {
      readonly code:
        | 'not_verified'
        | 'plano_invalido'
        | 'metodo_invalido'
        | 'adesao_obrigatoria'
        | 'cobranca_bloqueada'
        | 'provedor_indisponivel';
    };

export type ConfirmacaoResultado =
  | { readonly code: 'ok'; readonly resultado: string; readonly situacao: SituacaoCobranca }
  | { readonly code: 'nao_encontrado' | 'provedor_indisponivel' };

export class BillingService {
  constructor(private readonly deps: BillingServiceDeps) {}

  private voltaUrl(): string {
    return `${this.deps.siteUrl.replace(/\/+$/, '')}/profissional/assinatura?retorno=1`;
  }

  /** H-047 / H-051: cria a intencao e devolve o endereco do checkout hospedado. */
  async iniciarCheckout(
    professionalId: string,
    pedido: { plan: unknown; method: unknown; autoRenew: unknown; acceptTextVersion: unknown },
  ): Promise<CheckoutResultado> {
    if (!ehCodigoDePlano(pedido.plan)) return { code: 'plano_invalido' };
    if (pedido.method !== 'cartao' && pedido.method !== 'pix') return { code: 'metodo_invalido' };
    const renovar = pedido.method === 'cartao' && pedido.autoRenew === true;
    if (renovar && pedido.acceptTextVersion !== TEXTO_ADESAO_VERSAO)
      return { code: 'adesao_obrigatoria' };
    if (!(await this.deps.cobrancaPermitida())) return { code: 'cobranca_bloqueada' };

    const agora = this.deps.agora();
    const criado = await this.deps.ledger.criarCheckout({
      professionalId,
      planCode: pedido.plan,
      method: pedido.method,
      autoRenew: renovar,
      autoRenewTextVersion: renovar ? TEXTO_ADESAO_VERSAO : null,
      at: agora,
    });
    if (criado.code !== 'ok' || !criado.checkoutId || !criado.amountCents || !criado.months) {
      return { code: criado.code === 'ok' ? 'provedor_indisponivel' : criado.code };
    }
    const titulo = `Assinatura FastPro ${NOMES_PLANO[pedido.plan]}`;
    try {
      if (criado.mode === 'recorrente') {
        const plano = await this.deps.mp.criarPlanoAssinatura({
          reason: titulo,
          amountCents: criado.amountCents,
          ciclo: criado.months as CicloMeses,
          backUrl: this.voltaUrl(),
          idempotencyKey: novaChaveIdempotencia(`plano-${criado.checkoutId}`),
        });
        await this.deps.ledger.definirReferencia(criado.checkoutId, plano.id);
        return { code: 'ok', redirectUrl: plano.init_point, mode: 'recorrente' };
      }
      const pref = await this.deps.mp.criarPreferencia({
        title: titulo,
        amountCents: criado.amountCents,
        externalReference: criado.checkoutId,
        method: pedido.method,
        backUrl: this.voltaUrl(),
        ...(this.deps.notificationUrl ? { notificationUrl: this.deps.notificationUrl } : {}),
        idempotencyKey: novaChaveIdempotencia(`pref-${criado.checkoutId}`),
      });
      await this.deps.ledger.definirReferencia(criado.checkoutId, pref.id);
      return { code: 'ok', redirectUrl: pref.init_point, mode: 'avulso' };
    } catch {
      return { code: 'provedor_indisponivel' };
    }
  }

  /** Acha a intencao de um pagamento: external_reference da preferencia ou a assinatura do plano. */
  private async checkoutDoPagamento(
    p: MpPayment,
  ): Promise<{ checkout: CheckoutRegistro; assinatura: string | null } | null> {
    if (ehIdDeCheckout(p.external_reference)) {
      const ck = await this.deps.ledger.lerCheckout({ checkoutId: p.external_reference });
      if (ck) return { checkout: ck, assinatura: null };
    }
    const assinatura =
      (typeof p.metadata?.preapproval_id === 'string' ? p.metadata.preapproval_id : undefined) ??
      p.point_of_interaction?.transaction_data?.subscription_id;
    if (typeof assinatura !== 'string' || assinatura === '') return null;
    const pre = await this.deps.mp.consultarAssinatura(assinatura);
    if (!pre.preapproval_plan_id) return null;
    const ck = await this.deps.ledger.lerCheckout({ providerRef: pre.preapproval_plan_id });
    return ck ? { checkout: ck, assinatura: pre.id } : null;
  }

  /** H-048 / H-049: aplica o pagamento lido no provedor. Devolve o codigo do livro e o dono do pagamento. */
  async processarPagamento(
    paymentId: string,
  ): Promise<{ resultado: string; professionalId: string | null }> {
    const p = await this.deps.mp.consultarPagamento(paymentId);
    const status = statusDoProvedor(p.status);
    if (status === null) return { resultado: 'status_desconhecido', professionalId: null };
    const metodo = metodoDoProvedor(p.payment_type_id, p.payment_method_id);
    if (metodo === null) return { resultado: 'metodo_invalido', professionalId: null };
    const centavos = reaisParaCentavos(Number(p.transaction_amount));
    if (centavos === null) return { resultado: 'valor_divergente', professionalId: null };
    const achado = await this.checkoutDoPagamento(p);
    if (achado === null) return { resultado: 'checkout_desconhecido', professionalId: null };
    if (achado.assinatura) {
      await this.deps.ledger.ligarAssinatura(
        achado.checkout.checkoutId,
        achado.assinatura,
        'authorized',
        this.deps.agora(),
      );
    }
    const aplicado = await this.deps.ledger.aplicarPagamento(
      {
        checkoutId: achado.checkout.checkoutId,
        providerPaymentId: String(p.id),
        method: metodo,
        amountCents: centavos,
        status,
        paidAt: p.date_approved ? new Date(p.date_approved) : null,
        providerUpdatedAt: p.date_last_updated ? new Date(p.date_last_updated) : null,
        providerSubscriptionId: achado.assinatura,
      },
      this.deps.agora(),
    );
    return { resultado: aplicado.code, professionalId: achado.checkout.professionalId };
  }

  /** H-051: liga a assinatura recorrente (preapproval) a intencao pelo plano de assinatura. */
  async processarAssinatura(
    preapprovalId: string,
  ): Promise<{ resultado: string; professionalId: string | null }> {
    const pre = await this.deps.mp.consultarAssinatura(preapprovalId);
    if (!pre.preapproval_plan_id)
      return { resultado: 'checkout_desconhecido', professionalId: null };
    const ck = await this.deps.ledger.lerCheckout({ providerRef: pre.preapproval_plan_id });
    if (!ck) return { resultado: 'checkout_desconhecido', professionalId: null };
    const r = await this.deps.ledger.ligarAssinatura(
      ck.checkoutId,
      pre.id,
      pre.status,
      this.deps.agora(),
    );
    return { resultado: r === 'ok' ? 'assinatura_ligada' : r, professionalId: ck.professionalId };
  }

  /** Volta do checkout: confere pelo recurso e so aceita pagamento ou assinatura do proprio profissional. */
  async confirmarRetorno(
    professionalId: string,
    ref: { paymentId?: string; preapprovalId?: string },
  ): Promise<ConfirmacaoResultado> {
    try {
      let r: { resultado: string; professionalId: string | null } | null = null;
      if (ref.paymentId) r = await this.processarPagamento(ref.paymentId);
      else if (ref.preapprovalId) r = await this.processarAssinatura(ref.preapprovalId);
      if (r === null || r.professionalId !== professionalId) return { code: 'nao_encontrado' };
      return {
        code: 'ok',
        resultado: r.resultado,
        situacao: await this.deps.ledger.situacao(professionalId, this.deps.agora()),
      };
    } catch {
      return { code: 'provedor_indisponivel' };
    }
  }

  /** H-048: webhook. Grava o evento uma vez; so processa evento novo. Assinatura invalida (com segredo): 401. */
  async receberWebhook(input: {
    topic: string | undefined;
    dataId: string | undefined;
    notificationId: string | undefined;
    action: string | undefined;
    xSignature: string | undefined;
    xRequestId: string | undefined;
  }): Promise<{ status: 200 | 401; outcome: string }> {
    const { topic, dataId } = input;
    let assinaturaOk = false;
    if (this.deps.webhookSecret) {
      assinaturaOk = verificarAssinaturaMercadoPago({
        secret: this.deps.webhookSecret,
        xSignature: input.xSignature,
        xRequestId: input.xRequestId,
        dataId,
      });
      if (!assinaturaOk) return { status: 401, outcome: 'assinatura_invalida' };
    }
    if (!topic || !dataId || !/^[A-Za-z0-9_-]{1,64}$/.test(dataId))
      return { status: 200, outcome: 'ignorado' };
    const agora = this.deps.agora();
    const chave = `${topic}:${input.notificationId ?? dataId}:${input.action ?? ''}`.slice(0, 200);
    const evento = await this.deps.ledger.registrarEvento({
      eventKey: chave,
      topic,
      resourceId: dataId,
      signatureOk: assinaturaOk,
      at: agora,
    });
    if (!evento.novo) return { status: 200, outcome: 'duplicado' };
    let outcome = 'ignorado';
    try {
      if (topic === 'payment') outcome = (await this.processarPagamento(dataId)).resultado;
      else if (topic === 'subscription_preapproval')
        outcome = (await this.processarAssinatura(dataId)).resultado;
      else if (topic === 'subscription_authorized_payment') {
        const cobranca = await this.deps.mp.consultarCobrancaAutorizada(dataId);
        const pagamento = cobranca.payment?.id;
        outcome =
          pagamento !== undefined
            ? (await this.processarPagamento(String(pagamento))).resultado
            : 'pendente';
      }
    } catch (erro) {
      // Recurso inexistente no provedor: encerra o evento (reenviar nao muda nada). Outras falhas sobem (503, reenvio).
      if (!(erro instanceof MercadoPagoError) || erro.status !== 404) throw erro;
      outcome = 'recurso_inexistente';
    }
    await this.deps.ledger.concluirEvento(evento.eventId, outcome, this.deps.agora());
    return { status: 200, outcome };
  }

  /** H-052: cancela ao fim do periodo e interrompe a renovacao no provedor. */
  async cancelar(
    professionalId: string,
  ): Promise<{
    code: 'ok' | 'ja_cancelada' | 'sem_assinatura';
    provedor: 'ok' | 'falhou' | 'sem_recorrencia';
  }> {
    const r = await this.deps.ledger.cancelarAssinatura(professionalId, this.deps.agora());
    if (r.code !== 'ok' || !r.providerSubscriptionId)
      return { code: r.code, provedor: 'sem_recorrencia' };
    try {
      await this.deps.mp.cancelarAssinatura(r.providerSubscriptionId);
      return { code: 'ok', provedor: 'ok' };
    } catch {
      // O livro ja nao renova; a reconciliacao aponta a assinatura ainda ativa no provedor.
      return { code: 'ok', provedor: 'falhou' };
    }
  }

  situacao(professionalId: string): Promise<SituacaoCobranca> {
    return this.deps.ledger.situacao(professionalId, this.deps.agora());
  }

  /** H-053: compara os pagamentos do provedor com o livro. So registra divergencias; nunca muda acesso. */
  async reconciliar(dias = 35): Promise<{ conferidos: number; divergencias: number }> {
    const agora = this.deps.agora();
    const desde = new Date(agora.getTime() - dias * 86_400_000);
    const alvos = await this.deps.ledger.alvosReconciliacao(desde);
    let conferidos = 0;
    let divergencias = 0;
    for (const alvo of alvos) {
      const pagamentos = await this.deps.mp.buscarPagamentos(alvo.checkoutId);
      for (const p of pagamentos) {
        conferidos += 1;
        const status = statusDoProvedor(p.status);
        const livro = await this.deps.ledger.pagamentoNoLivro(String(p.id));
        const centavos = reaisParaCentavos(Number(p.transaction_amount));
        let kind: 'ausente_no_livro' | 'status_divergente' | 'valor_divergente' | null = null;
        if (livro === null) kind = status === 'aprovado' ? 'ausente_no_livro' : null;
        else if (centavos !== livro.amountCents) kind = 'valor_divergente';
        else if (status !== null && status !== livro.status) kind = 'status_divergente';
        if (kind === null) continue;
        const nova = await this.deps.ledger.registrarDivergencia(
          {
            kind,
            providerPaymentId: String(p.id),
            providerStatus: p.status,
            ledgerStatus: livro?.status ?? null,
          },
          agora,
        );
        if (nova) divergencias += 1;
      }
    }
    return { conferidos, divergencias };
  }
}
