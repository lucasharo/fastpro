// H-099 (Issue 109) | Modelos dos lembretes de prazo e de trial (docs/factory/163-DESENHO-H099.md §6).
// Quatro modelos: prazo_t24, prazo_t0 (cliente, pedido) e acesso_trial_t3d, acesso_trial_t0 (profissional, trial).
// Texto em portugues simples, sem link (o site e a conta ficam para o envio real), sem numero de aceites, sem valor.
// O corpo do trial traz, em destaque, a frase fixa da decisao 879 (unica ocorrencia de "renovacao" e de
// "100% gratuito"). Nenhum modelo recebe e-mail, endereco, nome ou descricao: so o identificador do pedido.
// Sem envio: este modulo so renderiza. O envio segue o pipeline existente (cota da classe lembrete).
import type { EmailRenderer, RenderedEmail } from './renderer.js';

export const REMINDER_PRAZO_T24_TEMPLATE = 'prazo_t24';
export const REMINDER_PRAZO_T0_TEMPLATE = 'prazo_t0';
export const REMINDER_TRIAL_T3D_TEMPLATE = 'acesso_trial_t3d';
export const REMINDER_TRIAL_T0_TEMPLATE = 'acesso_trial_t0';

/** Versao de cada modelo. Mudar o sentido do texto exige nova versao (padrao dos demais modelos). */
export const REMINDER_TEMPLATE_VERSIONS: Readonly<Record<string, number>> = {
  [REMINDER_PRAZO_T24_TEMPLATE]: 1,
  [REMINDER_PRAZO_T0_TEMPLATE]: 1,
  [REMINDER_TRIAL_T3D_TEMPLATE]: 1,
  [REMINDER_TRIAL_T0_TEMPLATE]: 1,
};

export const REMINDER_TEMPLATE_KEYS: readonly string[] = Object.keys(REMINDER_TEMPLATE_VERSIONS);

/** Frase fixa do trial T-3d (decisao 879, desenho 163 §6). Nao alterar sem decisao nova. */
export const TRIAL_GRATUIDADE_FRASE =
  'Seu teste de 14 dias é 100% gratuito e não possui renovação automática. Ao final do período, você decide se deseja contratar um plano para continuar recebendo novos pedidos.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erro sem valores: so o codigo fixo. Nunca carrega o identificador do pedido. */
export class ReminderRenderError extends Error {
  readonly code = 'parametros_invalidos';
  constructor() {
    super('parametros_invalidos');
    this.name = 'ReminderRenderError';
  }
}

const RODAPE = 'Ninguém do FastPro pede sua senha por e-mail.';

function pedidoRef(params: Readonly<Record<string, unknown>>): string {
  const ref = params['request_ref'];
  if (typeof ref !== 'string' || !UUID_RE.test(ref)) throw new ReminderRenderError();
  return ref;
}

function semParametros(params: Readonly<Record<string, unknown>>): void {
  if (Object.keys(params).length !== 0) throw new ReminderRenderError();
}

/** Renderiza um dos quatro modelos de lembrete. Chave desconhecida ou parametro fora do contrato: erro fixo. */
export function renderReminderEmail(
  templateKey: string,
  params: Readonly<Record<string, unknown>>,
): RenderedEmail {
  switch (templateKey) {
    case REMINDER_PRAZO_T24_TEMPLATE: {
      const ref = pedidoRef(params);
      return {
        subject: 'Faltam 24 horas para o prazo do seu pedido no FastPro',
        text: [
          'Faltam 24 horas para o prazo de recebimento de aceites do seu pedido.',
          '',
          'Se ainda quer encontrar um profissional, entre na sua conta no FastPro e abra o pedido para ver as informações.',
          '',
          `Pedido: ${ref}`,
          '',
          'Se você já escolheu um profissional, pode ignorar esta mensagem.',
          RODAPE,
        ].join('\n'),
      };
    }
    case REMINDER_PRAZO_T0_TEMPLATE: {
      const ref = pedidoRef(params);
      return {
        subject: 'O prazo do seu pedido no FastPro encerrou',
        text: [
          'O prazo para receber aceites do seu pedido encerrou.',
          '',
          'As conversas que já foram abertas continuam disponíveis na sua conta.',
          '',
          'Para continuar, entre na sua conta e escolha entre os profissionais interessados. Se ninguém se interessou, revise a descrição, a urgência e as fotos e publique o pedido de novo.',
          '',
          `Pedido: ${ref}`,
          RODAPE,
        ].join('\n'),
      };
    }
    case REMINDER_TRIAL_T3D_TEMPLATE: {
      semParametros(params);
      return {
        subject: 'Seu período de teste do FastPro termina em 3 dias',
        text: [
          'Seu período de teste do FastPro termina em 3 dias.',
          '',
          '========================================',
          TRIAL_GRATUIDADE_FRASE,
          '========================================',
          '',
          'Para ver as opções de plano, entre na sua conta no FastPro.',
          RODAPE,
        ].join('\n'),
      };
    }
    case REMINDER_TRIAL_T0_TEMPLATE: {
      semParametros(params);
      return {
        subject: 'Seu período de teste do FastPro terminou',
        text: [
          'Seu período de teste do FastPro terminou.',
          '',
          'A busca de novos pedidos foi pausada. Seu histórico e as conversas que já estavam abertas continuam disponíveis na sua conta.',
          '',
          'Para voltar a receber novos pedidos, escolha um plano na sua conta no FastPro. Nada foi cobrado.',
          RODAPE,
        ].join('\n'),
      };
    }
    default:
      throw new ReminderRenderError();
  }
}

/** Envolve o renderizador base: os quatro modelos de lembrete têm texto proprio; os demais seguem o base. */
export function createReminderAwareRenderer(base: EmailRenderer): EmailRenderer {
  return {
    render(templateKey, params) {
      if (templateKey in REMINDER_TEMPLATE_VERSIONS) return renderReminderEmail(templateKey, params);
      return base.render(templateKey, params);
    },
  };
}
