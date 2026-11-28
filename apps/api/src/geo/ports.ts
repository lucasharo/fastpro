// H-020 | Portas do autocomplete temporario (docs/factory/56-DESENHO-H020.md, §2.3, §6).
// A rota depende so destas interfaces. As implementacoes reais (banco, Mapbox) entram na composicao.
import type { AddressContext, ProviderErrorCode } from '@fastpro/domain';

/** Resultado do controle de rascunho (§2.3). Fora de rascunho nao ha consulta ao provedor. */
export type DraftGateResult =
  | { readonly status: 'ok'; readonly principal: string }
  | { readonly status: 'not_draft' | 'no_principal' | 'indisponivel' };

export interface DraftGatePort {
  check(context: AddressContext, cookie: string | undefined): Promise<DraftGateResult>;
}

/** Porta real ainda nao ligada (H-025 e H-036 ligam). Enquanto isso a rota responde 503 (§2.3). */
export const unwiredDraftGate: DraftGatePort = {
  async check() {
    return { status: 'indisponivel' };
  },
};

export type RateCheck = { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number };

export interface RateLimitPort {
  /** Consulta sem contar (rl_check). Chaves sao montadas e hasheadas pela implementacao. */
  check(principal: string, ip: string): Promise<RateCheck>;
  /** Conta a consulta aceita (rl_hit), so depois do check. */
  hit(principal: string, ip: string): Promise<void>;
}

export interface QuotaPort {
  /** Reserva uma consulta da cota mensal (mapbox_temp_quota_take). Conta mesmo se o provedor falhar. */
  take(now: Date): Promise<{ readonly ok: boolean; readonly novoAlerta: boolean; readonly used: number }>;
}

export type ProviderResult =
  | { readonly ok: true; readonly features: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode };

export interface GeocodingTempPort {
  /** Uma unica chamada ao provedor, sem retentativa (CA-11). A resposta bruta nunca sai do servidor. */
  suggest(q: string): Promise<ProviderResult>;
}

export interface ClockPort {
  nowMs(): number;
}

/** Evento de alerta de cota (log mapbox_quota_alert). Recebe so contagem e nivel, nunca texto. */
export type QuotaAlertSink = (evento: { readonly used: number }) => void;
