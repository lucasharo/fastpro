// H-027 (Issue #40) | Fakes da reducao para os testes de servico e de rota (sem banco, sem Storage, sem sharp).
// MemReduceRows espelha as funcoes private.media_reduce_* e media_original_* da migracao 20261112140000; a prova
// no Postgres real fica em packages/db/tests/media-reduce-h027.dbtest.mjs. Os eventos ficam em um diario comum
// para provar a ordem (R-03): putReduced < reduceDone < removeOriginal.
import {
  MEDIA_PENDING_TTL_MINUTES,
  type DraftRateCheck,
  type DraftRatePolicy,
  type DraftRatePort,
  type MediaFinalizeResult,
  type MediaIssueInput,
  type MediaIssueResult,
  type MediaRecord,
  type MediaStorePort,
} from '@fastpro/domain';
import type {
  ImageReducerPort,
  MediaRejectCode,
  MediaReduceBeginResult,
  MediaReduceDoneCode,
  MediaReduceRejectOut,
  MediaReduceStoragePort,
  ReduceBudgetPort,
  ReduceOutcome,
} from '@fastpro/domain';

/** Campos de reducao de uma linha. A rota de teste estende esta forma com os campos da quarentena. */
export interface LinhaR {
  id: string;
  draftHash: string;
  status: 'pending' | 'ready' | 'rejected';
  confirmedMs: number | null;
  purgeMs: number | null;
  createdMs: number;
  attempts: number;
  leaseMs: number | null;
  rejectCode: MediaRejectCode | null;
  originalRemovedMs: number | null;
  readyBytes: number | null;
  readyWidth: number | null;
  readyHeight: number | null;
  readyMs: number | null;
}

export type SessaoPorHash = (hash: string, now: number) => boolean;

export class MemReduceRows {
  constructor(
    private readonly linhas: Map<string, LinhaR>,
    private readonly sessao: SessaoPorHash = () => true,
    private readonly diario: string[] = [],
  ) {}

  private achar(hash: string, id: string, now: number): LinhaR | undefined {
    const l = this.linhas.get(id);
    if (!l || l.purgeMs !== null || l.draftHash !== hash || !this.sessao(hash, now)) return undefined;
    return l;
  }

  reduceBegin(hash: string, id: string, nowMs: number, leaseS: number): MediaReduceBeginResult {
    this.diario.push('reduceBegin');
    const nada = { attempt: null, rejectCode: null };
    const l = this.achar(hash, id, nowMs);
    if (!l) return { code: 'not_found', ...nada, originalPending: false };
    const pendente = l.originalRemovedMs === null;
    if (l.status === 'ready') return { code: 'ready', ...nada, originalPending: pendente };
    if (l.status === 'rejected') return { code: 'rejected', attempt: null, rejectCode: l.rejectCode, originalPending: pendente };
    if (l.confirmedMs === null) return { code: 'not_confirmed', ...nada, originalPending: pendente };
    if (l.leaseMs !== null && l.leaseMs > nowMs) return { code: 'busy', ...nada, originalPending: pendente };
    if (l.attempts >= 3) {
      l.status = 'rejected';
      l.rejectCode = 'nao_processavel';
      l.leaseMs = null;
      return { code: 'rejected', attempt: null, rejectCode: 'nao_processavel', originalPending: pendente };
    }
    l.leaseMs = nowMs + leaseS * 1000;
    l.attempts += 1;
    return { code: 'begin', attempt: l.attempts, rejectCode: null, originalPending: pendente };
  }

  reduceDone(id: string, attempt: number, bytes: number, width: number, height: number, nowMs: number): MediaReduceDoneCode {
    this.diario.push('reduceDone');
    const l = this.linhas.get(id);
    if (!l || l.purgeMs !== null) return 'gone';
    if (l.status !== 'pending' || l.confirmedMs === null || l.attempts !== attempt) return 'lost';
    l.status = 'ready';
    l.readyBytes = bytes;
    l.readyWidth = width;
    l.readyHeight = height;
    l.readyMs = nowMs;
    l.leaseMs = null;
    return 'done';
  }

