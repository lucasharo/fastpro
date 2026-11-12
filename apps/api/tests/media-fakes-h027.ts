// H-027 (Issue #40) | Fakes da reducao para os testes de servico e de rota (sem banco, sem Storage, sem sharp).
// MemReduceRows espelha as funcoes private.media_reduce_* e media_original_* da migracao 20261112140000; a prova
// no Postgres real fica em packages/db/tests/media-reduce-h027.dbtest.mjs. Os eventos ficam em um diario comum
// para provar a ordem (R-03): putReduced < reduceDone < removeOriginal.
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
