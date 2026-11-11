// H-020 | Servico do autocomplete (docs/factory/56-DESENHO-H020.md, §2.2 passos 3 a 7, §4, §5).
// Ordem fixa: rascunho -> limite de taxa -> cota -> provedor -> mapeamento. Cada falha encerra sem custo
// adicional. Nenhuma resposta do provedor e guardada; o texto digitado nunca entra em resultado de log.
import {
  decideQuotaTake,
  mapSuggestFeatures,
  type AddressContext,
  type AddressSuggestResponse,
} from '@fastpro/domain';
import type {
  ClockPort,
  DraftGatePort,
  GeocodingTempPort,
  QuotaAlertSink,
  QuotaPort,
  RateLimitPort,
} from './ports.js';

export interface AddressSuggestDeps {
  readonly gate: DraftGatePort;
  readonly rate: RateLimitPort;
  readonly quota: QuotaPort;
  readonly provider: GeocodingTempPort;
  readonly clock: ClockPort;
  readonly onQuotaAlert: QuotaAlertSink;
}

export interface AddressSuggestInput {
  readonly q: string;
  readonly context: AddressContext;
  readonly cookie: string | undefined;
  readonly ip: string;
}

export interface AddressSuggestOutcome {
  readonly status: number;
  readonly body: AddressSuggestResponse | { readonly code: string };
  readonly retryAfterS?: number;
  /** Codigo fixo interno (para log futuro). Nunca vai ao navegador. */
  readonly errorCode?: string;
}

const texto = (reason: 'limite' | 'cota' | 'indisponivel', extra?: number) =>
  extra === undefined
    ? ({ mode: 'texto_livre', reason } as const)
    : ({ mode: 'texto_livre', reason, retry_after_s: extra } as const);

export async function suggestAddress(
  input: AddressSuggestInput,
  deps: AddressSuggestDeps,
): Promise<AddressSuggestOutcome> {
  // 3. Rascunho: a consulta so acontece no estado rascunho, conferido a cada pedido (CA-01, CA-02).
  const gate = await deps.gate.check(input.context, input.cookie);
  if (gate.status === 'indisponivel') {
    return { status: 503, body: { code: 'indisponivel' }, errorCode: 'gate_indisponivel' };
  }
  if (gate.status !== 'ok') {
    return { status: 403, body: { code: 'not_draft' }, errorCode: 'not_draft' };
  }

  // 4. Limite de taxa: excedente nao chega ao provedor nem consome cota (CA-09).
  const taxa = await deps.rate.check(gate.principal, input.ip);
  if (!taxa.ok) {
    return {
      status: 429,
      body: texto('limite', taxa.retryAfterS),
      retryAfterS: taxa.retryAfterS,
      errorCode: 'rate_limited',
    };
  }
  await deps.rate.hit(gate.principal, input.ip);

  // 5. Cota mensal: reserva antes da chamada (CA-08). Sem reserva, nao ha chamada.
  const reserva = await deps.quota.take(new Date(deps.clock.nowMs()));
  const cota = decideQuotaTake(reserva);
  if (cota.alerta) {
    deps.onQuotaAlert({ used: reserva.used });
  }
  if (!cota.permitido) {
    return { status: 200, body: texto('cota'), errorCode: 'quota_off' };
  }

  // 6. Provedor: uma chamada, sem retentativa (CA-10, CA-11).
  const r = await deps.provider.suggest(input.q);
  if (!r.ok) {
    return { status: 200, body: texto('indisponivel'), errorCode: r.code };
  }

  // 7. Mapeamento: so rotulos saem (CA-03, CA-04).
  const mapa = mapSuggestFeatures(r.features);
  if (!mapa.ok) {
    return { status: 200, body: texto('indisponivel'), errorCode: 'provider_shape' };
  }
  return { status: 200, body: { mode: 'ok', items: mapa.items } };
}
