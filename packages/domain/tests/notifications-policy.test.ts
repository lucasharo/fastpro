// H-092 | T-H92-01 (politica), T-H92-02 (cota), T-H92-03 (guarda de conteudo), T-H92-04 (prioridade),
// T-H92-05 (registro de regras). Sem banco, sem rede. Desenho: docs/factory/35-DESENHO-H092.md §10.
import { describe, it, expect } from 'vitest';
import {
  EMAIL_TYPE_POLICY,
  PolicyError,
  assertCombination,
  assertSafeTemplateParams,
  ContentGuardError,
  NotificationRuleRegistry,
  RuleRegistryError,
  classFor,
  comparePriority,
  decideQuota,
  alertLevelFor,
  policyFor,
  summaryTypeFor,
  windowSecondsFrom,
  PROVIDER_LIMITS,
  QUOTA_CUTS,
  type NotificationRule,
  type MailClass,
} from '../src/index.js';

const UUID = '6f1c2b7e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';

describe('T-H92-01 politica por categoria', () => {
  it('cada tipo da secao 2 mapeia para a classe certa', () => {
    expect(classFor('aceite_aviso')).toBe('digest');
    expect(classFor('aceite_resumo')).toBe('digest');
    expect(classFor('mensagem_aviso')).toBe('digest');
    expect(classFor('mensagem_resumo')).toBe('digest');
    expect(classFor('selecao')).toBe('critico');
    expect(classFor('cancelamento')).toBe('critico');
    expect(classFor('desistencia')).toBe('critico');
    expect(classFor('verificacao')).toBe('critico');
    expect(classFor('prazo_t24')).toBe('lembrete');
    expect(classFor('prazo_t0')).toBe('lembrete');
    expect(classFor('acesso_login')).toBe('auth');
    expect(classFor('acesso_conta')).toBe('auth');
    expect(classFor('acesso_trial')).toBe('lembrete');
    expect(classFor('acesso_ciclo')).toBe('lembrete');
  });

  it('tipo nao listado (categoria outro) e recusado', () => {
    expect(() => policyFor('outro')).toThrow(PolicyError);
    expect(() => classFor('outro')).toThrow(/tipo_nao_listado/);
    expect(() => policyFor('constructor')).toThrow(PolicyError);
  });

  it('combinacao de categoria e classe fora da politica e recusada', () => {
    expect(() => assertCombination('aceite', 'aceite_resumo', 'digest')).not.toThrow();
    expect(() => assertCombination('aceite', 'aceite_resumo', 'critico')).toThrow(
      /combinacao_invalida/,
    );
    expect(() => assertCombination('selecao', 'aceite_resumo', 'digest')).toThrow(
      /combinacao_invalida/,
    );
  });

  it('janela fora de 60 a 3600 s (ou ausente) cai no padrao de 900 s', () => {
    expect(windowSecondsFrom(900)).toBe(900);
    expect(windowSecondsFrom(60)).toBe(60);
    expect(windowSecondsFrom(3600)).toBe(3600);
    expect(windowSecondsFrom(59)).toBe(900);
    expect(windowSecondsFrom(3601)).toBe(900);
    expect(windowSecondsFrom(120.5)).toBe(900);
    expect(windowSecondsFrom('300')).toBe(900);
    expect(windowSecondsFrom(undefined)).toBe(900);
  });

  it('resumo de aceite e de mensagem tem tipo proprio', () => {
    expect(summaryTypeFor('aceite')).toBe('aceite_resumo');
    expect(summaryTypeFor('mensagem')).toBe('mensagem_resumo');
    expect(Object.keys(EMAIL_TYPE_POLICY)).toHaveLength(14);
  });
});

