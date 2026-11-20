// H-099 (Issue 109) | Handlers dos lembretes no tick (docs/factory/163-DESENHO-H099.md §4.3). Nenhum e-mail sai daqui:
// reminder.fire so emite o evento de outbox; o despacho e o envio seguem o pipeline existente. Relogio injetado.
import {
  registerJobHandler,
  type JobContext,
  type JobHandler,
  type JobRegistry,
  type SqlClient,
} from './jobs-tick.js';

export const REMINDER_SCAN_KIND = 'reminder.scan';
export const REMINDER_FIRE_KIND = 'reminder.fire';
/** Balde do rearme: a varredura roda a cada 5 min (SCAN_INTERVAL_S do dominio). */
export const REMINDER_SCAN_BUCKET_MS = 300_000;

export type ReminderJobCode = 'payload_invalido' | 'marco_invalido';

/** Erro com codigo fixo: sem id, sem texto livre (o tick grava so o codigo). */
export class ReminderJobError extends Error {
  readonly code: ReminderJobCode;
  constructor(code: ReminderJobCode) {
    super(code);
    this.name = 'ReminderJobError';
    this.code = code;
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FIRE_REF_RE = new RegExp(`^(request|trial)\\|(t24|t0|t3d)\\|(${UUID})$`);

export interface FireRef {
  readonly subject: 'request' | 'trial';
  readonly marco: 't24' | 't0' | 't3d';
  readonly id: string;
}

/** Valida payload_ref '<assunto>|<marco>|<id>' e a combinacao assunto/marco. Qualquer outra forma e recusada. */
export function parseFireRef(ref: string | null): FireRef {
  const m = ref === null ? null : FIRE_REF_RE.exec(ref);
  if (m === null) throw new ReminderJobError('payload_invalido');
  const subject = m[1] as 'request' | 'trial';
  const marco = m[2] as 't24' | 't0' | 't3d';
  const valido = subject === 'request' ? marco !== 't3d' : marco !== 't24';
  if (!valido) throw new ReminderJobError('marco_invalido');
  return { subject, marco, id: m[3] as string };
}

/** Balde de 5 min do instante: um reminder.scan por balde (rearme idempotente). */
export function reminderScanBucket(nowMs: number): number {
  return Math.floor(nowMs / REMINDER_SCAN_BUCKET_MS);
}

export function reminderScanDedupeKey(bucket: number): string {
  return `${REMINDER_SCAN_KIND}:${bucket}`;
}

/** reminder.fire: emite o evento do marco (SQL reminder_emit). Falha tecnica propaga; o tick reagenda. */
export class ReminderFireHandler implements JobHandler {
  constructor(private readonly client: SqlClient) {}

  async run(job: JobContext): Promise<void> {
    const ref = parseFireRef(job.payload_ref);
    await this.client.query('select private.reminder_emit($1, $2, $3::uuid) as resultado', [
      ref.subject,
      ref.marco,
      ref.id,
    ]);
  }
}

/**
 * reminder.scan: rearma o proximo balde ANTES de varrer (se a varredura falhar, a cadeia nao quebra) e chama
 * private.reminder_scan. Devolve so contagens (nenhum id, nenhum texto).
 */
export class ReminderScanHandler implements JobHandler {
  constructor(
    private readonly client: SqlClient,
    private readonly now: () => number,
  ) {}

  async run(): Promise<void> {
    const nowMs = this.now();
    const proximo = reminderScanBucket(nowMs) + 1;
    await armaReminderScan(this.client, proximo);
    await this.client.query('select private.reminder_scan($1::timestamptz) as enfileirados', [
      new Date(nowMs).toISOString(),
    ]);
  }
}

/** Arma reminder.scan para o balde indicado (inicio do balde como run_at). Idempotente por dedupe_key. */
export async function armaReminderScan(client: SqlClient, bucket: number): Promise<void> {
  await client.query('select private.job_enqueue($1, $2, $3::timestamptz, null, 5) as id', [
    REMINDER_SCAN_KIND,
    reminderScanDedupeKey(bucket),
    new Date(bucket * REMINDER_SCAN_BUCKET_MS).toISOString(),
  ]);
}

/** Semeadura do primeiro reminder.scan (chamada pela composicao quando o tick estiver montado). */
export async function semeiaReminderScan(client: SqlClient, nowMs: number): Promise<void> {
  await armaReminderScan(client, reminderScanBucket(nowMs));
}

export interface ReminderHandlerDeps {
  readonly client: SqlClient;
  readonly now: () => number;
}

export function registerReminderHandlers(registry: JobRegistry, deps: ReminderHandlerDeps): void {
  registerJobHandler(registry, REMINDER_SCAN_KIND, new ReminderScanHandler(deps.client, deps.now));
  registerJobHandler(registry, REMINDER_FIRE_KIND, new ReminderFireHandler(deps.client));
}
