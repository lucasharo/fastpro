// H-092 | Guarda de conteudo do e-mail (docs/factory/35-DESENHO-H092.md, §6; CA-H092-14..16).
// Allowlist por email_type. Valores so: uuid (refs pseudonimas), inteiro (count) ou enum fixo.
// Mensagem de erro e so um codigo: nunca o valor rejeitado (pode conter dado pessoal).

import { policyFor } from './policy.js';

export type ContentGuardCode = 'chave_proibida' | 'chave_nao_permitida' | 'valor_invalido';

export class ContentGuardError extends Error {
  readonly code: ContentGuardCode;
  constructor(code: ContentGuardCode) {
    super(code);
    this.name = 'ContentGuardError';
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nomes que nunca podem aparecer em template_params, mesmo se alguem os puser na allowlist.
const FORBIDDEN_KEY =
  /mail|phone|telefone|celular|mensagem|message|body|corpo|url|link|token|nome|name|anexo|attach|endereco|address|cpf|senha|password|secret/i;
const COUNT_MAX = 1000;

/** Lanca ContentGuardError se o conjunto de parametros puder carregar conteudo sensivel. */
export function assertSafeTemplateParams(
  emailType: string,
  params: Readonly<Record<string, unknown>>,
): void {
  const policy = policyFor(emailType);
  for (const [key, value] of Object.entries(params)) {
    if (FORBIDDEN_KEY.test(key)) throw new ContentGuardError('chave_proibida');
    if (!policy.params.includes(key)) throw new ContentGuardError('chave_nao_permitida');
    if (key === 'count') {
      if (!(
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= COUNT_MAX
      )) {
        throw new ContentGuardError('valor_invalido');
      }
    } else if (key.endsWith('_ref')) {
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        throw new ContentGuardError('valor_invalido');
      }
    } else {
      throw new ContentGuardError('chave_nao_permitida');
    }
  }
}
