// H-099 (Issue 109) | Modelos dos lembretes (docs/factory/163-DESENHO-H099.md §6, §9: T-H099-31 e T-H099-32).
// Sem rede, sem envio, sem Resend, sem cota real. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createMinimalRenderer,
  createReminderAwareRenderer,
  renderReminderEmail,
  REMINDER_PRAZO_T0_TEMPLATE,
  REMINDER_PRAZO_T24_TEMPLATE,
  REMINDER_TEMPLATE_KEYS,
  REMINDER_TEMPLATE_VERSIONS,
  REMINDER_TRIAL_T0_TEMPLATE,
  REMINDER_TRIAL_T3D_TEMPLATE,
  ReminderRenderError,
  TRIAL_GRATUIDADE_FRASE,
} from '../src/index.js';

const PEDIDO = '0f6c2a1e-9b3d-4e5f-8a7b-1c2d3e4f5a6b';
const PARAMS_PEDIDO = { request_ref: PEDIDO };
const TRIAL_KEYS = [REMINDER_TRIAL_T3D_TEMPLATE, REMINDER_TRIAL_T0_TEMPLATE];
const PRAZO_KEYS = [REMINDER_PRAZO_T24_TEMPLATE, REMINDER_PRAZO_T0_TEMPLATE];

const renderer = createReminderAwareRenderer(createMinimalRenderer());

function paramsDe(templateKey: string): Record<string, unknown> {
  return PRAZO_KEYS.includes(templateKey) ? PARAMS_PEDIDO : {};
}

describe('modelos de prazo do pedido (cliente)', () => {
  it('prazo_t24 avisa que faltam 24 horas e traz so o identificador do pedido', () => {
    const out = renderer.render(REMINDER_PRAZO_T24_TEMPLATE, PARAMS_PEDIDO);
    expect(out.subject).toBe('Faltam 24 horas para o prazo do seu pedido no FastPro');
    expect(out.text).toContain('Faltam 24 horas para o prazo de recebimento de aceites do seu pedido.');
    expect(out.text).toContain(`Pedido: ${PEDIDO}`);
  });

  it('prazo_t0 avisa que o prazo encerrou e que as conversas abertas continuam', () => {
    const out = renderer.render(REMINDER_PRAZO_T0_TEMPLATE, PARAMS_PEDIDO);
    expect(out.subject).toBe('O prazo do seu pedido no FastPro encerrou');
    expect(out.text).toContain('O prazo para receber aceites do seu pedido encerrou.');
    expect(out.text).toContain('As conversas que já foram abertas continuam disponíveis na sua conta.');
    expect(out.text).toContain(`Pedido: ${PEDIDO}`);
  });

  it('recusa request_ref ausente ou fora do formato de identificador', () => {
    for (const params of [{}, { request_ref: 'nao-e-uuid' }, { request_ref: 42 }]) {
      expect(() => renderer.render(REMINDER_PRAZO_T24_TEMPLATE, params)).toThrow(ReminderRenderError);
      expect(() => renderer.render(REMINDER_PRAZO_T0_TEMPLATE, params)).toThrow(ReminderRenderError);
    }
  });

  it('o erro nao carrega o valor recebido', () => {
    try {
      renderer.render(REMINDER_PRAZO_T0_TEMPLATE, { request_ref: 'VALOR-SEGREDO-XYZ' });
      expect.fail('deveria recusar');
    } catch (err) {
      expect(err).toBeInstanceOf(ReminderRenderError);
      expect(String((err as Error).message)).not.toContain('VALOR-SEGREDO-XYZ');
      expect((err as ReminderRenderError).code).toBe('parametros_invalidos');
    }
  });
});

describe('modelos de trial (profissional)', () => {
  it('trial T-3d traz a frase fixa da decisao 879 em destaque, uma vez', () => {
    const out = renderer.render(REMINDER_TRIAL_T3D_TEMPLATE, {});
    expect(out.subject).toBe('Seu período de teste do FastPro termina em 3 dias');
    expect(out.text).toContain(TRIAL_GRATUIDADE_FRASE);
    expect(out.text.split(TRIAL_GRATUIDADE_FRASE).length - 1).toBe(1);
  });

  it('trial T0 diz que o teste terminou, que a busca foi pausada e que nada foi cobrado', () => {
    const out = renderer.render(REMINDER_TRIAL_T0_TEMPLATE, {});
    expect(out.subject).toBe('Seu período de teste do FastPro terminou');
    expect(out.text).toContain('A busca de novos pedidos foi pausada.');
    expect(out.text).toContain('Nada foi cobrado.');
  });

  it('modelos de trial recusam qualquer parametro (sem identificador de pedido nem dado de terceiro)', () => {
    for (const key of TRIAL_KEYS) {
      expect(() => renderer.render(key, { request_ref: PEDIDO })).toThrow(ReminderRenderError);
      expect(() => renderer.render(key, { email: 'x@example.test' })).toThrow(ReminderRenderError);
    }
  });
});

