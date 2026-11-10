// H-008 | Tick de jobs (desenho 24-DESENHO-H008.md §1, §4, §5). Nucleo sem framework: sem Nest, sem
// HTTP e sem driver de banco. A porta JobStore e implementada por PgJobStore sobre um cliente SQL
// (ex.: pg.Client). A exclusao mutua vem do banco (private.job_claim: FOR UPDATE SKIP LOCKED e lease):
// nada aqui depende de quem chamou (A, C ou D), e nenhuma regra depende da existencia do pg_cron.
// Handlers recebem referencia (id, kind, payload_ref, attempts), nunca PII, e devem ser idempotentes.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const TICK_PATH = '/internal/jobs/tick';
export const TICK_LEASE_SECONDS = 60;
export const TICK_BATCH_SIZE = 5;
export const TICK_HANDLER_TIMEOUT_MS = 30_000;
export const TICK_START_BUDGET_MS = 20_000;
export const TICK_MIN_INTERVAL_MS = 60_000;
export const TICK_MAX_BACKOFF_MS = 15 * 60_000;
export const TICK_RETRY_BASE_SECONDS = 60;
export const TICK_RETRY_CAP_SECONDS = 3600;
export const TICK_MIN_SECRET_LENGTH = 32;
export const TICK_BODY_LIMIT_BYTES = 1024;
export const TICK_PROBE_KIND = 'tick.probe';

/** Origem do disparo: a = pg_cron + pg_net; b = agendador externo (so configuracao); c = oportunista; d = cron diario. */
export type TickOrigin = 'a' | 'b' | 'c' | 'd';

export interface ClaimedJob {
  id: string;
  kind: string;
  payload_ref: string | null;
  attempts: number;
}

/** Porta de persistencia. Cada chamada e uma operacao atomica (transacao curta). */
export interface JobStore {
  claim(
    owner: string,
    kind: string | null,
    leaseSeconds: number,
    limit: number,
  ): Promise<ClaimedJob[]>;
  complete(id: string, owner: string): Promise<boolean>;
  fail(id: string, owner: string, errorCode: string, retrySeconds: number): Promise<boolean>;
}

export interface JobContext {
  readonly id: string;
  readonly kind: string;
  readonly payload_ref: string | null;
  readonly attempts: number;
}

export interface JobHandler {
  run(job: JobContext): Promise<void>;
}

const KIND_RE = /^[a-z][a-z0-9_.]{0,99}$/;
const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Registro de handlers por kind. Dois handlers para o mesmo kind falham no boot. */
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(kind: string, handler: JobHandler): void {
    if (!KIND_RE.test(kind)) throw new TypeError('kind de job invalido');
    if (this.handlers.has(kind)) throw new Error(`handler duplicado para o kind ${kind}`);
    this.handlers.set(kind, handler);
  }

  get(kind: string): JobHandler | undefined {
    return this.handlers.get(kind);
  }
}

export function registerJobHandler(registry: JobRegistry, kind: string, handler: JobHandler): void {
  registry.register(kind, handler);
}

/** Espera antes de nova tentativa: 60 s, 120 s, ... limitado a 3600 s (desenho §1.3 passo 4). */
export function retrySecondsFor(attempts: number): number {
  const exp = Math.min(Math.max(attempts - 1, 0), 10);
  return Math.min(TICK_RETRY_BASE_SECONDS * 2 ** exp, TICK_RETRY_CAP_SECONDS);
}

class UnknownKindError extends Error {
  constructor() {
    super('kind sem handler');
    this.name = 'UnknownKindError';
  }
}

class TickTimeoutError extends Error {
  constructor() {
    super('handler excedeu o tempo');
    this.name = 'TickTimeoutError';
  }
}

/** Codigo curto e fixo; nunca a mensagem da excecao (pode conter PII). */
export function errorCodeOf(err: unknown): string {
  if (err instanceof TickTimeoutError) return 'timeout';
  if (!(err instanceof Error)) return 'erro';
  const cls = err.constructor?.name ?? '';
  return CODE_RE.test(cls) ? cls : 'erro';
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TickTimeoutError()), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

export interface TickReport {
  origem: TickOrigin;
  reivindicados: number;
  concluidos: number;
  falhos: number;
  lease_perdido: number;
  ms: number;
}

export interface TickServiceOptions {
  store: JobStore;
  registry: JobRegistry;
  /** Identificador da instancia (UUID). Padrao: aleatorio por processo; nunca PII. */
  instanceId?: string;
  /** Somente para testes: o endpoint HTTP nunca passa filtro. */
  kindFilter?: string;
  now?: () => number;
  leaseSeconds?: number;
  batchSize?: number;
  handlerTimeoutMs?: number;
  startBudgetMs?: number;
}

