// H-021 | Portas da coordenada permanente (docs/factory/68-DESENHO-H021.md, §2.3, §3.1 a §3.4, §4, §5).
// Separadas das portas temporarias de H-020 (ports.ts): o servico de publicacao so conhece estas.
// A implementacao real (banco com funcoes security definer e adaptador Mapbox) entra na composicao.
import type { BreakerCaps, GeoReservaAcao, PermanentPoint, ProviderErrorCode } from '@fastpro/domain';

/** Resultado de uma unica consulta permanente. Sem rotulo, sem identificador, sem resposta bruta. */
export type PermanentLookup =
  | { readonly status: 'ponto'; readonly point: PermanentPoint }
  | { readonly status: 'sem_resultado' }
  | { readonly status: 'falha'; readonly code: ProviderErrorCode };

export interface GeocodingPermanentPort {
  /** Uma chamada com permanent=true, sem retentativa. Nunca lanca: falhas viram `falha`. */
  geocode(query: string): Promise<PermanentLookup>;
}

export interface GeoReserveInput {
  /** Identificador logico da cadeia de republicacao do pedido (dúvida 3). */
  readonly subject: string;
  /** HMAC do texto normalizado. O texto em claro nao chega ao armazenamento. */
  readonly hash: string;
  readonly nowMs: number;
  readonly leaseMs: number;
  readonly callsCap: number;
  readonly caps: BreakerCaps | null;
}

export interface GeoReserveOutcome {
  readonly acao: GeoReservaAcao;
  /** Presente em `chamar`: referencia opaca para gravar, marcar ou liberar a reserva. */
  readonly ref?: string;
  /** Presente em `reutilizar`: identificador do ponto ja gravado. */
  readonly pointId?: string;
}

export interface GeoPointStorePort {
  /**
   * Passo atomico de §3.2 e §5.2: decide com decideReservation, reserva a unidade de teto e de cota
   * em `chamar`, ou grava `aguardando` em `breaker`. A implementacao real faz isso numa transacao.
   */
  reserve(input: GeoReserveInput): Promise<GeoReserveOutcome>;
  /** Unico ponto que grava a coordenada (CHECK de modo permanente, §2.1). Exige reserva viva. */
  storePermanent(ref: string, point: PermanentPoint, nowMs: number): Promise<string>;
  /** Resposta sem endereco: a chamada foi paga, mas nao ha ponto (§3.1, passo 3). */
  markNoResult(ref: string): Promise<void>;
  /** Falha do provedor: apaga a reserva e devolve a unidade de teto; a cota mensal fica consumida (§3.4). */
  release(ref: string): Promise<void>;
  /** Uso da cota do mes e numero de linhas em `aguardando`, para o painel (§5.3). */
  panel(nowMs: number): Promise<{ readonly used: number; readonly aguardando: number }>;
}

export interface QuotaAlertEvent {
  readonly nivel: 1 | 2;
  readonly used: number;
}

/** Evento de alerta da cota (§5.3). Recebe so nivel e contagem, nunca texto nem coordenada. */
export type QuotaAlertSink = (evento: QuotaAlertEvent) => void;