  reduceReject(id: string, attempt: number, code: MediaRejectCode, nowMs: number): MediaReduceRejectOut {
    this.diario.push('reduceReject');
    void nowMs;
    const l = this.linhas.get(id);
    if (!l || l.purgeMs !== null) return 'gone';
    if (l.status !== 'pending' || l.confirmedMs === null || l.attempts !== attempt) return 'lost';
    l.status = 'rejected';
    l.rejectCode = code;
    l.leaseMs = null;
    return 'rejected';
  }

  reduceRelease(id: string, attempt: number, count: boolean): boolean {
    this.diario.push(`reduceRelease:${count ? 'conta' : 'devolve'}`);
    const l = this.linhas.get(id);
    if (!l || l.status !== 'pending' || l.attempts !== attempt) return false;
    l.leaseMs = null;
    if (!count) l.attempts = Math.max(0, l.attempts - 1);
    return true;
  }

  originalRemoved(id: string, nowMs: number): boolean {
    this.diario.push('originalRemoved');
    const l = this.linhas.get(id);
    if (!l || (l.status !== 'ready' && l.status !== 'rejected') || l.originalRemovedMs !== null) return false;
    l.originalRemovedMs = nowMs;
    return true;
  }

  originalCleanupList(limit: number): readonly string[] {
    return [...this.linhas.values()]
      .filter((l) => (l.status === 'ready' || l.status === 'rejected') && l.originalRemovedMs === null && l.purgeMs === null)
      .sort((a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((l) => l.id);
  }
}

export type FalhaStorage = 'read' | 'put' | 'removeOriginal' | 'removeReduced' | 'statReduced';

/** Storage da reducao em memoria, com falhas injetaveis e diario de ordem. */
export class MemReduceStorage implements MediaReduceStoragePort {
  readonly originais = new Map<string, Uint8Array>();
  readonly reduzidas = new Map<string, Uint8Array>();
  readonly falhas = new Set<FalhaStorage>();
  /** Bytes devolvidos quando o original nao foi preparado (linha criada pela rota de teste). */
  padraoOriginal: Uint8Array | null = null;
  chamadasLeitura = 0;

  constructor(private readonly diario: string[] = []) {}

  private falhar(op: FalhaStorage): void {
    if (this.falhas.has(op)) throw new Error('falha simulada de storage');
  }

  async readOriginal(id: string): Promise<Uint8Array | null> {
    this.chamadasLeitura++;
    this.diario.push('readOriginal');
    this.falhar('read');
    return this.originais.get(id) ?? this.padraoOriginal;
  }

  async putReduced(id: string, bytes: Uint8Array): Promise<void> {
    this.diario.push('putReduced');
    this.falhar('put');
    this.reduzidas.set(id, bytes);
  }

  async statReduced(id: string): Promise<{ readonly bytes: number } | null> {
    this.falhar('statReduced');
    const b = this.reduzidas.get(id);
    return b === undefined ? null : { bytes: b.byteLength };
  }

  async removeOriginal(id: string): Promise<void> {
    this.diario.push('removeOriginal');
    this.falhar('removeOriginal');
    this.originais.delete(id);
  }

  async removeReduced(id: string): Promise<void> {
    this.diario.push('removeReduced');
    this.falhar('removeReduced');
    this.reduzidas.delete(id);
  }
}

/** Saida padrao do redutor falso: JPEG sintetico de 200 KB, 960x1280. Nao e imagem real. */
export function saidaFalsa(bytes = 200_000): ReduceOutcome {
  return { ok: true, bytes: new Uint8Array(bytes).fill(0xab), width: 960, height: 1280 };
}

export type ComportamentoRedutor = (bytes: Uint8Array, opts: { readonly deadlineMs: number; readonly orcamento?: ReduceBudgetPort }) => Promise<ReduceOutcome>;

/** Redutor falso: contador de chamadas, reducoes em voo (maximo observado) e atraso controlado. */
export class FakeReducer implements ImageReducerPort {
  chamadas = 0;
  emVoo = 0;
  maximoEmVoo = 0;

  constructor(
    private comportamento: ComportamentoRedutor = async () => saidaFalsa(),
    private readonly atrasoMs = 0,
  ) {}

  setComportamento(c: ComportamentoRedutor): void {
    this.comportamento = c;
  }

  async reduce(bytes: Uint8Array, opts: { readonly deadlineMs: number; readonly orcamento?: ReduceBudgetPort }): Promise<ReduceOutcome> {
    this.chamadas++;
    this.emVoo++;
    this.maximoEmVoo = Math.max(this.maximoEmVoo, this.emVoo);
    try {
      if (this.atrasoMs > 0) await new Promise((ok) => setTimeout(ok, this.atrasoMs));
      return await this.comportamento(bytes, opts);
    } finally {
      this.emVoo--;
    }
  }
}

// H-026 (Issue #39) | Banco em memoria da quarentena (movido de media-route.test.ts sem mudar o comportamento).
const MINUTO_MS = 60_000;
/** Identificador sintetico de midia (uuid v4 de teste). */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Prazo do pendente (30 min), como na migracao. */
export const TTL_MS = MEDIA_PENDING_TTL_MINUTES * MINUTO_MS;
/** Tamanho maximo do original (10 MB). */
export const TAMANHO_MAX = 10_485_760;

export interface Linha extends LinhaR {
  clientUploadId: string;
  type: string;
  bytes: number;
  confirmedBytes: number | null;
  pendingExpiresMs: number;
}

/** Banco em memoria com as mesmas regras de private.media_* (H-026 e H-027). Conta o que chegaria ao banco. */
export class MemMedia implements MediaStorePort {
  readonly linhas = new Map<string, Linha>();
  readonly rascunhos = new Map<string, { status: 'aberto' | 'descartado'; expiresMs: number }>();
  readonly diario: string[] = [];
  chamadas = 0;
  /** Vagas vivas por rascunho (88 §1). Padrao 5; o teste de cota eleva para isolar o limite de taxa. */
  vagasPorRascunho = 5;
  private seq = 0;
  private readonly reducao = new MemReduceRows(this.linhas, (h, n) => this.vivo(h, n), this.diario);

  private vivo(hash: string, now: number): boolean {
    const r = this.rascunhos.get(hash);
    return r !== undefined && r.status === 'aberto' && r.expiresMs > now;
  }

  private contaVivas(draftHash: string | null): number {
    return [...this.linhas.values()].filter(
      (l) => l.purgeMs === null && l.status !== 'rejected' && (draftHash === null || l.draftHash === draftHash),
    ).length;
  }

  private rec(l: Linha): MediaRecord {
    return { id: l.id, status: l.status, confirmed: l.confirmedMs !== null };
  }

  async reduceBegin(hash: string, id: string, nowMs: number, leaseS: number): Promise<MediaReduceBeginResult> {
    return this.reducao.reduceBegin(hash, id, nowMs, leaseS);
  }
  async reduceDone(id: string, attempt: number, bytes: number, width: number, height: number, nowMs: number): Promise<MediaReduceDoneCode> {
    return this.reducao.reduceDone(id, attempt, bytes, width, height, nowMs);
  }
  async reduceReject(id: string, attempt: number, code: MediaRejectCode, nowMs: number): Promise<MediaReduceRejectOut> {
    return this.reducao.reduceReject(id, attempt, code, nowMs);
  }
  async reduceRelease(id: string, attempt: number, count: boolean): Promise<boolean> {
    return this.reducao.reduceRelease(id, attempt, count);
  }
  async originalRemoved(id: string, nowMs: number): Promise<boolean> {
    return this.reducao.originalRemoved(id, nowMs);
  }
  async originalCleanupList(limit: number): Promise<readonly string[]> {
    return this.reducao.originalCleanupList(limit);
  }

  async issue(input: MediaIssueInput): Promise<MediaIssueResult> {
    this.chamadas++;
    if (!this.vivo(input.secretHash, input.nowMs)) return { code: 'not_found', media: null };
    for (const l of this.linhas.values()) {
      if (l.draftHash === input.secretHash && l.confirmedMs === null && l.purgeMs === null && l.pendingExpiresMs <= input.nowMs) {
        l.purgeMs = input.nowMs;
      }
    }
    const existente = [...this.linhas.values()].find(
      (l) => l.draftHash === input.secretHash && l.clientUploadId === input.clientUploadId && l.purgeMs === null,
    );
    if (existente) {
      return { code: 'replay', media: this.rec(existente) };
    }
    if (this.contaVivas(input.secretHash) >= this.vagasPorRascunho) return { code: 'photo_limit', media: null };
    if (this.contaVivas(null) >= input.globalCap) return { code: 'cap', media: null };
    const id = uuid(++this.seq);
    const l: Linha = {
      id,
      status: 'pending',
      attempts: 0,
      leaseMs: null,
      rejectCode: null,
      originalRemovedMs: null,
      readyBytes: null,
      readyWidth: null,
      readyHeight: null,
      readyMs: null,
      draftHash: input.secretHash,
      clientUploadId: input.clientUploadId,
      type: input.type,
      bytes: input.bytes,
      confirmedMs: null,
      confirmedBytes: null,
      pendingExpiresMs: input.nowMs + TTL_MS,
      purgeMs: null,
      createdMs: input.nowMs,
    };
    this.linhas.set(id, l);
    return { code: 'new', media: this.rec(l) };
  }

  private achar(hash: string, id: string, now: number): Linha | undefined {
    const l = this.linhas.get(id);
    if (!l || l.purgeMs !== null || l.draftHash !== hash || !this.vivo(hash, now)) return undefined;
    return l;
  }

  async get(hash: string, id: string, nowMs: number): Promise<MediaRecord | null> {
    this.chamadas++;
    const l = this.achar(hash, id, nowMs);
    return l ? this.rec(l) : null;
  }

  async finalize(hash: string, id: string, storedBytes: number | null, nowMs: number): Promise<MediaFinalizeResult> {
    this.chamadas++;
    const l = this.achar(hash, id, nowMs);
    if (!l) return { code: 'not_found', media: null };
    if (l.confirmedMs !== null) return { code: 'replay', media: this.rec(l) };
    if (l.pendingExpiresMs <= nowMs) {
      l.purgeMs = nowMs;
      return { code: 'expired', media: null };
    }
    if (storedBytes === null || storedBytes < 1) return { code: 'missing', media: null };
    if (storedBytes > TAMANHO_MAX) {
      l.purgeMs = nowMs;
      return { code: 'too_large', media: null };
    }
    l.confirmedMs = nowMs;
    l.confirmedBytes = storedBytes;
    return { code: 'confirmed', media: this.rec(l) };
  }

  async sweep(): Promise<readonly string[]> {
    return [];
  }
  async purgeDone(): Promise<number> {
    return 0;
  }
  async known(ids: readonly string[]): Promise<readonly string[]> {
    return ids.filter((id) => this.linhas.has(id));
  }
}

export class MemRate implements DraftRatePort {
  readonly eventos = new Map<string, number[]>();
  hits = 0;

  async check(policy: DraftRatePolicy, key: string, now: number): Promise<DraftRateCheck> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    if (ts.length < policy.limit) return { ok: true };
    const antigo = ts[0] ?? now;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((antigo + policy.spanS * 1000 - now) / 1000)) };
  }

  async hit(policy: DraftRatePolicy, key: string, now: number): Promise<void> {
    const k = `${policy.id}|${key}`;
    const ts = (this.eventos.get(k) ?? []).filter((t) => t > now - policy.spanS * 1000);
    ts.push(now);
    this.eventos.set(k, ts);
    this.hits++;
  }
}