/** TickService.run(origem): reivindica em lotes, executa handlers e registra o resultado. */
export class TickService {
  private readonly store: JobStore;
  private readonly registry: JobRegistry;
  private readonly instanceId: string;
  private readonly kindFilter: string | null;
  private readonly now: () => number;
  private readonly leaseSeconds: number;
  private readonly batchSize: number;
  private readonly handlerTimeoutMs: number;
  private readonly startBudgetMs: number;

  constructor(opts: TickServiceOptions) {
    this.store = opts.store;
    this.registry = opts.registry;
    this.instanceId = opts.instanceId ?? randomUUID();
    this.kindFilter = opts.kindFilter ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.leaseSeconds = opts.leaseSeconds ?? TICK_LEASE_SECONDS;
    this.batchSize = opts.batchSize ?? TICK_BATCH_SIZE;
    this.handlerTimeoutMs = opts.handlerTimeoutMs ?? TICK_HANDLER_TIMEOUT_MS;
    this.startBudgetMs = opts.startBudgetMs ?? TICK_START_BUDGET_MS;
  }

  /** Erros de banco propagam (o chamador decide: HTTP responde 503; o oportunista engole). */
  async run(origem: TickOrigin): Promise<TickReport> {
    const started = this.now();
    const owner = `tick-${origem}:${this.instanceId}`;
    const report: TickReport = {
      origem,
      reivindicados: 0,
      concluidos: 0,
      falhos: 0,
      lease_perdido: 0,
      ms: 0,
    };
    while (this.now() - started < this.startBudgetMs) {
      const batch = await this.store.claim(
        owner,
        this.kindFilter,
        this.leaseSeconds,
        this.batchSize,
      );
      if (batch.length === 0) break;
      report.reivindicados += batch.length;
      for (const job of batch) {
        await this.process(job, owner, report);
      }
    }
    report.ms = this.now() - started;
    return report;
  }

  private async process(job: ClaimedJob, owner: string, report: TickReport): Promise<void> {
    const handler = this.registry.get(job.kind);
    try {
      if (!handler) throw new UnknownKindError();
      const context: JobContext = {
        id: job.id,
        kind: job.kind,
        payload_ref: job.payload_ref,
        attempts: job.attempts,
      };
      await withTimeout(handler.run(context), this.handlerTimeoutMs);
    } catch (err) {
      report.falhos += 1;
      const code = err instanceof UnknownKindError ? 'kind_desconhecido' : errorCodeOf(err);
      const ok = await this.store.fail(job.id, owner, code, retrySecondsFor(job.attempts));
      if (!ok) report.lease_perdido += 1;
      return;
    }
    // O efeito do handler ja ocorreu; se o lease foi perdido, o handler idempotente cobre a repeticao.
    const ok = await this.store.complete(job.id, owner);
    if (ok) report.concluidos += 1;
    else report.lease_perdido += 1;
  }
}

/**
 * Gatilho C (oportunista): chamado depois da resposta, nunca no caminho da requisicao. Uma tentativa
 * por minuto por instancia; recuo exponencial apos falhas; nunca propaga excecao.
 */
export type OpportunisticOutcome = 'executado' | 'pulado' | 'falhou';

export interface OpportunisticTickOptions {
  tick: TickService;
  now?: () => number;
}

export class OpportunisticTick {
  private readonly tick: TickService;
  private readonly now: () => number;
  private running = false;
  private lastAttempt: number | null = null;
  private consecutiveFailures = 0;

