// H-099 | Adaptador PgReminderSource (163 §4.3, A-5): mapeia as views minimas e recusa visao fora do contrato.
// SQL falso: sem banco, sem rede, sem relogio do sistema (nowIso injetado).
import { describe, it, expect } from 'vitest';
import { PgReminderSource, ReminderViewError, type SqlClient } from '../src/reminders.js';

const REQ = '11111111-2222-4333-8444-555555555555';
const GRANT = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const CLIENTE = '99999999-8888-4777-8666-555555555555';
const AGORA = '2099-06-10T12:00:00.000Z';

class SqlFalso implements SqlClient {
  readonly chamadas: { text: string; params: unknown[] }[] = [];
  constructor(private readonly linhas: Record<string, unknown>[]) {}
  async query(text: string, params: unknown[] = []) {
    this.chamadas.push({ text, params });
    return { rows: this.linhas };
  }
}

const linhaPedido = (over: Record<string, unknown> = {}) => ({
  request_id: REQ,
  customer_user_id: CLIENTE,
  request_status: 'publicado',
  acceptance_deadline_at: new Date('2099-06-11T12:00:00.000Z'),
  customer_status: 'ativo',
  ...over,
});

const linhaTrial = (over: Record<string, unknown> = {}) => ({
  grant_id: GRANT,
  professional_user_id: CLIENTE,
  grant_status: 'ativa',
  ends_at: new Date('2099-06-13T12:00:00.000Z'),
  estado: 'trial_ativo',
  user_status: 'ativo',
  ...over,
});

describe('PgReminderSource.requestView', () => {
  it('le a view minima com o id do pedido e mapeia para o contrato do dominio', async () => {
    const sql = new SqlFalso([linhaPedido()]);
    const v = await new PgReminderSource(sql).requestView(REQ);
    expect(v).toEqual({
      requestId: REQ,
      customerUserId: CLIENTE,
      status: 'publicado',
      acceptanceDeadlineAt: '2099-06-11T12:00:00.000Z',
      customerStatus: 'ativo',
    });
    expect(sql.chamadas[0]?.text).toContain('private.reminder_request_view');
    expect(sql.chamadas[0]?.params).toEqual([REQ]);
  });

  it('devolve null quando a view nao tem linha (pedido inexistente)', async () => {
    expect(await new PgReminderSource(new SqlFalso([])).requestView(REQ)).toBeNull();
  });

  it('recusa status fora do contrato com codigo fixo (falha fechada)', async () => {
    const src = new PgReminderSource(new SqlFalso([linhaPedido({ request_status: 'rascunho' })]));
    await expect(src.requestView(REQ)).rejects.toThrow(ReminderViewError);
    try {
      await src.requestView(REQ);
    } catch (err) {
      expect((err as ReminderViewError).code).toBe('visao_invalida');
    }
  });

  it('recusa prazo ilegivel', async () => {
    const src = new PgReminderSource(new SqlFalso([linhaPedido({ acceptance_deadline_at: 'nao-e-data' })]));
    await expect(src.requestView(REQ)).rejects.toThrow(ReminderViewError);
  });
});

describe('PgReminderSource.trialView', () => {
  it('le a view com o instante do agora injetado e mapeia a concessao', async () => {
    const sql = new SqlFalso([linhaTrial()]);
    const v = await new PgReminderSource(sql).trialView(GRANT, AGORA);
    expect(v).toEqual({
      grantId: GRANT,
      professionalUserId: CLIENTE,
      grantStatus: 'ativa',
      endsAt: '2099-06-13T12:00:00.000Z',
      estado: 'trial_ativo',
      userStatus: 'ativo',
    });
    expect(sql.chamadas[0]?.text).toContain('private.reminder_trial_view');
    expect(sql.chamadas[0]?.params).toEqual([GRANT, AGORA]);
  });

  it('sem estado derivado (commercial_access sem linha) devolve null: nenhum lembrete', async () => {
    expect(await new PgReminderSource(new SqlFalso([linhaTrial({ estado: null })])).trialView(GRANT, AGORA)).toBeNull();
  });

  it('recusa estado e status de concessao fora do contrato', async () => {
    const src1 = new PgReminderSource(new SqlFalso([linhaTrial({ estado: 'qualquer' })]));
    await expect(src1.trialView(GRANT, AGORA)).rejects.toThrow(ReminderViewError);
    const src2 = new PgReminderSource(new SqlFalso([linhaTrial({ grant_status: 'expirada' })]));
    await expect(src2.trialView(GRANT, AGORA)).rejects.toThrow(ReminderViewError);
  });

  it('devolve null quando a concessao nao existe', async () => {
    expect(await new PgReminderSource(new SqlFalso([])).trialView(GRANT, AGORA)).toBeNull();
  });
});
