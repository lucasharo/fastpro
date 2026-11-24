// H-016 | Modelos versionados do profissional (docs/factory/33-DESENHO-H016.md §10; 67-DESENHO-H016.md §6).
// Quatro modelos: professional_verificacao, professional_recuperacao, professional_ativacao (todos com link de
// uso unico e prazo) e senha_alterada (aviso sem link e sem codigo). Texto em portugues simples. Nenhum modelo
// traz nome, senha, token em outro lugar que nao o link, nem dado de terceiro. Sem envio: so renderiza.
// Texto final e envio real ficam para o lancamento (CA-H016-06: envio desligado).
import type { EmailRenderer, RenderedEmail } from './renderer.js';

export const PROFESSIONAL_VERIFY_TEMPLATE = 'professional_verificacao';
export const PROFESSIONAL_RECOVERY_TEMPLATE = 'professional_recuperacao';
export const PROFESSIONAL_ACTIVATE_TEMPLATE = 'professional_ativacao';
export const PASSWORD_CHANGED_TEMPLATE = 'senha_alterada';

/** Versao de cada modelo. Mudar o texto de forma que altere o sentido exige nova versao (33 §10). */
export const PROFESSIONAL_TEMPLATE_VERSIONS: Readonly<Record<string, number>> = {
  [PROFESSIONAL_VERIFY_TEMPLATE]: 1,
  [PROFESSIONAL_RECOVERY_TEMPLATE]: 1,
  [PROFESSIONAL_ACTIVATE_TEMPLATE]: 1,
  [PASSWORD_CHANGED_TEMPLATE]: 1,
};

export const PROFESSIONAL_TEMPLATE_KEYS: readonly string[] = Object.keys(PROFESSIONAL_TEMPLATE_VERSIONS);

const LINK_RE = /^https?:\/\/\S+$/;

/** Erro sem valores: so o codigo fixo. Nunca carrega o link. */
export class ProfessionalRenderError extends Error {
  readonly code = 'parametros_invalidos';
  constructor() {
    super('parametros_invalidos');
    this.name = 'ProfessionalRenderError';
  }
}

const ASSUNTO: Readonly<Record<string, string>> = {
  [PROFESSIONAL_VERIFY_TEMPLATE]: 'Confirme seu e-mail no FastPro',
  [PROFESSIONAL_RECOVERY_TEMPLATE]: 'Redefina sua senha do FastPro',
  [PROFESSIONAL_ACTIVATE_TEMPLATE]: 'Confirme para criar seu perfil de profissional no FastPro',
  [PASSWORD_CHANGED_TEMPLATE]: 'Sua senha do FastPro foi alterada',
};

const CORPO_LINK: Readonly<Record<string, string>> = {
  [PROFESSIONAL_RECOVERY_TEMPLATE]: 'Use o link abaixo para criar uma nova senha no FastPro.',
  [PROFESSIONAL_ACTIVATE_TEMPLATE]:
    'Use o link abaixo para confirmar e criar seu perfil de profissional no FastPro. Sua senha de cliente nao muda.',
};

/** Modelos com link: validam o link (https) e o prazo em minutos (1 a 60). */
export function renderProfessionalLinkEmail(
  templateKey: string,
  params: Readonly<Record<string, unknown>>,
): RenderedEmail {
  const { link, minutos } = params;
  if (
    !(templateKey in CORPO_LINK) ||
    typeof link !== 'string' ||
    !LINK_RE.test(link) ||
    typeof minutos !== 'number' ||
    !Number.isInteger(minutos) ||
    minutos < 1 ||
    minutos > 60
  ) {
    throw new ProfessionalRenderError();
  }
  return {
    subject: ASSUNTO[templateKey] ?? '',
    text: [
      CORPO_LINK[templateKey] ?? '',
      '',
      `Link (valido por ${minutos} minutos, uso unico):`,
      link,
      '',
      'Se voce nao pediu esta mensagem, ignore-a. Ninguem vai pedir sua senha por e-mail.',
    ].join('\n'),
  };
}

/** Aviso de senha alterada: sem link, sem codigo e sem parametros. */
export function renderPasswordChangedEmail(): RenderedEmail {
  return {
    subject: ASSUNTO[PASSWORD_CHANGED_TEMPLATE] ?? '',
    text: [
      'Sua senha do FastPro foi alterada agora.',
      '',
      'Se foi voce, nao precisa fazer nada.',
      'Se nao foi voce, entre em contato com o suporte do FastPro o quanto antes.',
    ].join('\n'),
  };
}

/**
 * Confirmacao do cadastro do profissional por codigo de 6 digitos (OTP; decisao do dono, 2026-11-23). Sem link.
 */
export function renderProfessionalVerifyCodeEmail(params: Readonly<Record<string, unknown>>): RenderedEmail {
  const { code, minutos } = params;
  if (
    typeof code !== 'string' ||
    !/^[0-9]{6}$/.test(code) ||
    typeof minutos !== 'number' ||
    !Number.isInteger(minutos) ||
    minutos < 1 ||
    minutos > 60
  ) {
    throw new ProfessionalRenderError();
  }
  return {
    subject: ASSUNTO[PROFESSIONAL_VERIFY_TEMPLATE] ?? '',
    text: [
      'Use o codigo abaixo para confirmar seu e-mail no FastPro.',
      '',
      `Codigo (valido por ${minutos} minutos, uso unico): ${code}`,
      '',
      'Se voce nao pediu esta mensagem, ignore-a. Ninguem vai pedir sua senha por e-mail.',
    ].join('\n'),
  };
}

/** Renderizador dos modelos do profissional; os demais templates seguem o renderizador base. */
export function createProfessionalAwareRenderer(base: EmailRenderer): EmailRenderer {
  return {
    render(templateKey, params) {
      if (templateKey === PASSWORD_CHANGED_TEMPLATE) return renderPasswordChangedEmail();
      if (templateKey === PROFESSIONAL_VERIFY_TEMPLATE) return renderProfessionalVerifyCodeEmail(params);
      if (templateKey in CORPO_LINK) return renderProfessionalLinkEmail(templateKey, params);
      return base.render(templateKey, params);
    },
  };
}
