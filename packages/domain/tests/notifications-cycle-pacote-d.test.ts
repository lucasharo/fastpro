// Pacote D (H-095, H-096, H-098) | Regras do ciclo central, resumo por escopo e guarda do nome do servico.
// Sem banco, sem rede. Porta de leitura em memoria.
import { describe, it, expect } from 'vitest';
import {
  AceiteNotificationRule,
  CancelamentoNotificationRule,
  ContentGuardError,
  MensagemNotificationRule,
  NotificationRuleRegistry,
  SelecaoNotificationRule,
  assertSafeTemplateParams,
  escopoMensagem,
  registerCycleRules,
  requestIdDoEscopo,
  summaryFor,
  type CycleRequestView,
  type CycleSourcePort,
  type EventView,
  type ItemView,
} from '../src/index.js';

const PEDIDO = '6f1c2b7e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PRO_A = '22222222-2222-4222-8222-222222222222';
const PRO_B = '33333333-3333-4333-8333-333333333333';
const CONVERSA = '44444444-4444-4444-8444-444444444444';
const MSG = '55555555-5555-4555-8555-555555555555';

interface FonteOpcoes extends Partial<CycleRequestView> {
  readonly ativos?: string[];
}

function fonte(opcoes: FonteOpcoes = {}): CycleSourcePort {
  const { ativos = [PRO_A, PRO_B], ...resto } = opcoes;
  const view: CycleRequestView = {
    requestId: PEDIDO,
    customerUserId: CLIENTE,
    status: 'publicado',
    selectedProfessionalId: null,
    serviceName: 'Aulas práticas',
    ...resto,
  };
  return {
    requestView: async (id) => (id === PEDIDO ? view : null),
    activeProfessionals: async () => ativos,
    conversationView: async (id) =>
      id === CONVERSA ? { requestId: PEDIDO, customerUserId: CLIENTE, professionalId: PRO_A } : null,
  };
}

function evento(type: string, aggregateId: string, payload: Record<string, unknown> = {}): EventView {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    type,
    aggregateType: 'service_request',
    aggregateId,
    occurredAt: '2026-11-23T12:00:00.000Z',
    payload,
  };
}

function item(recipientUserId: string, scopeKey: string, emailType: string, mailClass: ItemView['mailClass'] = 'digest'): ItemView {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    recipientUserId,
    category: 'aceite',
    scopeKey,
    emailType,
    mailClass,
    occurredAt: '2026-11-23T12:00:00.000Z',
  };
}

describe('H-095 aceite', () => {
  it('avisa o cliente com o nome do servico e o link do pedido, sem dado do profissional', async () => {
    const regra = new AceiteNotificationRule(fonte());
    const alvos = await regra.resolve(evento('work_accepted', PEDIDO));
    expect(alvos).toHaveLength(1);
    expect(alvos[0]).toMatchObject({
      recipientUserId: CLIENTE,
      category: 'aceite',
      emailType: 'aceite_aviso',
      mailClass: 'digest',
      scopeKey: PEDIDO,
      templateParams: { request_ref: PEDIDO, servico: 'Aulas práticas' },
    });
  });

  it('nome do servico fora da guarda sai do aviso, sem falhar o evento', async () => {
    const regra = new AceiteNotificationRule(fonte({ serviceName: 'Aulas <b>x</b>@' }));
    const [alvo] = await regra.resolve(evento('work_accepted', PEDIDO));
    expect(alvo?.templateParams).toEqual({ request_ref: PEDIDO });
  });

  it('pedido cancelado ou inexistente nao gera aviso', async () => {
    expect(await new AceiteNotificationRule(fonte({ status: 'cancelado' })).resolve(evento('work_accepted', PEDIDO))).toEqual([]);
    expect(await new AceiteNotificationRule(fonte()).resolve(evento('work_accepted', CLIENTE))).toEqual([]);
  });

  it('item de outro destinatario ou de pedido cancelado e obsoleto', async () => {
    const regra = new AceiteNotificationRule(fonte());
    expect(await regra.isStillRelevant(item(CLIENTE, PEDIDO, 'aceite_aviso'), '2026-11-23T12:01:00.000Z')).toBe('valido');
    expect(await regra.isStillRelevant(item(PRO_A, PEDIDO, 'aceite_aviso'), '2026-11-23T12:01:00.000Z')).toBe('obsoleto');
    const cancelada = new AceiteNotificationRule(fonte({ status: 'cancelado' }));
    expect(await cancelada.isStillRelevant(item(CLIENTE, PEDIDO, 'aceite_aviso'), '2026-11-23T12:01:00.000Z')).toBe('obsoleto');
  });
});