describe('T-H92-02 cota: cortes por classe, dia e mes', () => {
  it('o provedor tem 100 por dia e 3.000 por mes (S-11)', () => {
    expect(PROVIDER_LIMITS).toEqual({ dia: 100, mes: 3000 });
  });

  it('auth passa ate 99 no dia e critico para em 90 (CA-17, 20, 21)', () => {
    expect(decideQuota('auth', 99, 0)).toEqual({ allow: true, blockedBy: null });
    expect(decideQuota('auth', 100, 0)).toEqual({ allow: false, blockedBy: 'dia' });
    expect(decideQuota('critico', 89, 0).allow).toBe(true);
    expect(decideQuota('critico', 90, 0)).toEqual({ allow: false, blockedBy: 'dia' });
    expect(decideQuota('digest', 84, 0).allow).toBe(true);
    expect(decideQuota('digest', 85, 0).allow).toBe(false);
    expect(decideQuota('lembrete', 69, 0).allow).toBe(true);
    expect(decideQuota('lembrete', 70, 0).allow).toBe(false);
  });

  it('mes: auth passa ate 2.999; critico para em 2.700; digest em 2.550; lembrete em 2.100', () => {
    expect(decideQuota('auth', 0, 2999).allow).toBe(true);
    expect(decideQuota('auth', 0, 3000)).toEqual({ allow: false, blockedBy: 'mes' });
    expect(decideQuota('critico', 0, 2699).allow).toBe(true);
    expect(decideQuota('critico', 0, 2700)).toEqual({ allow: false, blockedBy: 'mes' });
    expect(decideQuota('digest', 0, 2549).allow).toBe(true);
    expect(decideQuota('digest', 0, 2550).allow).toBe(false);
    expect(decideQuota('lembrete', 0, 2099).allow).toBe(true);
    expect(decideQuota('lembrete', 0, 2100).allow).toBe(false);
  });

  it('bloqueio por mes com dia livre, e por dia com mes livre; mes prevalece quando ambos', () => {
    expect(decideQuota('critico', 5, 2700).blockedBy).toBe('mes');
    expect(decideQuota('critico', 90, 10).blockedBy).toBe('dia');
    expect(decideQuota('critico', 90, 2700).blockedBy).toBe('mes');
  });

  it('a tabela de cortes e a esperada pela 35 §7', () => {
    expect(QUOTA_CUTS).toEqual({
      auth: { dia: 100, mes: 3000 },
      critico: { dia: 90, mes: 2700 },
      digest: { dia: 85, mes: 2550 },
      lembrete: { dia: 70, mes: 2100 },
    });
  });

  it('degraus de alerta: 70 e 85 por cento, sem nivel 3 (H-094; 90/2.700 sao corte critico)', () => {
    expect(alertLevelFor(69, 100)).toBe(0);
    expect(alertLevelFor(70, 100)).toBe(1);
    expect(alertLevelFor(85, 100)).toBe(2);
    expect(alertLevelFor(90, 100)).toBe(2);
    expect(alertLevelFor(2699, 3000)).toBe(2);
    expect(alertLevelFor(2700, 3000)).toBe(2);
  });
});

