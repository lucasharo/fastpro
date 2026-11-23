// Pacote D (H-095, H-096, H-098) | Regras de notificacao do ciclo central (contrato em rules.ts; politica em policy.ts).
// Cada regra decide em resolve (evita item inutil) e em isStillRelevant (cobre mudanca entre ingestao e envio).
// Nunca recebe nem devolve endereco de e-mail, texto de mensagem ou nome de pessoa: so ids, papel e nome do servico.
import { SERVICO_RE, assertSafeTemplateParams } from './content-guard.js';
import {
  escopoMensagem,
  requestIdDoEscopo,
  type Category,
} from './policy.js';
import type {
  EventView,
  ItemView,
  NotificationRule,
  NotificationRuleRegistry,
  RuleTarget,
  Verdict,
} from './rules.js';

/** Eventos de dominio lidos do outbox por estas regras. Os nomes sao o contrato com as funcoes SQL. */
export const ACEITE_EVENT = 'work_accepted';
export const MENSAGEM_EVENT = 'message_sent';
export const SELECAO_EVENT = 'request_selected';
export const CANCELAMENTO_EVENT = 'request_cancelled';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Visao minima do pedido para as regras do ciclo. Sem e-mail, sem texto, sem documento. */
export interface CycleRequestView {
  readonly requestId: string;
  readonly customerUserId: string;
  readonly status: string;
  /** Profissional do aceite escolhido, ou null enquanto nao ha escolha. */
  readonly selectedProfessionalId: string | null;
  /** Nome do servico do catalogo (so para o aviso de aceite). */
  readonly serviceName: string | null;
}

export interface CycleConversationView {
  readonly requestId: string;
  readonly customerUserId: string;
  readonly professionalId: string;
}

/** Porta de leitura do ciclo (implementada em @fastpro/db sobre as funcoes SQL de leitura minima). */
export interface CycleSourcePort {
  requestView(requestId: string): Promise<CycleRequestView | null>;
  /** Profissionais com aceite ativo no pedido (ids, nunca nomes). */
  activeProfessionals(requestId: string): Promise<readonly string[]>;
  conversationView(conversationId: string): Promise<CycleConversationView | null>;
}

function payloadUuid(event: EventView, chave: string): string | null {
  const valor = event.payload[chave];
  return typeof valor === 'string' && UUID_RE.test(valor) ? valor : null;
}

/** H-095: aceite do profissional. Aviso imediato no primeiro; os demais viram resumo agrupado pelo cooldown. */
export class AceiteNotificationRule implements NotificationRule {
  readonly eventType = ACEITE_EVENT;
  readonly emailTypes: readonly string[] = ['aceite_aviso', 'aceite_resumo'];

  constructor(private readonly source: CycleSourcePort) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const view = await this.source.requestView(event.aggregateId);
    if (view === null || view.status === 'cancelado') return [];
    const params: Record<string, unknown> = { request_ref: view.requestId };
    // Nome do servico so entra se cabe na guarda; senao o aviso sai sem ele (nunca falha o evento).
    if (view.serviceName !== null && SERVICO_RE.test(view.serviceName)) {
      params['servico'] = view.serviceName;
    }
    assertSafeTemplateParams('aceite_aviso', params);
    return [
      {
        recipientUserId: view.customerUserId,
        category: 'aceite',
        emailType: 'aceite_aviso',
        mailClass: 'digest',
        scopeKey: view.requestId,
        templateParams: params,
      },
    ];
  }

  async isStillRelevant(item: ItemView): Promise<Verdict> {
    const view = await this.source.requestView(item.scopeKey);
    if (view === null || view.status === 'cancelado') return 'obsoleto';
    return view.customerUserId === item.recipientUserId ? 'valido' : 'obsoleto';
  }
}

/** H-096: mensagem humana. O outro participante recebe aviso (sem texto). Mensagem de sistema nao chega aqui. */
export class MensagemNotificationRule implements NotificationRule {
  readonly eventType = MENSAGEM_EVENT;
  readonly emailTypes: readonly string[] = [
    'mensagem_aviso',
    'mensagem_resumo',
    'mensagem_profissional_aviso',
    'mensagem_profissional_resumo',
  ];

  constructor(private readonly source: CycleSourcePort) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const conversaId = payloadUuid(event, 'conversationId');
    const papel = event.payload['senderRole'];
    if (conversaId === null || (papel !== 'cliente' && papel !== 'profissional')) return [];
    const view = await this.source.conversationView(conversaId);
    if (view === null) return [];

