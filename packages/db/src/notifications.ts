// H-092 | Adaptador Pg e handlers do pipeline de notificacoes (docs/factory/35-DESENHO-H092.md, §4.3, §5).
// Orquestra as funcoes SQL de supabase/migrations/20261111120000_notifications_create_pipeline.sql.
// Nenhum endereco de e-mail e gravado: ele existe so em memoria durante a chamada ao provedor.
// Nenhum log recebe endereco, texto ou identificador de pessoa: so codigos fixos.
import {
  PROVIDER_LIMITS,
  QUOTA_CUTS,
  alertLevelFor,
  assertCombination,
  assertSafeTemplateParams,
  NOTIFICATION_EFFECTIVE_FROM_MS,
  isDigestCategory,
  summaryTypeFor,
  windowSecondsFrom,
  WINDOW_SETTING,
  type Category,
  type AlertLevel,
  type ClockPort,
  type DigestCategory,
  type EmailProviderPort,
  type EventView,
  type ItemView,
  type MailClass,
  type NotificationRuleRegistry,
  type RecipientDirectoryPort,
  type RuleTarget,
  type Verdict,
} from '@fastpro/domain';
import {
  registerJobHandler,
  type JobContext,
  type JobHandler,
  type JobRegistry,
  type SqlClient,
} from './jobs-tick.js';

export const DISPATCH_BATCH = 50;
export const MAX_SEND_ATTEMPTS = 8;
export const PACE_MS = 200;
const BACKOFF_CAP_SECONDS = 3600;
const RATE_LIMIT_MIN_SECONDS = 60;
const NOT_CONFIGURED_WAIT_SECONDS = 3600;
const REASON_RE = /^[a-z][a-z0-9_]{0,59}$/;

export interface NotificationDeps {
  readonly client: SqlClient;
  readonly registry: NotificationRuleRegistry;
  readonly provider: EmailProviderPort;
  readonly directory: RecipientDirectoryPort;
  readonly clock: ClockPort;
  /** Producao: o banco decide o instante (clock_timestamp). Testes: false, com o ClockPort. */
  readonly useDbClock: boolean;
  /**
   * Ponto de injecao (H-094, 59-DESENHO §2.4): chamado so quando um contador SOBE de nivel (70 ou 85),
   * uma vez por subida. So informa; o envio nao le isto. Sem dado pessoal: periodo, nivel e uso.
   */
  readonly onQuotaAlert?: (alerta: QuotaAlert) => void;
}

/** Evento de alerta de cota (H-094). Nao contem destinatario, endereco nem texto. */
export interface QuotaAlert {
  readonly period: 'dia_utc' | 'mes';
  readonly level: 1 | 2;
  readonly used: number;
}

/** Resultado da gravacao de alerta: se cada contador subiu de nivel nesta chamada. */
export interface AlertsRecorded {
  readonly diaSubiu: boolean;
  readonly mesSubiu: boolean;
  readonly nivelDia: AlertLevel;
  readonly nivelMes: AlertLevel;
}

/** Monta o evento so quando ha nivel (0 nao alerta). */
function quotaAlertFor(
  period: QuotaAlert['period'],
  level: AlertLevel,
  used: number,
): QuotaAlert | null {
  if (level === 0) return null;
  return { period, level, used };
}

/**
 * Grava os niveis de alerta dos contadores do dia e do mes e emite onQuotaAlert so nas subidas
 * (H-094, 59-DESENHO §2.2 e §4). Abaixo de 70% nos dois contadores nao ha escrita no banco.
 */
