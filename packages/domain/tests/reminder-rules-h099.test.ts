// H-099 | T-H099-12 a T-H099-15 (registro, alvo da regra, guarda de parametros). Porta em memoria; sem banco, sem rede.
import { describe, it, expect } from 'vitest';
import {
  NotificationRuleRegistry,
  PrazoNotificationRule,
  TrialNotificationRule,
  ContentGuardError,
  assertSafeTemplateParams,
  RuleRegistryError,
  type EventView,
  type ItemView,
  type ReminderSourcePort,
  type RequestReminderView,
  type TrialReminderView,
} from '../src/index.js';

const REQ = '00000000-0000-4000-8000-000000000001';
const GRANT = '00000000-0000-4000-8000-000000000002';
const CLIENTE = '00000000-0000-4000-8000-0000000000aa';
const PROF = '00000000-0000-4000-8000-0000000000bb';
const DEADLINE = '2026-11-08T10:00:00.000Z';
const NOW = '2026-11-07T10:30:00.000Z'; // T-24h + 30 min

class PortaMemoria implements ReminderSourcePort {
  pedido: RequestReminderView | null = null;
  trial: TrialReminderView | null = null;
  async requestView(): Promise<RequestReminderView | null> {
    return this.pedido;
  }
  async trialView(): Promise<TrialReminderView | null> {
    return this.trial;
  }
}

const pedido = (over: Partial<RequestReminderView> = {}): RequestReminderView => ({
  requestId: REQ,
  customerUserId: CLIENTE,
  status: 'publicado',
  acceptanceDeadlineAt: DEADLINE,
  customerStatus: 'ativo',
  ...over,
});
const trial = (over: Partial<TrialReminderView> = {}): TrialReminderView => ({
  grantId: GRANT,
  professionalUserId: PROF,
  grantStatus: 'ativa',
  endsAt: '2026-11-15T10:00:00.000Z',
  estado: 'trial_ativo',
  userStatus: 'ativo',
  ...over,
});
const evento = (type: string, aggregateId: string, marco: string, occurredAt: string): EventView => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  type,
  aggregateType: 'lembrete',
  aggregateId,
  occurredAt,
  payload: { marco },
});
const item = (emailType: string, scopeKey: string, recipient: string, occurredAt: string): ItemView => ({
  id: '00000000-0000-4000-8000-0000000000i1',
  recipientUserId: recipient,
  category: emailType.startsWith('prazo') ? 'prazo' : 'acesso',
  scopeKey,
  emailType,
  mailClass: 'lembrete',
  occurredAt,
});

describe('T-H099-12 registro das regras de lembrete', () => {
  it('registra prazo e trial sem duplicidade e resolve o tipo certo para os 4 tipos', () => {
    const porta = new PortaMemoria();
    const registro = new NotificationRuleRegistry();
    registro.register(new PrazoNotificationRule(porta, () => NOW));
    registro.register(new TrialNotificationRule(porta, () => NOW));
    expect(registro.forEmailType('prazo_t24').eventType).toBe('reminder.request');
    expect(registro.forEmailType('prazo_t0').eventType).toBe('reminder.request');
    expect(registro.forEmailType('acesso_trial_t3d').eventType).toBe('reminder.trial');
    expect(registro.forEmailType('acesso_trial_t0').eventType).toBe('reminder.trial');
    expect(() => registro.register(new PrazoNotificationRule(porta, () => NOW))).toThrow(RuleRegistryError);
  });
});

describe('T-H099-13 alvo produzido pela regra', () => {
  it('pedido em T-24h: destinatario do cliente, classe lembrete, chave e so request_ref', async () => {
    const porta = new PortaMemoria();
    porta.pedido = pedido();
    const regra = new PrazoNotificationRule(porta, () => NOW);
    const alvos = await regra.resolve(evento('reminder.request', REQ, 't24', '2026-11-07T10:00:00.000Z'));
    expect(alvos).toEqual([
      {
        recipientUserId: CLIENTE,
        category: 'prazo',
        emailType: 'prazo_t24',
        mailClass: 'lembrete',
        scopeKey: REQ,
        templateParams: { request_ref: REQ },
        dedupeKey: `req:prazo_t24:${REQ}`,
      },
    ]);
  });

  it('trial em T-3d: destinatario do profissional, sem parametros', async () => {
    const porta = new PortaMemoria();
    porta.trial = trial();
    const regra = new TrialNotificationRule(porta, () => '2026-11-12T10:30:00.000Z');
    const alvos = await regra.resolve(evento('reminder.trial', GRANT, 't3d', '2026-11-12T10:00:00.000Z'));
    expect(alvos).toEqual([
      {
        recipientUserId: PROF,
        category: 'acesso',
        emailType: 'acesso_trial_t3d',
        mailClass: 'lembrete',
        scopeKey: GRANT,
        templateParams: {},
        dedupeKey: `trial:t3d:${GRANT}`,
      },
    ]);
  });
});

describe('T-H099-14 resolve devolve vazio sem alvo valido', () => {
  it('recurso inexistente ou veredito nao valido: lista vazia', async () => {
    const porta = new PortaMemoria();
    const regra = new PrazoNotificationRule(porta, () => NOW);
    expect(await regra.resolve(evento('reminder.request', REQ, 't24', '2026-11-07T10:00:00.000Z'))).toEqual([]);
    porta.pedido = pedido({ status: 'cancelado' });
    expect(await regra.resolve(evento('reminder.request', REQ, 't24', '2026-11-07T10:00:00.000Z'))).toEqual([]);
    const trialRegra = new TrialNotificationRule(porta, () => NOW);
    expect(await trialRegra.resolve(evento('reminder.trial', GRANT, 't3d', '2026-11-07T10:00:00.000Z'))).toEqual([]);
  });

  it('isStillRelevant: pedido que virou selecionado depois da ingestao e descartado', async () => {
    const porta = new PortaMemoria();
    porta.pedido = pedido({ status: 'selecionado' });
    const regra = new PrazoNotificationRule(porta, () => NOW);
    expect(await regra.isStillRelevant(item('prazo_t24', REQ, CLIENTE, '2026-11-07T10:00:00.000Z'), NOW)).toBe('obsoleto');
  });
});

describe('T-H099-15 guarda de parametros dos quatro tipos', () => {
  it.each(['prazo_t24', 'prazo_t0', 'acesso_trial_t3d', 'acesso_trial_t0'])(
    '%s recusa telefone, texto livre, e-mail e endereco',
    (tipo) => {
      for (const chave of ['telefone', 'descricao', 'email', 'endereco']) {
        expect(() => assertSafeTemplateParams(tipo, { [chave]: 'x' })).toThrow(ContentGuardError);
      }
    },
  );
  it('aceita o request_ref do pedido', () => {
    expect(() => assertSafeTemplateParams('prazo_t24', { request_ref: REQ })).not.toThrow();
  });
});
