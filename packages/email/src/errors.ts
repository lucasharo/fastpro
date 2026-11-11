// H-093 | Erros de configuracao na partida. Codigo fixo; a mensagem nunca traz valor de variavel.
export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,59}$/;

export const CONFIG_ERROR_CODES = [
  'app_env_invalido',
  'email_provider_invalido',
  'email_provider_incompativel_com_ambiente',
  'smtp_host_nao_local',
  'smtp_porta_invalida',
  'email_from_invalido',
] as const;
export type EmailConfigErrorCode = (typeof CONFIG_ERROR_CODES)[number];

export class EmailConfigError extends Error {
  readonly code: EmailConfigErrorCode;

  constructor(code: EmailConfigErrorCode) {
    super(`configuracao_de_email_invalida: ${code}`);
    this.name = 'EmailConfigError';
    this.code = code;
  }
}