export async function registrarAlertasDeCota(
  d: Pick<NotificationDeps, 'onQuotaAlert'>,
  store: { recordAlerts(dia: AlertLevel, mes: AlertLevel): Promise<AlertsRecorded> },
  usadoDia: number,
  usadoMes: number,
): Promise<void> {
  const nivelDia = alertLevelFor(usadoDia, PROVIDER_LIMITS.dia);
  const nivelMes = alertLevelFor(usadoMes, PROVIDER_LIMITS.mes);
  if (nivelDia === 0 && nivelMes === 0) return;
  const sobe = await store.recordAlerts(nivelDia, nivelMes);
  if (sobe.diaSubiu) {
    const a = quotaAlertFor('dia_utc', nivelDia, usadoDia);
    if (a) d.onQuotaAlert?.(a);
  }
  if (sobe.mesSubiu) {
    const a = quotaAlertFor('mes', nivelMes, usadoMes);
    if (a) d.onQuotaAlert?.(a);
  }
}

export type Drop = { readonly id: string; readonly motivo: Exclude<Verdict, 'valido'> };

export interface FlushKey {
  readonly recipientUserId: string;
  readonly category: DigestCategory;
  readonly scopeKey: string;
}

export interface OutboxRow {
  readonly id: string;
  readonly recipientUserId: string;
  readonly mailClass: MailClass;
  readonly template: string;
  readonly params: Record<string, unknown>;
  readonly dedupeKey: string;
  readonly attempts: number;
  readonly quotaReserved: boolean;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const first = (rows: Record<string, unknown>[]): Record<string, unknown> | undefined => rows[0];
const reasonOf = (code: string): string => (REASON_RE.test(code) ? code : 'erro_provedor');
const isoAt = (ms: number, addSeconds = 0): string =>
  new Date(ms + addSeconds * 1000).toISOString();

const itemOf = (r: Record<string, unknown>): ItemView => ({
  id: String(r.id),
  recipientUserId: String(r.recipient_user_id),
  category: r.category as Category,
  scopeKey: String(r.scope_key),
  emailType: String(r.email_type),
  mailClass: r.class as MailClass,
  occurredAt: iso(r.occurred_at),
});

/** Espacamento minimo entre envios do processo (35 §5.4 passo 5): 200 ms, no maximo 5 por segundo. */
export class SendPacer {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly clock: ClockPort,
    private readonly gapMs: number = PACE_MS,
  ) {}

  async wait(): Promise<void> {
    const wait = this.last + this.gapMs - this.clock.nowMs();
    if (wait > 0) await this.clock.sleep(wait);
    this.last = this.clock.nowMs();
  }
}

/** Adaptador das funcoes SQL do pipeline. Cada metodo e uma chamada atomica no banco. */
export class PgNotificationStore {
  constructor(private readonly d: NotificationDeps) {}

  private get db(): SqlClient {
    return this.d.client;
  }

  private now(): string | null {
    return this.d.useDbClock ? null : isoAt(this.d.clock.nowMs());
  }

