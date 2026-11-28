// H-021 | Armazenamento simulado da coordenada permanente (docs/factory/68-DESENHO-H021.md, §2, §3.2, §5).
// Simula a tabela app.geocode_point e os contadores em memoria, para testar o servico sem banco e sem rede.
// As regras de decisao vem do dominio (decideReservation e decideBreaker); aqui so ha a escrita simulada.
// A atomicidade real (uma transacao no Postgres) e da proxima fatia; em JS, cada metodo roda sem await
// interno, o que serializa as chamadas concorrentes deste teste.
import { randomUUID } from 'node:crypto';
import {
  decideBreaker,
  decideReservation,
  isInsideBrazilBox,
  periodStartUtc,
  type GeoRowSnapshot,
  type GeoRowState,
  type PermanentPoint,
} from '@fastpro/domain';
import type {
  GeoPointStorePort,
  GeoReserveInput,
  GeoReserveOutcome,
  QuotaAlertSink,
} from '../src/geo/permanent-ports.js';

interface FakeRow {
  readonly subject: string;
  readonly hash: string;
  state: GeoRowState;
  reservedAtMs: number | null;
  ref: string | null;
  pointId: string | null;
  point: PermanentPoint | null;
  /** Equivalente a geocoded_at de app.geocode_point. */
  geocodedAtMs?: number;
}

export class GeoStoreFake implements GeoPointStorePort {
  /** Tabela simulada (uma linha por pedido e texto). Nunca guarda o texto em claro. */
  readonly linhas: FakeRow[] = [];
  private readonly porPedido = new Map<string, number>();
  private readonly cota = new Map<string, number>();
  private readonly alertasEmitidos = new Set<string>();

  constructor(private readonly onAlert: QuotaAlertSink = () => undefined) {}

  private achar(subject: string, hash: string): FakeRow | undefined {
    return this.linhas.find((l) => l.subject === subject && l.hash === hash);
  }

  private porReferencia(ref: string): FakeRow {
    const linha = this.linhas.find((l) => l.ref === ref);
    if (linha === undefined || linha.state !== 'reservado') {
      throw new Error('geo_store_sem_reserva');
    }
    return linha;
  }

  private alertaUmaVez(periodo: string, nivel: 1 | 2, used: number): void {
    const chave = `${periodo}:${nivel}`;
    if (this.alertasEmitidos.has(chave)) return;
    this.alertasEmitidos.add(chave);
    this.onAlert({ nivel, used });
  }

  private gravar(subject: string, hash: string, dados: Partial<FakeRow> & { state: GeoRowState }) {
    const existente = this.achar(subject, hash);
    if (existente) {
      Object.assign(existente, dados);
      return existente;
    }
    const nova: FakeRow = {
      subject,
      hash,
      reservedAtMs: null,
      ref: null,
      pointId: null,
      point: null,
      ...dados,
    };
    this.linhas.push(nova);
    return nova;
  }

  async reserve(input: GeoReserveInput): Promise<GeoReserveOutcome> {
    const periodo = periodStartUtc(input.nowMs);
    const used = this.cota.get(periodo) ?? 0;
    const row = this.achar(input.subject, input.hash);
    const snapshot: GeoRowSnapshot | null = row
      ? { state: row.state, reservedAtMs: row.reservedAtMs }
      : null;
    const acao = decideReservation({
      row: snapshot,
      callsNoPedido: this.porPedido.get(input.subject) ?? 0,
      callsCap: input.callsCap,
      caps: input.caps,
      quotaUsed: used,
      nowMs: input.nowMs,
      leaseMs: input.leaseMs,
    });

    if (acao === 'reutilizar') {
      return { acao, pointId: row?.pointId ?? undefined };
    }
    if (acao === 'chamar') {
      const decisao = decideBreaker(input.caps, used);
      this.cota.set(periodo, used + 1);
      if (decisao.alcancouSoft && input.caps !== null) this.alertaUmaVez(periodo, 1, used + 1);
      this.porPedido.set(input.subject, (this.porPedido.get(input.subject) ?? 0) + 1);
      const ref = randomUUID();
      this.gravar(input.subject, input.hash, {
        state: 'reservado',
        reservedAtMs: input.nowMs,
        ref,
        pointId: null,
        point: null,
      });
      return { acao, ref };
    }
    if (acao === 'breaker') {
      if (input.caps !== null && used >= input.caps.hard) this.alertaUmaVez(periodo, 2, used);
      this.gravar(input.subject, input.hash, {
        state: 'aguardando',
        reservedAtMs: null,
        ref: null,
        pointId: null,
        point: null,
      });
      return { acao };
    }
    return { acao };
  }

  async storePermanent(ref: string, point: PermanentPoint, nowMs: number): Promise<string> {
    const linha = this.porReferencia(ref);
    // Espelha os CHECKs de app.geocode_point: caixa do Brasil e so modo permanente.
    if (!isInsideBrazilBox(point.lon, point.lat)) throw new Error('geo_ponto_fora_do_brasil');
    linha.state = 'ok';
    linha.point = { lon: point.lon, lat: point.lat, precision: point.precision };
    linha.geocodedAtMs = nowMs;
    linha.pointId = randomUUID();
    linha.reservedAtMs = null;
    linha.ref = null;
    return linha.pointId;
  }

  async markNoResult(ref: string): Promise<void> {
    const linha = this.porReferencia(ref);
    linha.state = 'sem_resultado';
    linha.reservedAtMs = null;
    linha.ref = null;
  }

  async release(ref: string): Promise<void> {
    const linha = this.porReferencia(ref);
    // Devolve a unidade de teto do pedido; a unidade de cota mensal fica consumida (§3.4).
    const atual = this.porPedido.get(linha.subject) ?? 0;
    this.porPedido.set(linha.subject, Math.max(0, atual - 1));
    this.linhas.splice(this.linhas.indexOf(linha), 1);
  }

  async panel(nowMs: number): Promise<{ readonly used: number; readonly aguardando: number }> {
    return {
      used: this.cota.get(periodStartUtc(nowMs)) ?? 0,
      aguardando: this.linhas.filter((l) => l.state === 'aguardando').length,
    };
  }

  /** Visao sem referencias internas: usada pelos testes de canario (CA-5, CA-6). */
  retratoDasLinhas(): string {
    return JSON.stringify(
      this.linhas.map((l) => ({
        state: l.state,
        point: l.point,
        pointId: l.pointId,
      })),
    );
  }

  /** Uso do pedido na cadeia de republicacao (para os testes do teto). */
  chamadasDoPedido(subject: string): number {
    return this.porPedido.get(subject) ?? 0;
  }
}
