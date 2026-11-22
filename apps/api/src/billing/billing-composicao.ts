// E5 (Issues 60 a 67) | Montagem das rotas de cobranca a partir do ambiente.
// Liga so com DATABASE_URL_APP_SYSTEM, SITE_URL, MERCADO_PAGO_ACCESS_TOKEN e a fabrica de cliente SQL (papel
// app_system). Sem isso devolve undefined e as rotas seguem inexistentes (404). Nunca registra valor de variavel.
// Trava de cobranca real (H-054, Issue 67): com MP_ENV diferente de production, a credencial precisa ser de uma
// conta de teste do Mercado Pago (conferido uma vez por instancia); producao exige BILLING_REAL_CHARGES_ENABLED=1.
import {
  PgSessionRepository,
  createPgBillingLedger,
  createPgPlanPricing,
  type SqlClient,
} from '@fastpro/db';
import { clienteDe } from '../professional-profile-composicao.js';
import { BillingService } from './billing-service.js';
import type { BillingRouteOptions } from './billing-route.js';
import { MercadoPagoClient } from './mercado-pago.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export const BILLING_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'SITE_URL',
  'MERCADO_PAGO_ACCESS_TOKEN',
] as const;

export interface CobrancaOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: { nowMs(): number };
  /** Cliente do provedor injetado (testes). Padrao: cliente real com a credencial do ambiente. */
  readonly mercadoPago?: MercadoPagoClient;
}

export interface CobrancaMontagem {
  readonly options: BillingRouteOptions | undefined;
  readonly service: BillingService | undefined;
  readonly pendencias: readonly string[];
}

/** URL publica do webhook: so com SITE_URL https fora de localhost. No preview protegido, leva o bypass. */
export function urlDoWebhook(env: Ambiente): string | undefined {
  const site = (env.SITE_URL ?? '').trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    return undefined;
  const destino = new URL(`${site}/api/v1/billing/webhook/mercadopago`);
  const bypass = (env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '').trim();
  if (bypass !== '') destino.searchParams.set('x-vercel-protection-bypass', bypass);
  return destino.toString();
}

/** Trava H-054 com memoria por cliente: a conta so e consultada uma vez. Falha de consulta: bloqueia. */
export function criarTravaCobranca(
  env: Ambiente,
  mp: Pick<MercadoPagoClient, 'conta'>,
): () => Promise<boolean> {
  const producao = (env.MP_ENV ?? '').trim() === 'production';
  if (producao) {
    const liberada = (env.BILLING_REAL_CHARGES_ENABLED ?? '').trim() === '1';
    return async () => liberada;
  }
  let resultado: Promise<boolean> | undefined;
  return () => {
    resultado ??= mp
      .conta()
      .then((c) => c.tags.includes('test_user'))
      .catch(() => {
        resultado = undefined;
        return false;
      });
    return resultado;
  };
}

export function montarCobranca(env: Ambiente, opcoes: CobrancaOpcoes = {}): CobrancaMontagem {
  const pendencias: string[] = BILLING_ENV_OBRIGATORIAS.filter((n) => (env[n] ?? '').trim() === '');
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL da cobranca');
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) {
    return { options: undefined, service: undefined, pendencias };
  }
  let siteOrigin: string;
  try {
    siteOrigin = new URL((env.SITE_URL ?? '').trim()).origin;
  } catch {
    return { options: undefined, service: undefined, pendencias: ['SITE_URL (invalida)'] };
  }
  const cliente = clienteDe((env.DATABASE_URL_APP_SYSTEM ?? '').trim(), opcoes.abrirCliente);
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const agora = () => new Date(relogio.nowMs());
  const mp =
    opcoes.mercadoPago ??
    new MercadoPagoClient({ accessToken: (env.MERCADO_PAGO_ACCESS_TOKEN ?? '').trim() });
  const segredo = (env.MP_WEBHOOK_SECRET ?? '').trim();
  const notificacao = urlDoWebhook(env);
  const service = new BillingService({
    ledger: createPgBillingLedger(cliente),
    mp,
    siteUrl: siteOrigin,
    ...(notificacao ? { notificationUrl: notificacao } : {}),
    ...(segredo !== '' ? { webhookSecret: segredo } : {}),
    cobrancaPermitida: criarTravaCobranca(env, mp),
    agora,
  });
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      service,
      plans: createPgPlanPricing(cliente),
      siteOrigin,
      agora,
    },
    service,
    pendencias: [],
  };
}
