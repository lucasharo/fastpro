// H-025 (D-11) | Montagem da sugestao de endereco (H-020) em producao, ligada ao rascunho real.
// Docs: docs/factory/56-DESENHO-H020.md (§2.1, §2.3, §4.1, §4.2) e 74-DESENHO-H025.md (§1, §3 R5).
// So monta a rota (POST /v1/geo/address-suggest) com as variaveis completas e com o rascunho ligado.
// Sem qualquer uma delas, undefined: a rota continua inexistente (404). Nenhum valor e registrado; so nomes.
import type { SqlClient } from '@fastpro/db';
import type { DraftRatePolicy, DraftRatePort } from '@fastpro/domain';
import type { DraftHasher } from '../drafts/draft-hash.js';
import type { DraftRouteOptions } from '../drafts/draft-route.js';
import { createDraftGate } from '../drafts/draft-gate.js';
import type { AddressSuggestDeps } from './address-suggest-service.js';
import type { GeoRouteOptions } from './address-suggest-route.js';
import { createMapboxTempAdapter } from './mapbox-temp-adapter.js';
import type { ClockPort, QuotaAlertSink, QuotaPort, RateCheck, RateLimitPort } from './ports.js';

/** Variaveis da sugestao (nomes de .env.example). O token nunca e registrado. */
export const MAPBOX_TOKEN_ENV = 'MAPBOX_ACCESS_TOKEN' as const;
export const DATABASE_URL_APP_SYSTEM_ENV = 'DATABASE_URL_APP_SYSTEM' as const;
export const MAPBOX_TEMP_SOFT_ENV = 'MAPBOX_TEMP_SOFT_LIMIT' as const;
export const MAPBOX_TEMP_HARD_ENV = 'MAPBOX_TEMP_HARD_LIMIT' as const;
/** Interruptor: so 'false' desliga (padrao ligado, 56 §2.2 passo 1). */
export const ADDRESS_SUGGEST_ENABLED_ENV = 'ADDRESS_SUGGEST_ENABLED' as const;
/** Teto do banco (private.mapbox_temp_quota_take, 99.000) e abaixo das 100.000 gratuitas. */
export const MAPBOX_TEMP_HARD_MAX = 99_000;

/** Limites de taxa da sugestao (56 §4.1): 30 por 60 s por rascunho e 60 por 60 s por IP-HMAC. */
export const SUGESTAO_RATE_RASCUNHO: DraftRatePolicy = {
  id: 'salvar_rascunho',
  spanS: 60,
  bucketS: 10,
  limit: 30,
};
export const SUGESTAO_RATE_IP: DraftRatePolicy = {
  id: 'salvar_ip',
  spanS: 60,
  bucketS: 10,
  limit: 60,
};

/** SQL da reserva de cota (papel app_system). Mesma assinatura da migracao 20261111260000. */
export const SQL_MAPBOX_TEMP_QUOTA_TAKE =
  'select out_ok, out_novo_alerta, out_used from private.mapbox_temp_quota_take($1::timestamptz, $2::integer, $3::integer)';

type Env = Readonly<Record<string, string | undefined>>;

/** Um cliente SQL por URL, reaproveitado entre chamadas (a composicao roda a cada pedido na Vercel). */
export function memoizarCliente(
  abrir: (connectionString: string) => SqlClient,
): (connectionString: string) => SqlClient {
  const clientes = new Map<string, SqlClient>();
  return (connectionString) => {
    let cliente = clientes.get(connectionString);
    if (cliente === undefined) {
      cliente = abrir(connectionString);
      clientes.set(connectionString, cliente);
    }
    return cliente;
  };
}

function inteiroNoIntervalo(valor: string | undefined, min: number, max: number): number | null {
  if (valor === undefined || !/^\d+$/.test(valor.trim())) return null;
  const n = Number(valor.trim());
  return n >= min && n <= max ? n : null;
}

/** Limites da cota lidos do ambiente, ou null quando faltam ou nao cabem (soft <= hard <= 99.000). */
export function limitesCotaTemp(env: Env): { readonly soft: number; readonly hard: number } | null {
  const hard = inteiroNoIntervalo(env[MAPBOX_TEMP_HARD_ENV], 1, MAPBOX_TEMP_HARD_MAX);
  const soft = inteiroNoIntervalo(env[MAPBOX_TEMP_SOFT_ENV], 0, MAPBOX_TEMP_HARD_MAX);
  if (hard === null || soft === null || soft > hard) return null;
  return { soft, hard };
}

/** Nomes (nunca valores) que impedem a sugestao de ligar. Vazio = pode montar. */
export function faltantesSugestao(env: Env): string[] {
  const faltam: string[] = [];
  if (!(env[MAPBOX_TOKEN_ENV] ?? '').trim()) faltam.push(MAPBOX_TOKEN_ENV);
  if (!(env[DATABASE_URL_APP_SYSTEM_ENV] ?? '').trim()) faltam.push(DATABASE_URL_APP_SYSTEM_ENV);
  if (limitesCotaTemp(env) === null)
    faltam.push(`${MAPBOX_TEMP_SOFT_ENV}/${MAPBOX_TEMP_HARD_ENV} (ausente ou invalida)`);
  return faltam;
}