describe('H-096 mensagem humana', () => {
  it('remetente cliente: o profissional recebe aviso de mensagem, com escopo do profissional', async () => {
    const regra = new MensagemNotificationRule(fonte());
    const alvos = await regra.resolve(evento('message_sent', MSG, { conversationId: CONVERSA, senderRole: 'cliente' }));
    expect(alvos).toEqual([
      {
        recipientUserId: PRO_A,
        category: 'mensagem',
        emailType: 'mensagem_profissional_aviso',
        mailClass: 'digest',
        scopeKey: `pro:${PEDIDO}`,
        templateParams: {},
      },
    ]);
  });

  it('remetente profissional: o cliente recebe aviso com a referencia do pedido', async () => {
    const regra = new MensagemNotificationRule(fonte());
    const [alvo] = await regra.resolve(evento('message_sent', MSG, { conversationId: CONVERSA, senderRole: 'profissional' }));
    expect(alvo).toMatchObject({
      recipientUserId: CLIENTE,
      emailType: 'mensagem_aviso',
      scopeKey: PEDIDO,
      templateParams: { request_ref: PEDIDO },
    });
  });

  it('papel desconhecido, conversa inexistente ou id invalido nao geram aviso', async () => {
    const regra = new MensagemNotificationRule(fonte());
    expect(await regra.resolve(evento('message_sent', MSG, { conversationId: CONVERSA, senderRole: 'sistema' }))).toEqual([]);
    expect(await regra.resolve(evento('message_sent', MSG, { conversationId: 'nao-uuid', senderRole: 'cliente' }))).toEqual([]);
    expect(await regra.resolve(evento('message_sent', MSG, { conversationId: MSG, senderRole: 'cliente' }))).toEqual([]);
  });

  it('item do profissional so vale enquanto ele tem aceite ativo; item do cliente so para o dono', async () => {
    const regra = new MensagemNotificationRule(fonte({ ativos: [PRO_A] }));
    expect(await regra.isStillRelevant(item(PRO_A, `pro:${PEDIDO}`, 'mensagem_profissional_aviso'))).toBe('valido');
    expect(await regra.isStillRelevant(item(PRO_B, `pro:${PEDIDO}`, 'mensagem_profissional_aviso'))).toBe('obsoleto');
    expect(await regra.isStillRelevant(item(CLIENTE, PEDIDO, 'mensagem_aviso'))).toBe('valido');
    expect(await regra.isStillRelevant(item(PRO_A, PEDIDO, 'mensagem_aviso'))).toBe('obsoleto');
  });
});

describe('H-098 selecao e cancelamento', () => {
  it('escolhido recebe selecao; os demais com aceite ativo recebem selecao_outro, sem identidade', async () => {
    const regra = new SelecaoNotificationRule(fonte({ selectedProfessionalId: PRO_A }));
    const alvos = await regra.resolve(evento('request_selected', PEDIDO, { requestId: PEDIDO }));
    expect(alvos).toEqual([
      expect.objectContaining({ recipientUserId: PRO_A, emailType: 'selecao', mailClass: 'critico', templateParams: { request_ref: PEDIDO } }),
      expect.objectContaining({ recipientUserId: PRO_B, emailType: 'selecao_outro', mailClass: 'critico', templateParams: { request_ref: PEDIDO } }),
    ]);
  });

  it('sem escolha no pedido nao ha aviso de selecao', async () => {
    expect(await new SelecaoNotificationRule(fonte()).resolve(evento('request_selected', PEDIDO, { requestId: PEDIDO }))).toEqual([]);
  });

  it('a validade acompanha a troca de escolha', async () => {
    const regra = new SelecaoNotificationRule(fonte({ selectedProfessionalId: PRO_B }));
    expect(await regra.isStillRelevant(item(PRO_B, PEDIDO, 'selecao', 'critico'))).toBe('valido');
    expect(await regra.isStillRelevant(item(PRO_A, PEDIDO, 'selecao', 'critico'))).toBe('obsoleto');
    expect(await regra.isStillRelevant(item(PRO_A, PEDIDO, 'selecao_outro', 'critico'))).toBe('valido');
    expect(await regra.isStillRelevant(item(PRO_B, PEDIDO, 'selecao_outro', 'critico'))).toBe('obsoleto');
  });

  it('cancelamento vai aos profissionais com aceite ativo e so vale com o pedido cancelado', async () => {
    const regra = new CancelamentoNotificationRule(fonte({ status: 'cancelado' }));
    const alvos = await regra.resolve(evento('request_cancelled', PEDIDO, { requestId: PEDIDO }));
    expect(alvos.map((a) => a.recipientUserId)).toEqual([PRO_A, PRO_B]);
    expect(alvos.every((a) => a.emailType === 'cancelamento' && a.mailClass === 'critico')).toBe(true);
    expect(await regra.isStillRelevant(item(PRO_A, PEDIDO, 'cancelamento', 'critico'))).toBe('valido');
    const ativa = new CancelamentoNotificationRule(fonte());
    expect(await ativa.isStillRelevant(item(PRO_A, PEDIDO, 'cancelamento', 'critico'))).toBe('obsoleto');
  });
});

