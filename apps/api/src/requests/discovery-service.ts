// Issue 68 (H-055) | Servico da descoberta de pedidos (docs/factory/153-DESENHO-H055.md, §2 A-2 e A-4, §3.2, §4, §5.3).
// Um unico instante por requisicao (A-2): o mesmo `at` vai a guarda e ao casamento (descoberta), a projecao, ao
// iat do cursor e a validade do cursor recebido. Sem HTTP: a rota traduz o resultado em status e cabecalhos.
// Item que some entre as duas leituras e descartado em silencio (A-4); o cursor segue o ultimo id DEVOLVIDO pela
// descoberta, para nao reler nem pular itens. has_photos vem so de um vinculo seguro (pedido -> foto pronta).
import {
  buildDiscoveryItem,
  type DiscoveryCursor,
  type DiscoveryCursorCodec,
  type DiscoveryModality,
  type DiscoveryUrgency,
  type RequestDiscoveryItem,
  type RequestDiscoveryPage,
} from '@fastpro/domain';
import type { ProfessionalRequestRow } from '@fastpro/db';

/** Corpo fixo de cursor recusado (um unico codigo para todo motivo, §3.2 linha 6). */
export const CURSOR_INVALIDO_BODY = { code: 'cursor_invalido' } as const;
/** Corpo fixo de falha do banco ou da projecao (§3.2 linha 7). */
export const DESCOBERTA_INDISPONIVEL_BODY = { code: 'descoberta_indisponivel' } as const;

/** Porta da descoberta (implementada por PgDiscoveryStore). */
export interface DiscoveryStorePort {
  discover(input: {
    readonly professionalId: string;
    readonly at: Date;
    readonly limit: number;
    readonly after: DiscoveryCursor | null;
  }): Promise<readonly DiscoveryCursor[]>;
}

/** Porta da projecao no mesmo instante (implementada por PgDiscoveryProjectionStore). */
export interface DiscoveryProjectionPort {
  project(professionalId: string, requestIds: readonly string[], at: Date): Promise<readonly ProfessionalRequestRow[]>;
}

/** Porta das fotos prontas (implementada por PgDiscoveryPhotoStore). Devolve so os ids com foto pronta. */
export interface DiscoveryPhotoPort {
  withPhotos(requestIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface DiscoveryServiceDeps {
  readonly store: DiscoveryStorePort;
  readonly projection: DiscoveryProjectionPort;
  readonly photos: DiscoveryPhotoPort;
  readonly cursor: DiscoveryCursorCodec;
  /** Relogio injetado: lido UMA vez por requisicao (A-2). */
  readonly clock: { nowMs(): number };
}

export interface DiscoveryRequest {
  /** Limite ja validado pela rota (1 a 200). */
  readonly limit: number;
  /** Token do cursor recebido, ou null na primeira pagina. Validado aqui, antes de qualquer consulta ao banco. */
  readonly cursor: string | null;
}

export type DiscoveryOutcome =
  | { readonly status: 200; readonly body: RequestDiscoveryPage }
  | { readonly status: 400; readonly body: typeof CURSOR_INVALIDO_BODY }
  | { readonly status: 503; readonly body: typeof DESCOBERTA_INDISPONIVEL_BODY };

/** Pagina vazia: a mesma resposta para inelegivel e para elegivel sem pedidos (decisao 611, byte a byte). */
const PAGINA_VAZIA: RequestDiscoveryPage = { items: [], next_cursor: null, has_more: false };

function paraItem(linha: ProfessionalRequestRow, comFoto: ReadonlySet<string>): RequestDiscoveryItem {
  return buildDiscoveryItem({
    id: linha.id,
    service_id: linha.serviceId,
    service_name: linha.serviceName,
    urgency: linha.urgency as DiscoveryUrgency,
    description: linha.description,
    public_label: linha.publicLabel,
    distance_km: linha.distanceKm,
    modality: linha.modality as DiscoveryModality,
    published_at: linha.publishedAt,
    acceptance_deadline_at: linha.acceptanceDeadlineAt,
    has_photos: comFoto.has(linha.id),
  });
}

export async function discoverRequests(
  professionalId: string,
  pedido: DiscoveryRequest,
  deps: DiscoveryServiceDeps,
): Promise<DiscoveryOutcome> {
  const atMs = deps.clock.nowMs();
  const at = new Date(atMs);

  let after: DiscoveryCursor | null = null;
  if (pedido.cursor !== null) {
    try {
      after = deps.cursor.open(pedido.cursor, professionalId, atMs);
    } catch {
      return { status: 400, body: CURSOR_INVALIDO_BODY };
    }
  }

  try {
    const descobertos = await deps.store.discover({ professionalId, at, limit: pedido.limit, after });
    if (descobertos.length === 0) return { status: 200, body: PAGINA_VAZIA };

    const ids = descobertos.map((d) => d.requestId);
    const projetadas = await deps.projection.project(professionalId, ids, at);
    const comFoto = await deps.photos.withPhotos(projetadas.map((linha) => linha.id));
    const items = projetadas.map((linha) => paraItem(linha, comFoto));

    const hasMore = descobertos.length === pedido.limit;
    const ultimo = descobertos[descobertos.length - 1];
    const nextCursor = hasMore && ultimo !== undefined ? deps.cursor.seal(ultimo, professionalId, atMs) : null;
    return { status: 200, body: { items, next_cursor: nextCursor, has_more: hasMore } };
  } catch {
    return { status: 503, body: DESCOBERTA_INDISPONIVEL_BODY };
  }
}
