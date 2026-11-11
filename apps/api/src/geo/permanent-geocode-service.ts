// H-021 | Servico da coordenada permanente (docs/factory/68-DESENHO-H021.md, §3.1 a §3.4, §5.2).
// Chamado pela publicacao (H-031) e pela base do profissional (H-036), nunca pelo rascunho (decisao 46).
// Nenhum desfecho carrega latitude, longitude, rotulo ou resposta bruta (§3.3): so o identificador do ponto.
// A decisao de reserva e atomica no armazenamento (porta); aqui so se encadeia o que o desenho manda.
import {
  PERMANENT_CALLS_PER_REQUEST_MAX,
  PERMANENT_LEASE_MS,
  permanentAddressKey,
  type BreakerCaps,
} from '@fastpro/domain';
import type { GeocodingPermanentPort, GeoPointStorePort } from './permanent-ports.js';

export interface EnsurePermanentDeps {
  readonly store: GeoPointStorePort;
  readonly provider: GeocodingPermanentPort;
  /** HMAC do texto normalizado com o segredo do servidor. Injetado pela composicao. */
  readonly hashAddress: (key: string) => string;
  /** Tetos do breaker lidos do ambiente; null (ausente ou invalido) = nenhuma chamada paga. */
  readonly caps: BreakerCaps | null;
  readonly clock: () => number;
}

export interface EnsurePermanentInput {
  /** Identificador logico da cadeia de republicacao do pedido (ou do profissional). */
  readonly subject: string;
  /** Texto do endereco como digitado. Nao e guardado: so o HMAC chega ao armazenamento. */
  readonly addressText: string;
}

/** Desfechos de §3.1, passo 3. Nenhum carrega coordenada. */
export type EnsurePermanentOutcome =
  | { readonly status: 'ok'; readonly pointId: string }
  | { readonly status: 'em_andamento' }
  | { readonly status: 'teto' }
  | { readonly status: 'endereco_nao_encontrado' }
  | { readonly status: 'entrada_invalida' }
  | { readonly status: 'aguardando_geocodificacao' }
  | { readonly status: 'indisponivel' };

export async function ensurePermanentPoint(
  input: EnsurePermanentInput,
  deps: EnsurePermanentDeps,
): Promise<EnsurePermanentOutcome> {
  const endereco = permanentAddressKey(input.addressText);
  if (!endereco.ok) return { status: 'entrada_invalida' };

  const reserva = await deps.store.reserve({
    subject: input.subject,
    hash: deps.hashAddress(endereco.key),
    nowMs: deps.clock(),
    leaseMs: PERMANENT_LEASE_MS,
    callsCap: PERMANENT_CALLS_PER_REQUEST_MAX,
    caps: deps.caps,
  });

  switch (reserva.acao) {
    case 'reutilizar': {
      if (reserva.pointId === undefined) throw new Error('geo_reutilizar_sem_ponto');
      return { status: 'ok', pointId: reserva.pointId };
    }
    case 'chamar': {
      if (reserva.ref === undefined) throw new Error('geo_chamar_sem_referencia');
      // Uma unica chamada paga, sem retentativa (§3.4). O texto da chamada nao e guardado.
      const lookup = await deps.provider.geocode(endereco.query);
      if (lookup.status === 'falha') {
        await deps.store.release(reserva.ref);
        return { status: 'indisponivel' };
      }
      if (lookup.status === 'sem_resultado') {
        await deps.store.markNoResult(reserva.ref);
        return { status: 'endereco_nao_encontrado' };
      }
      const pointId = await deps.store.storePermanent(reserva.ref, lookup.point, deps.clock());
      return { status: 'ok', pointId };
    }
    case 'em_andamento':
      return { status: 'em_andamento' };
    case 'teto':
      return { status: 'teto' };
    case 'sem_resultado':
      return { status: 'endereco_nao_encontrado' };
    case 'breaker':
      // Texto preservado no rascunho do cliente; nada foi gasto (§5.2).
      return { status: 'aguardando_geocodificacao' };
    default: {
      const nunca: never = reserva.acao;
      throw new Error(`geo_acao_desconhecida:${String(nunca)}`);
    }
  }
}
