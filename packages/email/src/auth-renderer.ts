// H-011 | Renderizador do e-mail de acesso (docs/factory/39-DESENHO-H011.md, §5; CA-H011-14).
// Para acesso_login o corpo traz SOMENTE: link de uso unico, codigo de 6 digitos, prazo e a
// orientacao de ignorar. Nenhum nome, endereco, estado de cadastro ou dado de terceiro.
// Outros modelos seguem o renderizador base. Texto final: H-094/H-097.
import type { EmailRenderer, RenderedEmail } from './renderer.js';

export const ACCESS_TEMPLATE = 'acesso_login';
export const ACCESS_SUBJECT = 'Seu acesso ao FastPro';

const LINK_RE = /^https?:\/\/\S+$/;
const CODE_RE = /^[0-9]{6}$/;

/** Erro sem valores: so o codigo fixo. Nunca carrega o link ou o codigo. */
export class AuthRenderError extends Error {
  readonly code = 'parametros_invalidos';
  constructor() {
    super('parametros_invalidos');
    this.name = 'AuthRenderError';
  }
}

export function renderAccessEmail(params: Readonly<Record<string, unknown>>): RenderedEmail {
  const { link, code, minutos } = params;
  if (
    typeof link !== 'string' ||
    !LINK_RE.test(link) ||
    typeof code !== 'string' ||
    !CODE_RE.test(code) ||
    typeof minutos !== 'number' ||
    !Number.isInteger(minutos) ||
    minutos < 1 ||
    minutos > 60
  ) {
    throw new AuthRenderError();
  }
  return {
    subject: ACCESS_SUBJECT,
    text: [
      'Use o link ou o codigo abaixo para entrar no FastPro.',
      '',
      `Link (valido por ${minutos} minutos, uso unico):`,
      link,
      '',
      `Codigo (valido por ${minutos} minutos, uso unico): ${code}`,
      '',
      'Se voce nao pediu este acesso, ignore esta mensagem.',
    ].join('\n'),
  };
}

/** Envolve o renderizador base: acesso_login usa o texto do desafio; os demais seguem o base. */
export function createAuthAwareRenderer(base: EmailRenderer): EmailRenderer {
  return {
    render(templateKey, params) {
      if (templateKey !== ACCESS_TEMPLATE) return base.render(templateKey, params);
      return renderAccessEmail(params);
    },
  };
}
