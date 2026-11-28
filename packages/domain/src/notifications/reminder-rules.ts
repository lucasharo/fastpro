// H-099 | Regras de notificacao dos lembretes (desenho 163 §3.1). Uma regra por evento, nao por tipo de e-mail (A-2).
// Cada regra decide duas vezes com a mesma funcao pura (A-4): em resolve (evita item inutil) e em isStillRelevant
// (cobre mudanca entre ingestao e envio e reenvio apos adiado_cota). Nunca recebe nem devolve endereco de e-mail.
import { assertSafeTemplateParams } from './content-guard.js';
import type { ReminderSourcePort } from './ports.js';
import {
  decideRequestReminder,
  decideTrialReminder,
} from './reminders.js';
import type { EventView, ItemView, NotificationRule, RuleTarget, Verdict } from './rules.js';

export const REMINDER_REQUEST_EVENT = 'reminder.request';
export const REMINDER_TRIAL_EVENT = 'reminder.trial';

/** Relogio injetado: a regra nunca le o relogio do sistema (testes com instante fixo). */
export type ReminderClock = () => string;

const REQUEST_TYPES: Readonly<Record<string, 't24' | 't0'>> = { prazo_t24: 't24', prazo_t0: 't0' };
const TRIAL_TYPES: Readonly<Record<string, 't3d' | 't0'>> = { acesso_trial_t3d: 't3d', acesso_trial_t0: 't0' };

function marcoDoPayload(event: EventView): string | null {
  const marco = event.payload['marco'];
  return typeof marco === 'string' ? marco : null;
}

export class PrazoNotificationRule implements NotificationRule {
  readonly eventType = REMINDER_REQUEST_EVENT;
  readonly emailTypes: readonly string[] = ['prazo_t24', 'prazo_t0'];

  constructor(
    private readonly source: ReminderSourcePort,
    private readonly clock: ReminderClock,
  ) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const marco = marcoDoPayload(event);
    if (marco !== 't24' && marco !== 't0') return [];
    const tipo = marco === 't24' ? 'prazo_t24' : 'prazo_t0';
    const now = this.clock();
    const view = await this.source.requestView(event.aggregateId, now);
    if (view === null) return [];
    if (decideRequestReminder(marco, view, event.occurredAt, now) !== 'valido') return [];
    const params = { request_ref: view.requestId };
    assertSafeTemplateParams(tipo, params);
    return [
      {
        recipientUserId: view.customerUserId,
        category: 'prazo',
        emailType: tipo,
        mailClass: 'lembrete',
        scopeKey: view.requestId,
        templateParams: params,
        dedupeKey: `req:${tipo}:${view.requestId}`,
      },
    ];
  }

  async isStillRelevant(item: ItemView, nowIso: string): Promise<Verdict> {
    const marco = REQUEST_TYPES[item.emailType];
    if (marco === undefined) return 'obsoleto';
    const view = await this.source.requestView(item.scopeKey, nowIso);
    if (view === null || view.customerUserId !== item.recipientUserId) return 'obsoleto';
    return decideRequestReminder(marco, view, item.occurredAt, nowIso);
  }
}

export class TrialNotificationRule implements NotificationRule {
  readonly eventType = REMINDER_TRIAL_EVENT;
  readonly emailTypes: readonly string[] = ['acesso_trial_t3d', 'acesso_trial_t0'];

  constructor(
    private readonly source: ReminderSourcePort,
    private readonly clock: ReminderClock,
  ) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const marco = marcoDoPayload(event);
    if (marco !== 't3d' && marco !== 't0') return [];
    const tipo = marco === 't3d' ? 'acesso_trial_t3d' : 'acesso_trial_t0';
    const now = this.clock();
    const view = await this.source.trialView(event.aggregateId, now);
    if (view === null) return [];
    if (decideTrialReminder(marco, view, event.occurredAt, now) !== 'valido') return [];
    assertSafeTemplateParams(tipo, {});
    return [
      {
        recipientUserId: view.professionalUserId,
        category: 'acesso',
        emailType: tipo,
        mailClass: 'lembrete',
        scopeKey: view.grantId,
        templateParams: {},
        dedupeKey: `trial:${marco}:${view.grantId}`,
      },
    ];
  }

  async isStillRelevant(item: ItemView, nowIso: string): Promise<Verdict> {
    const marco = TRIAL_TYPES[item.emailType];
    if (marco === undefined) return 'obsoleto';
    const view = await this.source.trialView(item.scopeKey, nowIso);
    if (view === null || view.professionalUserId !== item.recipientUserId) return 'obsoleto';
    return decideTrialReminder(marco, view, item.occurredAt, nowIso);
  }
}