describe('T-H099-32: conteudo dos textos', () => {
  it('nenhum texto de lembrete traz e-mail, link, valor em moeda nem numero de aceites', () => {
    for (const key of REMINDER_TEMPLATE_KEYS) {
      const texto = renderer.render(key, paramsDe(key)).text.replace(PEDIDO, '');
      expect(texto).not.toMatch(/@|https?:\/\//);
      expect(texto).not.toMatch(/R\$|\d+,\d{2}/);
      expect(texto).not.toMatch(/\d+\s+(aceites?|profissionais?|interessados?|conversas?|propostas?)\b/i);
    }
  });

  it('cobranca, cartao, debito e renovacao so aparecem na frase fixa do trial', () => {
    for (const key of TRIAL_KEYS) {
      const texto = renderer.render(key, {}).text.split(TRIAL_GRATUIDADE_FRASE).join('');
      expect(texto).not.toMatch(/cobran[çc]a|cart[ãa]o|d[ée]bito|renova[çc][ãa]o|100% gratuit/i);
    }
  });

  it('a frase fixa do trial diz que o teste e gratuito e sem renovacao automatica', () => {
    expect(TRIAL_GRATUIDADE_FRASE).toBe(
      'Seu teste de 14 dias é 100% gratuito e não possui renovação automática. Ao final do período, você decide se deseja contratar um plano para continuar recebendo novos pedidos.',
    );
  });

  it('prazo nao promete aceites nem garante resultado', () => {
    for (const key of PRAZO_KEYS) {
      const out = renderer.render(key, PARAMS_PEDIDO);
      expect(out.text).not.toMatch(/garant|assegur|vai receber|voc[êe] vai ganhar/i);
    }
  });
});

describe('registro e versoes', () => {
  it('os quatro modelos de lembrete tem versao inteira positiva e chave unica', () => {
    expect([...REMINDER_TEMPLATE_KEYS].sort()).toEqual(
      [...PRAZO_KEYS, ...TRIAL_KEYS].sort(),
    );
    for (const key of REMINDER_TEMPLATE_KEYS) {
      expect(Number.isInteger(REMINDER_TEMPLATE_VERSIONS[key])).toBe(true);
      expect(REMINDER_TEMPLATE_VERSIONS[key]).toBeGreaterThan(0);
    }
  });

  it('chave desconhecida no renderizador de lembrete recusa com erro fixo', () => {
    expect(() => renderReminderEmail('acesso_ciclo_t3d_cartao', {})).toThrow(ReminderRenderError);
  });

  it('modelos de outras frentes seguem o renderizador base', () => {
    const base = createMinimalRenderer();
    expect(renderer.render('acesso_login', {})).toEqual(base.render('acesso_login', {}));
  });
});

describe('T-H099-31: varredura estatica sem interruptor', () => {
  const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
  const ARQUIVOS_H099 = [
    'packages/domain/src/notifications/reminders.ts',
    'packages/domain/src/notifications/reminder-rules.ts',
    'packages/db/src/reminders.ts',
    'packages/email/src/reminder-renderer.ts',
    'supabase/migrations/20261120200000_notifications_create_reminder_scheduling.sql',
    'supabase/migrations/20261120200100_notifications_reminder_emit_mark_instant.sql',
    'supabase/rollbacks/20261120200000_notifications_create_reminder_scheduling.down.sql',
    'supabase/rollbacks/20261120200100_notifications_reminder_emit_mark_instant.down.sql',
  ];
  // Proibido: configuracao lida em tempo de execucao (app_config, variavel de ambiente, flag) ligada a lembrete.
  const PROIBIDOS: readonly RegExp[] = [
    /app_config/i,
    /process\.env|import\.meta\.env/,
    /\b(REMINDER|LEMBRETE)_[A-Z0-9_]*(ENABLED|ATIV|DESATIV|HABILIT|FLAG|KILL|TOGGLE)\b/,
    /feature.?flag|kill.?switch/i,
    /(lembrete|reminder)[a-z_]*(desativ|habilit|enabled|flag|interrupt)/i,
  ];

  it('nenhum arquivo do lembrete le chave, variavel de ambiente ou flag para ligar/desligar', () => {
    const achados: string[] = [];
    for (const relativo of ARQUIVOS_H099) {
      const conteudo = readFileSync(`${RAIZ}${relativo}`, 'utf8');
      conteudo.split(/\r?\n/).forEach((linha, i) => {
        // Comentario que declara a ausencia do interruptor nao conta; so codigo e configuracao.
        if (/^\s*(\/\/|--)/.test(linha)) return;
        if (PROIBIDOS.some((re) => re.test(linha))) achados.push(`${relativo}:${i + 1}`);
      });
    }
    expect(achados).toEqual([]);
  });
});