  async pendingEvents(limit: number): Promise<EventView[]> {
    const res = await this.db.query(
      'select id, type, aggregate_type, aggregate_id, occurred_at, payload from ops.outbox_event ' +
        'where dispatched_at is null order by occurred_at, id limit $1',
      [limit],
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      aggregateType: String(r.aggregate_type),
      aggregateId: String(r.aggregate_id),
      occurredAt: iso(r.occurred_at),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async markDispatched(id: string): Promise<void> {
    await this.db.query(
      'update ops.outbox_event set dispatched_at = clock_timestamp() where id = $1 and dispatched_at is null',
      [id],
    );
  }

  async windowFor(category: DigestCategory): Promise<number> {
    const res = await this.db.query('select value from ops.app_config where key = $1', [
      WINDOW_SETTING[category],
    ]);
    return windowSecondsFrom(first(res.rows)?.value);
  }

  async ingest(a: {
    readonly recipientUserId: string;
    readonly category: Category;
    readonly scopeKey: string;
    readonly eventId: string;
    readonly occurredAt: string;
    readonly emailType: string;
    readonly mailClass: MailClass;
    readonly params: Readonly<Record<string, unknown>>;
    readonly dedupeKey: string | null;
    readonly windowSeconds: number | null;
  }): Promise<string> {
    const res = await this.db.query(
      'select * from private.notification_ingest($1::uuid, $2, $3, $4::uuid, $5::timestamptz, $6, $7, ' +
        '$8::jsonb, $9, $10::integer, $11::timestamptz)',
      [
        a.recipientUserId,
        a.category,
        a.scopeKey,
        a.eventId,
        a.occurredAt,
        a.emailType,
        a.mailClass,
        JSON.stringify(a.params),
        a.dedupeKey,
        a.windowSeconds,
        this.now(),
      ],
    );
    return String(first(res.rows)?.out_resultado);
  }

  async flushBegin(key: FlushKey): Promise<{
    estado: string;
    cooldownAte: string | null;
    itemIds: string[];
  }> {
    // cooldown_until vai como texto para manter a precisao de microssegundos (chave de comparacao).
    const res = await this.db.query(
      'select out_estado as estado, out_cooldown_ate::text as cooldown_ate, out_item_ids as item_ids ' +
        'from private.notification_flush_begin($1::uuid, $2, $3, $4::timestamptz)',
      [key.recipientUserId, key.category, key.scopeKey, this.now()],
    );
    const r = first(res.rows);
    return {
      estado: String(r?.estado),
      cooldownAte: r?.cooldown_ate == null ? null : String(r.cooldown_ate),
      itemIds: (r?.item_ids as string[] | null) ?? [],
    };
  }

  async loadItems(ids: string[]): Promise<ItemView[]> {
    if (ids.length === 0) return [];
    const res = await this.db.query(
      'select id, recipient_user_id, category, scope_key, email_type, class, occurred_at ' +
        'from ops.notification_item where id = any($1::uuid[]) order by occurred_at, id',
      [ids],
    );
    return res.rows.map(itemOf);
  }

  async flushCommit(a: {
    readonly key: FlushKey;
    readonly expected: string;
    readonly keep: string[];
    readonly drops: Drop[];
    readonly emailType: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly windowSeconds: number;
  }): Promise<string> {
    const res = await this.db.query(
      'select out_resultado as resultado from private.notification_flush_commit(' +
        '$1::uuid, $2, $3, $4::timestamptz, $5::uuid[], $6::jsonb, $7, $8::jsonb, $9::integer, $10::timestamptz)',
      [
        a.key.recipientUserId,
        a.key.category,
        a.key.scopeKey,
        a.expected,
        a.keep,
        JSON.stringify(a.drops),
        a.emailType,
        JSON.stringify(a.params),
        a.windowSeconds,
        this.now(),
      ],
    );
    return String(first(res.rows)?.resultado);
  }

  async itemsOfOutbox(outboxId: string): Promise<ItemView[]> {
    const res = await this.db.query(
      'select id, recipient_user_id, category, scope_key, email_type, class, occurred_at ' +
        "from ops.notification_item where outbox_id = $1::uuid and state = 'enviado'",
      [outboxId],
    );
    return res.rows.map(itemOf);
  }

  async claim(outboxId: string): Promise<OutboxRow | null> {
    const res = await this.db.query(
      'select * from private.email_outbox_claim($1::uuid, $2::timestamptz)',
      [outboxId, this.now()],
    );
    const r = first(res.rows);
    if (!r) return null;
    return {
      id: String(r.id),
      recipientUserId: String(r.recipient_user_id),
      mailClass: r.class as MailClass,
      template: String(r.template),
      params: (r.template_params ?? {}) as Record<string, unknown>,
      dedupeKey: String(r.dedupe_key),
      attempts: Number(r.attempts),
      quotaReserved: r.quota_reserved === true,
    };
  }

  async adjustItems(outboxId: string, drops: Drop[]): Promise<number> {
    const res = await this.db.query(
      'select private.email_outbox_ajustar_itens($1::uuid, $2::jsonb) as restantes',
      [outboxId, JSON.stringify(drops)],
    );
    return Number(first(res.rows)?.restantes ?? 0);
  }

  async reserveQuota(
    outboxId: string,
    cutDay: number,
    cutMonth: number,
  ): Promise<{
    permitido: boolean;
    bloqueadoPor: string | null;
    usadoDia: number;
    usadoMes: number;
    proxima: string | null;
  } | null> {
    const res = await this.db.query(
      'select * from private.email_outbox_reservar_cota($1::uuid, $2::integer, $3::integer, $4::timestamptz)',
      [outboxId, cutDay, cutMonth, this.now()],
    );
    const r = first(res.rows);
    if (!r) return null;
    return {
      permitido: r.out_permitido === true,
      bloqueadoPor: r.out_bloqueado_por == null ? null : String(r.out_bloqueado_por),
      usadoDia: Number(r.out_usado_dia),
      usadoMes: Number(r.out_usado_mes),
      proxima: r.out_proxima_tentativa == null ? null : iso(r.out_proxima_tentativa),
    };
  }

  async markSent(outboxId: string, provider: string, messageId: string): Promise<void> {
    await this.db.query(
      'select private.email_outbox_marcar_enviado($1::uuid, $2, $3, $4::timestamptz)',
      [outboxId, provider, messageId, this.now()],
    );
  }

  async requeue(
    outboxId: string,
    state: 'pendente' | 'adiado_cota',
    attempts: number,
    nextAt: string,
    reason: string,
    releaseQuota: boolean,
  ): Promise<void> {
    await this.db.query(
      'select private.email_outbox_reagendar($1::uuid, $2, $3::integer, $4::timestamptz, $5, $6::boolean)',
      [outboxId, state, attempts, nextAt, reason, releaseQuota],
    );
  }

  async finish(
    outboxId: string,
    state: 'falha' | 'suprimido' | 'descartado',
    reason: string,
    releaseQuota: boolean,
  ): Promise<void> {
    await this.db.query('select private.email_outbox_encerrar($1::uuid, $2, $3, $4::boolean)', [
      outboxId,
      state,
      reason,
      releaseQuota,
    ]);
  }

  async recordAlerts(levelDay: AlertLevel, levelMonth: AlertLevel): Promise<AlertsRecorded> {
    const res = await this.db.query(
      'select * from private.email_quota_registrar_alerta($1::smallint, $2::smallint, $3::timestamptz)',
      [levelDay, levelMonth, this.now()],
    );
    const r = first(res.rows);
    if (!r) return { diaSubiu: false, mesSubiu: false, nivelDia: 0, nivelMes: 0 };
    return {
      diaSubiu: r.out_dia_subiu === true,
      mesSubiu: r.out_mes_subiu === true,
      nivelDia: Number(r.out_nivel_dia) as AlertLevel,
      nivelMes: Number(r.out_nivel_mes) as AlertLevel,
    };
  }
}

function ruleFor(d: NotificationDeps, item: ItemView) {
  return d.registry.forEmailType(item.emailType);
}

/** Despachante (outbox.dispatch): evento -> itens e linhas de envio. Falha isolada por evento. */
export async function dispatchOutbox(
  d: NotificationDeps,
): Promise<{ lidos: number; falhas: number }> {
  const store = new PgNotificationStore(d);
  const events = await store.pendingEvents(DISPATCH_BATCH);
  let falhas = 0;
  for (const ev of events) {
    // H-100 (49 §1.2): evento anterior ao marco de vigencia so recebe dispatched_at (sem regra, item,
    // linha ou envio). Data ilegivel nao e despachada: conta como falha e tenta de novo (falha fechada).
    const ocorrido = Date.parse(ev.occurredAt);
    if (Number.isNaN(ocorrido)) {
      falhas += 1;
      continue;
    }
    if (ocorrido < NOTIFICATION_EFFECTIVE_FROM_MS) {
      await store.markDispatched(ev.id);
      continue;
    }
    const rule = d.registry.forEvent(ev.type);
    if (!rule) {
      // Sem regra registrada: marca como despachado sem efeito (35 DD-7, CA-12).
      await store.markDispatched(ev.id);
      continue;
    }
    try {
      for (const t of await rule.resolve(ev)) {
        await ingestTarget(store, ev, t);
      }
      await store.markDispatched(ev.id);
    } catch {
      falhas += 1; // so a contagem; o evento tenta de novo na proxima execucao
    }
  }
  return { lidos: events.length, falhas };
}

async function ingestTarget(
  store: PgNotificationStore,
  ev: EventView,
  t: RuleTarget,
): Promise<void> {
  assertCombination(t.category, t.emailType, t.mailClass);
  assertSafeTemplateParams(t.emailType, t.templateParams);
  if (t.mailClass === 'digest') {
    if (!isDigestCategory(t.category)) throw new Error('categoria_digest_invalida');
    await store.ingest({
      recipientUserId: t.recipientUserId,
      category: t.category,
      scopeKey: t.scopeKey,
      eventId: ev.id,
      occurredAt: ev.occurredAt,
      emailType: t.emailType,
      mailClass: t.mailClass,
      params: t.templateParams,
      dedupeKey: null,
      windowSeconds: await store.windowFor(t.category),
    });
    return;
  }
  await store.ingest({
    recipientUserId: t.recipientUserId,
    category: t.category,
    scopeKey: t.scopeKey,
    eventId: ev.id,
    occurredAt: ev.occurredAt,
    emailType: t.emailType,
    mailClass: t.mailClass,
    params: t.templateParams,
    dedupeKey: t.dedupeKey ?? `nc:${ev.id}:${t.recipientUserId}:${t.category}:${t.scopeKey}`,
    windowSeconds: null,
  });
}

/** Flush do agrupamento (notification.flush): comeco, avaliacao fora de transacao, fechamento. */
export async function flushGroup(d: NotificationDeps, key: FlushKey): Promise<void> {
  const store = new PgNotificationStore(d);
  const begin = await store.flushBegin(key);
  if (begin.estado !== 'pronto' || begin.cooldownAte === null) return;
  const items = await store.loadItems(begin.itemIds);
  if (items.length === 0) return;

  const keep: string[] = [];
  const drops: Drop[] = [];
  for (const item of items) {
    const verdict = await ruleFor(d, item).isStillRelevant(item, isoAt(d.clock.nowMs()));
    if (verdict === 'valido') keep.push(item.id);
    else drops.push({ id: item.id, motivo: verdict });
  }

  const emailType = summaryTypeFor(key.category);
  const params =
    key.category === 'aceite' ? { request_ref: key.scopeKey } : { conversation_ref: key.scopeKey };
  assertSafeTemplateParams(emailType, { ...params, count: 1 });

  await store.flushCommit({
    key,
    expected: begin.cooldownAte,
    keep,
    drops,
    emailType,
    params,
    windowSeconds: await store.windowFor(key.category),
  });
}

/** Envio de uma linha (email.send): revalida, resolve, reserva cota, envia e fecha o resultado. */
export async function processOutbox(
  d: NotificationDeps,
  outboxId: string,
  pacer: SendPacer,
): Promise<void> {
  const store = new PgNotificationStore(d);
  const row = await store.claim(outboxId);
  if (!row) return;

  const items = await store.itemsOfOutbox(outboxId);
  if (row.mailClass !== 'auth' && items.length > 0) {
    const drops: Drop[] = [];
    for (const item of items) {
      const verdict = await ruleFor(d, item).isStillRelevant(item, isoAt(d.clock.nowMs()));
      if (verdict !== 'valido') drops.push({ id: item.id, motivo: verdict });
    }
    if (drops.length > 0) {
      const restantes = await store.adjustItems(outboxId, drops);
      if (restantes === 0) {
        await store.finish(outboxId, 'descartado', 'sem_item_valido', true);
        return;
      }
    }
  }

  const dir = await d.directory.resolve(row.recipientUserId);
  if (dir.status === 'suprimido') {
    await store.finish(outboxId, 'suprimido', 'endereco_suprimido', true);
    return;
  }
  if (dir.status === 'inexistente') {
    if (items.length > 0) {
      await store.adjustItems(
        outboxId,
        items.map((i) => ({ id: i.id, motivo: 'destinatario_invalido' as const })),
      );
    }
    await store.finish(outboxId, 'descartado', 'destinatario_invalido', true);
    return;
  }

  if (!row.quotaReserved) {
    const cut = QUOTA_CUTS[row.mailClass];
    const r = await store.reserveQuota(outboxId, cut.dia, cut.mes);
    if (!r) return;
    if (!r.permitido) {
      await store.requeue(
        outboxId,
        'adiado_cota',
        row.attempts,
        r.proxima ?? isoAt(d.clock.nowMs(), 86_400),
        `cota_${r.bloqueadoPor ?? 'dia'}`,
        false,
      );
      return;
    }
    await registrarAlertasDeCota(d, store, r.usadoDia, r.usadoMes);
  }

  await pacer.wait();
  const res = await d.provider.send({
    to: dir.email,
    templateKey: row.template,
    params: row.params,
    idempotencyKey: row.dedupeKey,
  });
  const now = d.clock.nowMs();
  switch (res.kind) {
    case 'aceito':
      await store.markSent(outboxId, d.provider.name, res.providerMessageId);
      return;
    case 'limite_taxa':
      await store.requeue(
        outboxId,
        'pendente',
        row.attempts,
        isoAt(now, Math.max(res.retryAfterSeconds, RATE_LIMIT_MIN_SECONDS)),
        'limite_taxa',
        true,
      );
      return;
    case 'indisponivel': {
      const attempts = row.attempts + 1;
      const code = reasonOf(res.code);
      if (attempts >= MAX_SEND_ATTEMPTS) {
        await store.finish(outboxId, 'falha', code, true);
        return;
      }
      const wait = Math.min(60 * 2 ** (attempts - 1), BACKOFF_CAP_SECONDS);
      await store.requeue(outboxId, 'pendente', attempts, isoAt(now, wait), code, true);
      return;
    }
    case 'recusa_permanente':
      await store.finish(outboxId, 'falha', reasonOf(res.code), true);
      return;
    case 'nao_configurado':
      await store.requeue(
        outboxId,
        'pendente',
        row.attempts,
        isoAt(now, NOT_CONFIGURED_WAIT_SECONDS),
        reasonOf(res.code),
        true,
      );
      return;
  }
}

function parseFlushKey(payload: string | null): FlushKey {
  const parts = (payload ?? '').split('|');
  const [recipientUserId, category, scopeKey] = parts;
  if (parts.length !== 3 || !recipientUserId || !scopeKey) throw new Error('payload_invalido');
  if (category !== 'aceite' && category !== 'mensagem') throw new Error('payload_invalido');
  return { recipientUserId, category, scopeKey };
}

export class OutboxDispatchHandler implements JobHandler {
  constructor(private readonly d: NotificationDeps) {}

  async run(): Promise<void> {
    await dispatchOutbox(this.d);
  }
}

export class NotificationFlushHandler implements JobHandler {
  constructor(private readonly d: NotificationDeps) {}

  async run(job: JobContext): Promise<void> {
    await flushGroup(this.d, parseFlushKey(job.payload_ref));
  }
}

export class EmailSendHandler implements JobHandler {
  constructor(
    private readonly d: NotificationDeps,
    private readonly pacer: SendPacer,
  ) {}

  async run(job: JobContext): Promise<void> {
    if (!job.payload_ref) throw new Error('payload_ausente');
    await processOutbox(this.d, job.payload_ref, this.pacer);
  }
}

/** Registra os tres handlers do pipeline no JobRegistry do tick (um por kind). */
export function registerNotificationHandlers(registry: JobRegistry, d: NotificationDeps): void {
  const pacer = new SendPacer(d.clock);
  registerJobHandler(registry, 'outbox.dispatch', new OutboxDispatchHandler(d));
  registerJobHandler(registry, 'notification.flush', new NotificationFlushHandler(d));
  registerJobHandler(registry, 'email.send', new EmailSendHandler(d, pacer));
}