/** Cota mensal do geocodificador temporario sobre o papel app_system (funcao de 20261111260000). */
export class PgMapboxTempQuota implements QuotaPort {
  constructor(
    private readonly client: SqlClient,
    private readonly limites: { readonly soft: number; readonly hard: number },
  ) {}

  async take(now: Date) {
    const res = await this.client.query(SQL_MAPBOX_TEMP_QUOTA_TAKE, [
      now.toISOString(),
      this.limites.soft,
      this.limites.hard,
    ]);
    const l = res.rows[0] as
      { out_ok?: unknown; out_novo_alerta?: unknown; out_used?: unknown } | undefined;
    if (
      typeof l?.out_ok !== 'boolean' ||
      typeof l.out_novo_alerta !== 'boolean' ||
      typeof l.out_used !== 'number'
    ) {
      throw new Error('cota_resposta_invalida');
    }
    return { ok: l.out_ok, novoAlerta: l.out_novo_alerta, used: l.out_used };
  }
}

/**
 * Limite de taxa da sugestao sobre o mesmo limite do rascunho (rl_check / rl_hit do papel app_api).
 * Principal = id do rascunho; IP entra so como HMAC. Cheque as duas chaves antes de contar.
 */
export class RateSugestao implements RateLimitPort {
  constructor(
    private readonly rate: DraftRatePort,
    private readonly hasher: DraftHasher,
    private readonly clock: ClockPort,
  ) {}

  async check(principal: string, ip: string): Promise<RateCheck> {
    const agora = this.clock.nowMs();
    const porRascunho = await this.rate.check(SUGESTAO_RATE_RASCUNHO, principal, agora);
    if (!porRascunho.ok) return { ok: false, retryAfterS: porRascunho.retryAfterS };
    const porIp = await this.rate.check(SUGESTAO_RATE_IP, this.hasher.ipHmac(ip), agora);
    if (!porIp.ok) return { ok: false, retryAfterS: porIp.retryAfterS };
    return { ok: true };
  }

  async hit(principal: string, ip: string): Promise<void> {
    const agora = this.clock.nowMs();
    await this.rate.hit(SUGESTAO_RATE_RASCUNHO, principal, agora);
    await this.rate.hit(SUGESTAO_RATE_IP, this.hasher.ipHmac(ip), agora);
  }
}

export interface SugestaoComposicaoOpcoes {
  /** Abre um cliente SQL por URL (memoizado pelo chamador). Usado so para a cota (app_system). */
  readonly abrirCliente: (connectionString: string) => SqlClient;
  /** Rascunho ja montado (store, hasher, relogio e limite de taxa). Sem ele, a rota nao existe. */
  readonly rascunho: DraftRouteOptions | undefined;
  /** fetch do provedor. Padrao: o global. Nos testes, uma fixture sintetica. */
  readonly fetchImpl?: typeof fetch;
  /** Alerta de cota (log mapbox_quota_alert e aviso). Padrao: nao faz nada nesta fase (sem logger na API). */
  readonly alertaCota?: QuotaAlertSink;
}

/**
 * Opcoes da rota de sugestao, ou undefined (404). Liga so com as variaveis completas e o rascunho
 * montado. A porta de rascunho e a real (createDraftGate): so rascunho vivo chega ao provedor.
 */
export function montarSugestaoEndereco(
  env: Env,
  opcoes: SugestaoComposicaoOpcoes,
): GeoRouteOptions | undefined {
  const rascunho = opcoes.rascunho;
  if (rascunho === undefined || faltantesSugestao(env).length > 0) return undefined;
  const limites = limitesCotaTemp(env);
  const url = (env[DATABASE_URL_APP_SYSTEM_ENV] ?? '').trim();
  if (limites === null || url === '') return undefined;

  const { store, hasher, clock } = rascunho.deps;
  const deps: AddressSuggestDeps = {
    gate: createDraftGate({ store, hasher, clock }),
    rate: new RateSugestao(rascunho.deps.rate, hasher, clock),
    quota: new PgMapboxTempQuota(opcoes.abrirCliente(url), limites),
    provider: createMapboxTempAdapter({
      token: (env[MAPBOX_TOKEN_ENV] ?? '').trim(),
      fetchImpl: opcoes.fetchImpl ?? globalThis.fetch,
    }),
    clock,
    onQuotaAlert: opcoes.alertaCota ?? (() => undefined),
  };
  return {
    deps,
    enabled: (env[ADDRESS_SUGGEST_ENABLED_ENV] ?? '').trim().toLowerCase() !== 'false',
    siteUrl: rascunho.siteUrl,
  };
}
