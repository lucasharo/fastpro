// E5 (Issues 60 a 67) | Rotas da cobranca.
//   GET  /v1/billing/plans                  200 {plans:[{code, months, amount_cents}]} (publica)
//   GET  /v1/billing/status                 200 situacao | 401
//   POST /v1/billing/checkout               200 {redirect_url, mode} | 400 | 401 | 403 not_verified | 409 | 422 | 503
//   POST /v1/billing/confirm                200 {resultado, situacao} | 400 | 401 | 404 | 503
//   POST /v1/billing/cancel                 200 {code, provedor} | 401 | 503
//   POST /v1/billing/webhook/mercadopago    200 | 401 (assinatura invalida, com segredo configurado)
// O professional_id vem SEMPRE da sessao. POST de tela exige Origin igual a SITE_URL. Sem detalhe tecnico na resposta.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  TEXTO_ADESAO,
  TEXTO_ADESAO_VERSAO,
  cookieValue,
  type PlanPricingPort,
  type SessionRepositoryPort,
  type SituacaoCobranca,
} from '@fastpro/domain';
import type { BillingService } from './billing-service.js';

export const BILLING_PLANS_PATH = '/v1/billing/plans';
export const BILLING_STATUS_PATH = '/v1/billing/status';
export const BILLING_CHECKOUT_PATH = '/v1/billing/checkout';
export const BILLING_CONFIRM_PATH = '/v1/billing/confirm';
export const BILLING_CANCEL_PATH = '/v1/billing/cancel';
export const BILLING_WEBHOOK_PATH = '/v1/billing/webhook/mercadopago';

export const BILLING_PATHS: readonly string[] = [
  BILLING_PLANS_PATH,
  BILLING_STATUS_PATH,
  BILLING_CHECKOUT_PATH,
  BILLING_CONFIRM_PATH,
  BILLING_CANCEL_PATH,
  BILLING_WEBHOOK_PATH,
];

const CORPO_LIMITE = 8192;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export interface BillingRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly service: BillingService;
  readonly plans: PlanPricingPort;
  readonly siteOrigin: string;
  readonly agora: () => Date;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function cabecalho(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function origemValida(req: IncomingMessage, siteOrigin: string): boolean {
  const fetchSite = cabecalho(req.headers['sec-fetch-site']);
  return (
    cabecalho(req.headers.origin) === siteOrigin &&
    (fetchSite === undefined || fetchSite === 'same-origin')
  );
}

function lerJson(
  req: IncomingMessage,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > CORPO_LIMITE) excedeu = true;
      else partes.push(parte);
    });
    req.on('end', () => {
      if (excedeu) return resolve({ ok: false });
      const texto = Buffer.concat(partes).toString('utf8').trim();
      if (texto === '') return resolve({ ok: true, value: {} });
      try {
        const v: unknown = JSON.parse(texto);
        if (typeof v === 'object' && v !== null && !Array.isArray(v))
          return resolve({ ok: true, value: v as Record<string, unknown> });
      } catch {
        /* corpo invalido */
      }
      resolve({ ok: false });
    });
    req.on('error', () => resolve({ ok: false }));
  });
}

async function profissionalDaSessao(
  req: IncomingMessage,
  opts: BillingRouteOptions,
): Promise<string | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  const sessao = await opts.sessions.authenticate(
    hashSessionSecret(segredo),
    opts.agora().getTime(),
  );
  return sessao?.userId ?? null;
}

function situacaoJson(s: SituacaoCobranca): Record<string, unknown> {
  return {
    estado: s.estado,
    access_until: s.accessUntil?.toISOString() ?? null,
    plan: s.planCode,
    mode: s.mode,
    cancel_at_period_end: s.cancelAtPeriodEnd,
    auto_renew: s.autoRenew,
    payments: s.payments.map((p) => ({
      method: p.method,
      amount_cents: p.amountCents,
      status: p.status,
      paid_at: p.paidAt,
      period_start: p.periodStart,
      period_end: p.periodEnd,
    })),
    auto_renew_text: TEXTO_ADESAO,
    auto_renew_text_version: TEXTO_ADESAO_VERSAO,
  };
}

function idProvedor(v: unknown): string | undefined {
  const s = typeof v === 'number' ? String(v) : v;
  return typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : undefined;
}

