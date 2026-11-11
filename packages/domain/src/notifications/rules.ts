// H-092 | Contrato de regra de notificacao e registro (docs/factory/35-DESENHO-H092.md, §4.1).
// Cada historia de categoria (H-095..H-099) registra a sua regra. Registro duplicado falha no boot.
// Regra nunca recebe nem devolve endereco de e-mail: o endereco e resolvido na porta do diretorio.

import { policyFor, type Category, type MailClass } from './policy.js';

export type DiscardReason = 'lido' | 'obsoleto' | 'destinatario_invalido' | 'expirado';
export type Verdict = 'valido' | DiscardReason;

/** Visao minima de um item para a regra decidir validade. Sem endereco, sem texto. */
export interface ItemView {
  readonly id: string;
  readonly recipientUserId: string;
  readonly category: Category;
  readonly scopeKey: string;
  readonly emailType: string;
  readonly mailClass: MailClass;
  readonly occurredAt: string;
}

/** Evento de dominio lido do outbox (ops.outbox_event). Payload sem PII (contrato do H-005). */
export interface EventView {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Um aviso a gerar: um destinatario, uma categoria, um escopo, um tipo de e-mail. */
export interface RuleTarget {
  readonly recipientUserId: string;
  readonly category: Category;
  readonly emailType: string;
  readonly mailClass: MailClass;
  readonly scopeKey: string;
  readonly templateParams: Readonly<Record<string, unknown>>;
  /** Chave de deduplicacao da linha de envio (obrigatoria fora do digest). */
  readonly dedupeKey?: string;
}

export interface NotificationRule {
  /** Tipo do evento de dominio que esta regra resolve. Unico por registro. */
  readonly eventType: string;
  /** Tipos de e-mail que esta regra gera e valida. Unicos por registro. */
  readonly emailTypes: readonly string[];
  /** Lista vazia = o evento nao gera aviso (ex.: mensagem automatica de aceite). */
  resolve(event: EventView): Promise<readonly RuleTarget[]>;
  /** Validade lida do dominio no momento da decisao (flush e antes do envio). */
  isStillRelevant(item: ItemView, nowIso: string): Promise<Verdict>;
}

export type RuleRegistryCode = 'evento_duplicado' | 'tipo_duplicado' | 'regra_ausente';

export class RuleRegistryError extends Error {
  readonly code: RuleRegistryCode;
  constructor(code: RuleRegistryCode) {
    super(code);
    this.name = 'RuleRegistryError';
    this.code = code;
  }
}

export class NotificationRuleRegistry {
  private readonly byEvent = new Map<string, NotificationRule>();
  private readonly byEmailType = new Map<string, NotificationRule>();

  register(rule: NotificationRule): void {
    if (this.byEvent.has(rule.eventType)) throw new RuleRegistryError('evento_duplicado');
    for (const emailType of rule.emailTypes) {
      policyFor(emailType); // tipo fora da politica falha no boot
      if (this.byEmailType.has(emailType)) throw new RuleRegistryError('tipo_duplicado');
    }
    this.byEvent.set(rule.eventType, rule);
    for (const emailType of rule.emailTypes) this.byEmailType.set(emailType, rule);
  }

  forEvent(eventType: string): NotificationRule | undefined {
    return this.byEvent.get(eventType);
  }

  forEmailType(emailType: string): NotificationRule {
    const rule = this.byEmailType.get(emailType);
    if (!rule) throw new RuleRegistryError('regra_ausente');
    return rule;
  }
}