describe('T-H92-03 guarda de conteudo', () => {
  it('aceita as allowlists com uuid e contagem', () => {
    expect(() =>
      assertSafeTemplateParams('aceite_resumo', { request_ref: UUID, count: 3 }),
    ).not.toThrow();
    expect(() =>
      assertSafeTemplateParams('mensagem_aviso', { conversation_ref: UUID }),
    ).not.toThrow();
    expect(() => assertSafeTemplateParams('verificacao', {})).not.toThrow();
    expect(() => assertSafeTemplateParams('selecao', { request_ref: UUID })).not.toThrow();
  });

  it('rejeita e-mail, telefone, mensagem, url, nome, token e chave desconhecida', () => {
    expect(() => assertSafeTemplateParams('selecao', { email: UUID })).toThrow(ContentGuardError);
    expect(() => assertSafeTemplateParams('selecao', { telefone: UUID })).toThrow(/chave_proibida/);
    expect(() => assertSafeTemplateParams('mensagem_aviso', { message: UUID })).toThrow(
      /chave_proibida/,
    );
    expect(() => assertSafeTemplateParams('selecao', { url: UUID })).toThrow(/chave_proibida/);
    expect(() => assertSafeTemplateParams('selecao', { nome_profissional: 'Ana' })).toThrow(
      /chave_proibida/,
    );
    expect(() => assertSafeTemplateParams('selecao', { token: UUID })).toThrow(/chave_proibida/);
    expect(() => assertSafeTemplateParams('selecao', { extra: UUID })).toThrow(
      /chave_nao_permitida/,
    );
  });

  it('selecao e cancelamento nao aceitam referencia ao profissional', () => {
    expect(() =>
      assertSafeTemplateParams('selecao', { request_ref: UUID, professional_ref: UUID }),
    ).toThrow(/chave_nao_permitida/);
    expect(() => assertSafeTemplateParams('cancelamento', { professional_ref: UUID })).toThrow(
      /chave_nao_permitida/,
    );
  });

  it('valor livre, e-mail como valor de ref ou contagem fora da faixa sao rejeitados', () => {
    expect(() => assertSafeTemplateParams('selecao', { request_ref: 'ana@exemplo.com' })).toThrow(
      /valor_invalido/,
    );
    expect(() =>
      assertSafeTemplateParams('aceite_resumo', { request_ref: UUID, count: 0 }),
    ).toThrow(/valor_invalido/);
    expect(() =>
      assertSafeTemplateParams('aceite_resumo', { request_ref: UUID, count: '3' }),
    ).toThrow(/valor_invalido/);
  });
});

describe('T-H92-04 prioridade', () => {
  const order = (a: MailClass, b: MailClass) =>
    comparePriority(
      { mailClass: a, createdAt: '2026-11-11T10:00:00Z' },
      { mailClass: b, createdAt: '2026-11-11T10:00:00Z' },
    );

  it('auth antes de critico, critico antes de digest, digest antes de lembrete', () => {
    expect(order('auth', 'critico')).toBeLessThan(0);
    expect(order('critico', 'digest')).toBeLessThan(0);
    expect(order('digest', 'lembrete')).toBeLessThan(0);
    expect(order('lembrete', 'auth')).toBeGreaterThan(0);
  });

  it('dentro da mesma classe, o mais antigo sai primeiro', () => {
    const antigo = { mailClass: 'digest' as const, createdAt: '2026-11-11T09:00:00Z' };
    const novo = { mailClass: 'digest' as const, createdAt: '2026-11-11T10:00:00Z' };
    expect(comparePriority(antigo, novo)).toBeLessThan(0);
    const lista = [novo, { mailClass: 'auth' as const, createdAt: '2026-11-11T11:00:00Z' }, antigo];
    lista.sort(comparePriority);
    expect(lista.map((x) => x.mailClass)).toEqual(['auth', 'digest', 'digest']);
    expect(lista[1]?.createdAt).toBe('2026-11-11T09:00:00Z');
  });
});

describe('T-H92-05 registro de regras', () => {
  const rule = (eventType: string, emailTypes: string[]): NotificationRule => ({
    eventType,
    emailTypes,
    resolve: async () => [],
    isStillRelevant: async () => 'valido',
  });

  it('um registro por evento; duplicidade falha no boot', () => {
    const reg = new NotificationRuleRegistry();
    reg.register(rule('aceite.criado', ['aceite_aviso', 'aceite_resumo']));
    expect(() => reg.register(rule('aceite.criado', ['selecao']))).toThrow(RuleRegistryError);
    expect(reg.forEvent('aceite.criado')).toBeDefined();
  });

  it('um tipo de e-mail nao pode ter duas regras; tipo fora da politica falha', () => {
    const reg = new NotificationRuleRegistry();
    reg.register(rule('aceite.criado', ['aceite_aviso']));
    expect(() => reg.register(rule('outro.evento', ['aceite_aviso']))).toThrow(/tipo_duplicado/);
    expect(() => reg.register(rule('x.evento', ['outro']))).toThrow(PolicyError);
    expect(() => reg.forEmailType('selecao')).toThrow(/regra_ausente/);
  });
});