async function webhook(
  req: IncomingMessage,
  res: ServerResponse,
  opts: BillingRouteOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const corpo = await lerJson(req);
  const b = corpo.ok ? corpo.value : {};
  const data =
    typeof b.data === 'object' && b.data !== null ? (b.data as Record<string, unknown>) : {};
  const topic =
    (typeof b.type === 'string' ? b.type : undefined) ??
    url.searchParams.get('type') ??
    url.searchParams.get('topic') ??
    undefined;
  const dataId =
    idProvedor(data.id) ??
    idProvedor(url.searchParams.get('data.id')) ??
    idProvedor(url.searchParams.get('id'));
  try {
    const r = await opts.service.receberWebhook({
      topic,
      dataId,
      notificationId: idProvedor(b.id),
      action: typeof b.action === 'string' ? b.action.slice(0, 60) : undefined,
      xSignature: cabecalho(req.headers['x-signature']),
      xRequestId: cabecalho(req.headers['x-request-id']),
    });
    enviar(res, r.status, { ok: r.status === 200 });
  } catch {
    // Falha temporaria: o provedor reenvia (resposta nao 2xx).
    enviar(res, 503, { error: 'servico_indisponivel' });
  }
}

export async function handleBillingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: BillingRouteOptions,
): Promise<void> {
  if (path === BILLING_WEBHOOK_PATH) {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...NO_STORE, Allow: 'POST' });
      res.end();
      return;
    }
    return webhook(req, res, opts);
  }
  if (path === BILLING_PLANS_PATH) {
    if (req.method !== 'GET') {
      res.writeHead(405, { ...NO_STORE, Allow: 'GET' });
      res.end();
      return;
    }
    try {
      const planos = await opts.plans.listAt(opts.agora());
      return enviar(res, 200, {
        plans: planos.map((p) => ({
          code: p.planCode,
          months: p.months,
          amount_cents: p.amountCents,
        })),
      });
    } catch {
      return enviar(res, 503, { error: 'servico_indisponivel' });
    }
  }

  const esperado = path === BILLING_STATUS_PATH ? 'GET' : 'POST';
  if (req.method !== esperado) {
    res.writeHead(405, { ...NO_STORE, Allow: esperado });
    res.end();
    return;
  }
  if (esperado === 'POST' && !origemValida(req, opts.siteOrigin))
    return enviar(res, 403, { error: 'origem_invalida' });

  let professionalId: string | null;
  try {
    professionalId = await profissionalDaSessao(req, opts);
  } catch {
    return enviar(res, 503, { error: 'servico_indisponivel' });
  }
  if (professionalId === null) return enviar(res, 401, { error: 'nao_autenticado' });

  try {
    if (path === BILLING_STATUS_PATH)
      return enviar(res, 200, situacaoJson(await opts.service.situacao(professionalId)));

    const corpo = await lerJson(req);
    if (!corpo.ok) return enviar(res, 400, { error: 'invalid_body' });
    const b = corpo.value;

    if (path === BILLING_CHECKOUT_PATH) {
      if (b.method === 'boleto') return enviar(res, 422, { error: 'method_not_supported' });
      const r = await opts.service.iniciarCheckout(professionalId, {
        plan: b.plan,
        method: b.method,
        autoRenew: b.auto_renew,
        acceptTextVersion: b.accept_text_version,
      });
      if (r.code === 'ok') return enviar(res, 200, { redirect_url: r.redirectUrl, mode: r.mode });
      if (r.code === 'not_verified') return enviar(res, 403, { error: 'not_verified' });
      if (r.code === 'plano_invalido') return enviar(res, 400, { error: 'plano_invalido' });
      if (r.code === 'metodo_invalido') return enviar(res, 422, { error: 'method_not_supported' });
      if (r.code === 'adesao_obrigatoria') return enviar(res, 400, { error: 'adesao_obrigatoria' });
      if (r.code === 'cobranca_bloqueada') return enviar(res, 409, { error: 'cobranca_bloqueada' });
      return enviar(res, 503, { error: 'servico_indisponivel' });
    }
    if (path === BILLING_CONFIRM_PATH) {
      const paymentId = idProvedor(b.payment_id);
      const preapprovalId = idProvedor(b.preapproval_id);
      if (!paymentId && !preapprovalId) return enviar(res, 400, { error: 'invalid_body' });
      const r = await opts.service.confirmarRetorno(professionalId, {
        ...(paymentId ? { paymentId } : {}),
        ...(preapprovalId ? { preapprovalId } : {}),
      });
      if (r.code === 'ok')
        return enviar(res, 200, { resultado: r.resultado, situacao: situacaoJson(r.situacao) });
      if (r.code === 'nao_encontrado') return enviar(res, 404, { error: 'nao_encontrado' });
      return enviar(res, 503, { error: 'servico_indisponivel' });
    }
    if (path === BILLING_CANCEL_PATH) {
      const r = await opts.service.cancelar(professionalId);
      return enviar(res, 200, { code: r.code, provedor: r.provedor });
    }
    return enviar(res, 404, { error: 'nao_encontrado' });
  } catch {
    return enviar(res, 503, { error: 'servico_indisponivel' });
  }
}