  constructor(opts: OpportunisticTickOptions) {
    this.tick = opts.tick;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Nao dispara para /health nem para /internal/* (o proprio tick A nao gera tick C). */
  shouldTriggerFor(path: string): boolean {
    return path !== '/health' && !path.startsWith('/internal/');
  }

  async maybeRun(path: string): Promise<OpportunisticOutcome> {
    if (!this.shouldTriggerFor(path) || this.running) return 'pulado';
    const now = this.now();
    if (this.lastAttempt !== null && now - this.lastAttempt < this.waitMs()) return 'pulado';
    this.running = true;
    this.lastAttempt = now;
    try {
      await this.tick.run('c');
      this.consecutiveFailures = 0;
      return 'executado';
    } catch {
      this.consecutiveFailures += 1;
      return 'falhou';
    } finally {
      this.running = false;
    }
  }

  private waitMs(): number {
    if (this.consecutiveFailures === 0) return TICK_MIN_INTERVAL_MS;
    const exp = Math.min(this.consecutiveFailures - 1, 10);
    return Math.min(TICK_MIN_INTERVAL_MS * 2 ** exp, TICK_MAX_BACKOFF_MS);
  }
}

/** O segredo do tick so e usado se tiver pelo menos 32 caracteres (fecha por padrao). */
export function tickSecretIsUsable(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= TICK_MIN_SECRET_LENGTH;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Autenticacao do endpoint: 'Authorization: Bearer <segredo>', comparacao em tempo constante. */
export function isTickAuthorized(
  authorization: string | undefined,
  secret: string | undefined,
): boolean {
  if (!tickSecretIsUsable(secret)) return false;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(authorization.slice('Bearer '.length)), digest(secret));
}

export interface TickHttpRequest {
  method: string;
  path: string;
  authorization?: string;
  bodyBytes: number;
}

export interface TickHttpResponse {
  status: 200 | 401 | 404 | 413 | 503;
  headers: Record<string, string>;
  body: string;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Funcao pura do endpoint POST /internal/jobs/tick (desenho §4). O adaptador HTTP apenas mapeia
 * a requisicao e a resposta. Negativas (404, 401, 413) nao têm corpo util; a resposta de 401 e
 * sempre a mesma, qualquer que seja o motivo. O chamador nao escolhe job, kind, handler ou URL.
 */
export async function handleTickRequest(
  req: TickHttpRequest,
  deps: { tick: TickService; secret: string | undefined },
): Promise<TickHttpResponse> {
  if (req.method !== 'POST' || req.path !== TICK_PATH) {
    return { status: 404, headers: NO_STORE, body: '' };
  }
  if (!isTickAuthorized(req.authorization, deps.secret)) {
    return { status: 401, headers: NO_STORE, body: '' };
  }
  if (req.bodyBytes > TICK_BODY_LIMIT_BYTES) {
    return { status: 413, headers: NO_STORE, body: '' };
  }
  try {
    const r = await deps.tick.run('a');
    const body = JSON.stringify({
      ok: true,
      reivindicados: r.reivindicados,
      concluidos: r.concluidos,
      falhos: r.falhos,
      lease_perdido: r.lease_perdido,
      ms: r.ms,
    });
    return { status: 200, headers: { ...NO_STORE, 'Content-Type': 'application/json' }, body };
  } catch {
    return {
      status: 503,
      headers: { ...NO_STORE, 'Content-Type': 'application/json' },
      body: '{"ok":false}',
    };
  }
}

/** Handler de medicao (sem efeito). A chave por minuto evita duplicar a sonda no mesmo minuto. */
export const tickProbeHandler: JobHandler = {
  async run(): Promise<void> {
    return;
  },
};

export function tickProbeDedupeKey(at: Date): string {
  return `${TICK_PROBE_KIND}:${at.toISOString().slice(0, 16)}`;
}

/** Atraso (segundos) de jobs concluidos de um kind: p50 e p95 sobre updated_at - run_at. */
export const TICK_DELAY_SQL = `
  select percentile_cont(0.5) within group (order by extract(epoch from (updated_at - run_at))) as p50,
         percentile_cont(0.95) within group (order by extract(epoch from (updated_at - run_at))) as p95,
         count(*)::int as n
    from ops.job
   where kind = $1 and state = 'concluido' and run_at >= $2`;

export interface SqlResult {
  rows: Record<string, unknown>[];
}

/** Subconjunto de pg.Client usado pelo adaptador SQL (sem importar o driver aqui). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
}

const CLAIM_SQL = 'select * from private.job_claim($1, $2, $3, $4)';

/**
 * Adaptador SQL da porta JobStore. Com managedTransactions (padrao), a reivindicacao roda numa
 * transacao curta com lock_timeout de 3 s e statement_timeout de 10 s, e confirma antes de devolver.
 * Com managedTransactions=false (testes dentro de transacao com rollback), so executa a consulta.
 */
export class PgJobStore implements JobStore {
  private readonly client: SqlClient;
  private readonly managed: boolean;

  constructor(client: SqlClient, managedTransactions = true) {
    this.client = client;
    this.managed = managedTransactions;
  }

  async claim(
    owner: string,
    kind: string | null,
    leaseSeconds: number,
    limit: number,
  ): Promise<ClaimedJob[]> {
    const params = [owner, kind, leaseSeconds, limit];
    if (!this.managed) {
      return toClaimed((await this.client.query(CLAIM_SQL, params)).rows);
    }
    await this.client.query('begin');
    try {
      await this.client.query("set local lock_timeout = '3s'");
      await this.client.query("set local statement_timeout = '10s'");
      const res = await this.client.query(CLAIM_SQL, params);
      await this.client.query('commit');
      return toClaimed(res.rows);
    } catch (err) {
      await this.client.query('rollback').catch(() => undefined);
      throw err;
    }
  }

  async complete(id: string, owner: string): Promise<boolean> {
    const res = await this.client.query('select private.job_complete($1, $2) as ok', [id, owner]);
    return res.rows[0]?.ok === true;
  }

  async fail(id: string, owner: string, errorCode: string, retrySeconds: number): Promise<boolean> {
    const res = await this.client.query('select private.job_fail($1, $2, $3, $4) as ok', [
      id,
      owner,
      errorCode,
      retrySeconds,
    ]);
    return res.rows[0]?.ok === true;
  }
}

function toClaimed(rows: Record<string, unknown>[]): ClaimedJob[] {
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    payload_ref:
      r.payload_ref === null || r.payload_ref === undefined ? null : String(r.payload_ref),
    attempts: Number(r.attempts),
  }));
}
