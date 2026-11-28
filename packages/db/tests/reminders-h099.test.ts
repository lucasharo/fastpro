// H-099 | T-H099-34 (handlers de lembrete: payload validado, rearme por balde, ordem rearme antes da varredura).
// Cliente SQL falso: sem banco, sem rede, sem relogio do sistema (now injetado).
import { describe, it, expect } from 'vitest';
import {
  ReminderFireHandler,
  ReminderJobError,
  ReminderScanHandler,
  REMINDER_SCAN_BUCKET_MS,
  parseFireRef,
  reminderScanBucket,
  reminderScanDedupeKey,
  type SqlClient,
} from '../src/reminders.js';

const ID = '11111111-2222-4333-8444-555555555555';

class SqlFalso implements SqlClient {
  readonly chamadas: { text: string; params: unknown[] }[] = [];
  falhaEm: string | null = null;
  async query(text: string, params: unknown[] = []) {
    this.chamadas.push({ text, params });
    if (this.falhaEm !== null && text.includes(this.falhaEm)) throw new Error('falha simulada');
    return { rows: [] };
  }
}

const job = (payload_ref: string | null) => ({ id: 'j1', kind: 'reminder.fire', payload_ref, attempts: 1 });

describe('T-H099-34 payload_ref validado', () => {
  it.each([
    ['request|t24|' + ID, 'request', 't24'],
    ['request|t0|' + ID, 'request', 't0'],
    ['trial|t3d|' + ID, 'trial', 't3d'],
    ['trial|t0|' + ID, 'trial', 't0'],
  ])('aceita %s', (ref, subject, marco) => {
    expect(parseFireRef(ref)).toEqual({ subject, marco, id: ID });
  });

  it.each([null, '', 'request|t24', 'request|t24|nao-e-uuid', 'outro|t24|' + ID, 'x'.repeat(200)])(
    'recusa forma invalida com codigo fixo (%s)',
    (ref) => {
      expect(() => parseFireRef(ref)).toThrow(ReminderJobError);
      try {
        parseFireRef(ref);
      } catch (err) {
        expect((err as ReminderJobError).code).toBe('payload_invalido');
      }
    },
  );

  it('recusa combinacao de assunto e marco que nao existe', () => {
    expect(() => parseFireRef('request|t3d|' + ID)).toThrow(ReminderJobError);
    expect(() => parseFireRef('trial|t24|' + ID)).toThrow(ReminderJobError);
  });
});

describe('T-H099-34 reminder.fire emite o evento e nao envia nada', () => {
  it('chama reminder_emit com assunto, marco e id; sem outra consulta', async () => {
    const sql = new SqlFalso();
    await new ReminderFireHandler(sql).run(job('request|t24|' + ID));
    expect(sql.chamadas).toHaveLength(1);
    expect(sql.chamadas[0]?.text).toContain('private.reminder_emit');
    expect(sql.chamadas[0]?.params).toEqual(['request', 't24', ID]);
  });

  it('payload invalido nao toca no banco', async () => {
    const sql = new SqlFalso();
    await expect(new ReminderFireHandler(sql).run(job('lixo'))).rejects.toThrow(ReminderJobError);
    expect(sql.chamadas).toHaveLength(0);
  });
});

describe('T-H099-34 reminder.scan: rearme por balde e varredura', () => {
  const AGORA = Date.parse('2026-11-20T10:02:00.000Z');
  const BALDE = reminderScanBucket(AGORA);

  it('rearma o proximo balde (run_at no inicio dele) antes de chamar a varredura', async () => {
    const sql = new SqlFalso();
    await new ReminderScanHandler(sql, () => AGORA).run();
    expect(sql.chamadas).toHaveLength(2);
    expect(sql.chamadas[0]?.text).toContain('private.job_enqueue');
    expect(sql.chamadas[0]?.params).toEqual([
      'reminder.scan',
      reminderScanDedupeKey(BALDE + 1),
      new Date((BALDE + 1) * REMINDER_SCAN_BUCKET_MS).toISOString(),
    ]);
    expect(sql.chamadas[1]?.text).toContain('private.reminder_scan');
    expect(sql.chamadas[1]?.params).toEqual([new Date(AGORA).toISOString()]);
  });

  it('duas execucoes no mesmo balde armam a mesma chave (idempotente)', async () => {
    const a = new SqlFalso();
    const b = new SqlFalso();
    await new ReminderScanHandler(a, () => AGORA).run();
    await new ReminderScanHandler(b, () => AGORA + 60_000).run();
    expect(a.chamadas[0]?.params[1]).toBe(b.chamadas[0]?.params[1]);
  });

  it('se a varredura falhar, o proximo balde ja foi armado (a cadeia nao quebra)', async () => {
    const sql = new SqlFalso();
    sql.falhaEm = 'reminder_scan';
    await expect(new ReminderScanHandler(sql, () => AGORA).run()).rejects.toThrow('falha simulada');
    expect(sql.chamadas[0]?.text).toContain('job_enqueue');
  });
});