    if (papel === 'cliente') {
      // Remetente cliente: o destinatario e o profissional (link fixo para as conversas).
      return [
        {
          recipientUserId: view.professionalId,
          category: 'mensagem',
          emailType: 'mensagem_profissional_aviso',
          mailClass: 'digest',
          scopeKey: escopoMensagem('profissional', view.requestId),
          templateParams: {},
        },
      ];
    }
    // Remetente profissional: o destinatario e o cliente (link para o pedido).
    return [
      {
        recipientUserId: view.customerUserId,
        category: 'mensagem',
        emailType: 'mensagem_aviso',
        mailClass: 'digest',
        scopeKey: escopoMensagem('cliente', view.requestId),
        templateParams: { request_ref: view.requestId },
      },
    ];
  }

  async isStillRelevant(item: ItemView): Promise<Verdict> {
    const requestId = requestIdDoEscopo(item.scopeKey);
    if (!UUID_RE.test(requestId)) return 'obsoleto';
    const view = await this.source.requestView(requestId);
    if (view === null) return 'obsoleto';
    if (item.emailType === 'mensagem_aviso' || item.emailType === 'mensagem_resumo') {
      return view.customerUserId === item.recipientUserId ? 'valido' : 'obsoleto';
    }
    const ativos = await this.source.activeProfessionals(requestId);
    return ativos.includes(item.recipientUserId) ? 'valido' : 'obsoleto';
  }
}

/** H-098: escolha do cliente. O escolhido recebe 'selecao'; os demais com aceite ativo recebem 'selecao_outro'. */
export class SelecaoNotificationRule implements NotificationRule {
  readonly eventType = SELECAO_EVENT;
  readonly emailTypes: readonly string[] = ['selecao', 'selecao_outro'];

  constructor(private readonly source: CycleSourcePort) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const requestId = payloadUuid(event, 'requestId');
    if (requestId === null) return [];
    const view = await this.source.requestView(requestId);
    if (view === null || view.selectedProfessionalId === null) return [];
    const escolhido = view.selectedProfessionalId;
    const alvos: RuleTarget[] = [
      {
        recipientUserId: escolhido,
        category: 'selecao',
        emailType: 'selecao',
        mailClass: 'critico',
        scopeKey: requestId,
        templateParams: { request_ref: requestId },
      },
    ];
    for (const profissional of await this.source.activeProfessionals(requestId)) {
      if (profissional === escolhido) continue;
      alvos.push({
        recipientUserId: profissional,
        category: 'selecao',
        emailType: 'selecao_outro',
        mailClass: 'critico',
        scopeKey: requestId,
        templateParams: { request_ref: requestId },
      });
    }
    return alvos;
  }

  async isStillRelevant(item: ItemView): Promise<Verdict> {
    const view = await this.source.requestView(item.scopeKey);
    if (view === null || view.selectedProfessionalId === null) return 'obsoleto';
    const escolhido = view.selectedProfessionalId === item.recipientUserId;
    if (item.emailType === 'selecao') return escolhido ? 'valido' : 'obsoleto';
    return escolhido ? 'obsoleto' : 'valido';
  }
}

/** H-098: pedido cancelado. Os profissionais com aceite ativo recebem o aviso (sem identidade de ninguem). */
export class CancelamentoNotificationRule implements NotificationRule {
  readonly eventType = CANCELAMENTO_EVENT;
  readonly emailTypes: readonly string[] = ['cancelamento'];

  constructor(private readonly source: CycleSourcePort) {}

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    const requestId = payloadUuid(event, 'requestId');
    if (requestId === null) return [];
    const view = await this.source.requestView(requestId);
    if (view === null) return [];
    const category: Category = 'cancelamento';
    return (await this.source.activeProfessionals(requestId)).map((profissional) => ({
      recipientUserId: profissional,
      category,
      emailType: 'cancelamento',
      mailClass: 'critico' as const,
      scopeKey: requestId,
      templateParams: { request_ref: requestId },
    }));
  }

  async isStillRelevant(item: ItemView): Promise<Verdict> {
    const view = await this.source.requestView(item.scopeKey);
    return view !== null && view.status === 'cancelado' ? 'valido' : 'obsoleto';
  }
}

/** Registra as quatro regras do ciclo no registro do despachante. Tipo duplicado falha no boot (contrato do registro). */
export function registerCycleRules(registry: NotificationRuleRegistry, source: CycleSourcePort): void {
  registry.register(new AceiteNotificationRule(source));
  registry.register(new MensagemNotificationRule(source));
  registry.register(new SelecaoNotificationRule(source));
  registry.register(new CancelamentoNotificationRule(source));
}
