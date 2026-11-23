// Pacote D (H-095, H-096, H-098) | Modelos dos avisos do ciclo central: aceite, mensagem, selecao e cancelamento.
// Texto em portugues simples, sem nome de profissional, sem texto de mensagem, sem e-mail e sem valor.
// O link usa a mesma base do restante do pacote (SITE_URL, a origem do site), passada por quem monta o renderizador.
// Sem envio: este modulo so renderiza. O envio segue o pipeline existente (cota da classe de cada aviso).
import { SERVICO_RE } from '@fastpro/domain';
import type { EmailRenderer, RenderedEmail } from './renderer.js';

export const CYCLE_ACEITE_AVISO = 'aceite_aviso';
export const CYCLE_ACEITE_RESUMO = 'aceite_resumo';
export const CYCLE_MENSAGEM_AVISO = 'mensagem_aviso';
export const CYCLE_MENSAGEM_RESUMO = 'mensagem_resumo';
export const CYCLE_MENSAGEM_PROFISSIONAL_AVISO = 'mensagem_profissional_aviso';
export const CYCLE_MENSAGEM_PROFISSIONAL_RESUMO = 'mensagem_profissional_resumo';
export const CYCLE_SELECAO = 'selecao';
export const CYCLE_SELECAO_OUTRO = 'selecao_outro';
export const CYCLE_CANCELAMENTO = 'cancelamento';

/** Versao de cada modelo. Mudar o sentido do texto exige nova versao (padrao dos demais modelos). */
export const CYCLE_TEMPLATE_VERSIONS: Readonly<Record<string, number>> = {
  [CYCLE_ACEITE_AVISO]: 1,
  [CYCLE_ACEITE_RESUMO]: 1,
  [CYCLE_MENSAGEM_AVISO]: 1,
  [CYCLE_MENSAGEM_RESUMO]: 1,
  [CYCLE_MENSAGEM_PROFISSIONAL_AVISO]: 1,
  [CYCLE_MENSAGEM_PROFISSIONAL_RESUMO]: 1,
  [CYCLE_SELECAO]: 1,
  [CYCLE_SELECAO_OUTRO]: 1,
  [CYCLE_CANCELAMENTO]: 1,
};

export const CYCLE_TEMPLATE_KEYS: readonly string[] = Object.keys(CYCLE_TEMPLATE_VERSIONS);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RODAPE = 'Ninguém do FastPro pede sua senha por e-mail.';

/** Erro sem valores: so o codigo fixo. Nunca carrega a base do site, o identificador ou o nome do servico. */
export class CycleRenderError extends Error {
  readonly code = 'parametros_invalidos';
  constructor() {
    super('parametros_invalidos');
    this.name = 'CycleRenderError';
  }
}

/** Origem do site (SITE_URL). Base invalida falha fechada: nenhum link sai com base incerta. */
function origemDoSite(siteUrl: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new CycleRenderError();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CycleRenderError();
  return url.origin;
}

function pedidoRef(params: Readonly<Record<string, unknown>>): string {
  const ref = params['request_ref'];
  if (typeof ref !== 'string' || !UUID_RE.test(ref)) throw new CycleRenderError();
  return ref;
}

function contagem(params: Readonly<Record<string, unknown>>): number {
  const n = params['count'];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1000) {
    throw new CycleRenderError();
  }
  return n;
}

function semParametros(params: Readonly<Record<string, unknown>>): void {
  if (Object.keys(params).length !== 0) throw new CycleRenderError();
}