describe('registro e resumo por escopo', () => {
  it('registra as quatro regras e resolve todos os tipos do ciclo', () => {
    const reg = new NotificationRuleRegistry();
    registerCycleRules(reg, fonte());
    for (const evt of ['work_accepted', 'message_sent', 'request_selected', 'request_cancelled']) {
      expect(reg.forEvent(evt)).toBeDefined();
    }
    for (const tipo of ['aceite_aviso', 'aceite_resumo', 'mensagem_aviso', 'mensagem_resumo', 'mensagem_profissional_aviso', 'mensagem_profissional_resumo', 'selecao', 'selecao_outro', 'cancelamento']) {
      expect(reg.forEmailType(tipo)).toBeDefined();
    }
  });

  it('resumo: aceite e mensagem do cliente levam o pedido; mensagem do profissional nao leva referencia', () => {
    expect(summaryFor('aceite', PEDIDO)).toEqual({ emailType: 'aceite_resumo', params: { request_ref: PEDIDO } });
    expect(summaryFor('mensagem', PEDIDO)).toEqual({ emailType: 'mensagem_resumo', params: { request_ref: PEDIDO } });
    expect(summaryFor('mensagem', escopoMensagem('profissional', PEDIDO))).toEqual({
      emailType: 'mensagem_profissional_resumo',
      params: {},
    });
    expect(requestIdDoEscopo(escopoMensagem('profissional', PEDIDO))).toBe(PEDIDO);
  });

  it('o resumo do profissional passa na guarda com so a contagem', () => {
    expect(() => assertSafeTemplateParams('mensagem_profissional_resumo', { count: 3 })).not.toThrow();
    expect(() => assertSafeTemplateParams('mensagem_profissional_aviso', {})).not.toThrow();
  });
});

describe('guarda do nome do servico', () => {
  it('aceita nome de catalogo simples e recusa contato, markup e tamanho fora do limite', () => {
    expect(() => assertSafeTemplateParams('aceite_aviso', { request_ref: PEDIDO, servico: 'Aulas práticas A/B' })).not.toThrow();
    expect(() => assertSafeTemplateParams('aceite_aviso', { request_ref: PEDIDO, servico: 'x@y.com' })).toThrow(ContentGuardError);
    expect(() => assertSafeTemplateParams('aceite_aviso', { request_ref: PEDIDO, servico: '<b>x</b>' })).toThrow(ContentGuardError);
    expect(() => assertSafeTemplateParams('aceite_aviso', { request_ref: PEDIDO, servico: 'a'.repeat(81) })).toThrow(ContentGuardError);
    expect(() => assertSafeTemplateParams('aceite_aviso', { request_ref: PEDIDO, servico: '' })).toThrow(ContentGuardError);
  });

  it('servico nao entra no resumo nem em tipos de outra categoria', () => {
    expect(() => assertSafeTemplateParams('aceite_resumo', { request_ref: PEDIDO, servico: 'Aulas' })).toThrow(ContentGuardError);
    expect(() => assertSafeTemplateParams('selecao', { request_ref: PEDIDO, servico: 'Aulas' })).toThrow(ContentGuardError);
  });
});