/** Renderiza um dos modelos do ciclo. Chave desconhecida ou parametro fora do contrato: erro fixo. */
export function renderCycleEmail(
  templateKey: string,
  params: Readonly<Record<string, unknown>>,
  siteUrl: string,
): RenderedEmail {
  const origem = origemDoSite(siteUrl);
  const conversas = `${origem}/profissional/conversas`;

  switch (templateKey) {
    case CYCLE_ACEITE_AVISO: {
      const ref = pedidoRef(params);
      const servico = params['servico'];
      if (servico !== undefined && (typeof servico !== 'string' || !SERVICO_RE.test(servico))) {
        throw new CycleRenderError();
      }
      const frase =
        typeof servico === 'string'
          ? `Um profissional aceitou o seu pedido de ${servico} no FastPro.`
          : 'Um profissional aceitou o seu pedido no FastPro.';
      return {
        subject: 'Um profissional aceitou seu pedido',
        text: [
          frase,
          '',
          'Entre na sua conta para ver os profissionais interessados e escolher quem vai atender você.',
          '',
          `Ver o pedido: ${origem}/painel/pedido/${ref}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_ACEITE_RESUMO: {
      const ref = pedidoRef(params);
      const n = contagem(params);
      return {
        subject: 'Novos profissionais aceitaram seu pedido',
        text: [
          `Novos profissionais aceitaram o seu pedido no FastPro: ${n}.`,
          '',
          'Entre na sua conta para ver os profissionais interessados e escolher quem vai atender você.',
          '',
          `Ver o pedido: ${origem}/painel/pedido/${ref}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_MENSAGEM_AVISO: {
      const ref = pedidoRef(params);
      return {
        subject: 'Você tem uma nova mensagem',
        text: [
          'Você tem uma nova mensagem no FastPro.',
          '',
          'Entre na sua conta para ler e responder.',
          '',
          `Ver o pedido: ${origem}/painel/pedido/${ref}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_MENSAGEM_RESUMO: {
      const ref = pedidoRef(params);
      const n = contagem(params);
      return {
        subject: 'Você tem novas mensagens',
        text: [
          `Você tem ${n} novas mensagens no FastPro.`,
          '',
          'Entre na sua conta para ler e responder.',
          '',
          `Ver o pedido: ${origem}/painel/pedido/${ref}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_MENSAGEM_PROFISSIONAL_AVISO: {
      semParametros(params);
      return {
        subject: 'Você tem uma nova mensagem',
        text: [
          'Você tem uma nova mensagem no FastPro.',
          '',
          'Entre na sua conta para ler e responder.',
          '',
          `Suas conversas: ${conversas}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_MENSAGEM_PROFISSIONAL_RESUMO: {
      const n = contagem(params);
      if (Object.keys(params).length !== 1) throw new CycleRenderError();
      return {
        subject: 'Você tem novas mensagens',
        text: [
          `Você tem ${n} novas mensagens no FastPro.`,
          '',
          'Entre na sua conta para ler e responder.',
          '',
          `Suas conversas: ${conversas}`,
          '',
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_SELECAO: {
      const ref = pedidoRef(params);
      return {
        subject: 'Você foi escolhido',
        text: [
          'O cliente escolheu você para atender um pedido no FastPro.',
          '',
          'Entre na sua conta para ver a conversa com o cliente.',
          '',
          `Suas conversas: ${conversas}`,
          `Pedido: ${ref}`,
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_SELECAO_OUTRO: {
      const ref = pedidoRef(params);
      return {
        subject: 'O cliente escolheu outro profissional',
        text: [
          'O cliente escolheu outro profissional para um pedido em que você havia aceitado atender.',
          '',
          `Suas conversas: ${conversas}`,
          `Pedido: ${ref}`,
          RODAPE,
        ].join('\n'),
      };
    }
    case CYCLE_CANCELAMENTO: {
      const ref = pedidoRef(params);
      return {
        subject: 'O pedido foi cancelado',
        text: [
          'Um pedido em que você havia aceitado atender foi cancelado no FastPro.',
          '',
          `Suas conversas: ${conversas}`,
          `Pedido: ${ref}`,
          RODAPE,
        ].join('\n'),
      };
    }
    default:
      throw new CycleRenderError();
  }
}

/** Envolve o renderizador base: os modelos do ciclo tem texto proprio; os demais seguem o base. */
export function createCycleAwareRenderer(base: EmailRenderer, siteUrl: string): EmailRenderer {
  origemDoSite(siteUrl); // base invalida falha na montagem, nunca no envio
  return {
    render(templateKey, params) {
      if (templateKey in CYCLE_TEMPLATE_VERSIONS) return renderCycleEmail(templateKey, params, siteUrl);
      return base.render(templateKey, params);
    },
  };
}
