// H-093 | Variaveis de e-mail. So nomes aparecem aqui; valores nunca entram em codigo, erro ou log.
// Lista fechada de APP_ENV: valores de docs/factory/19-PLANO-TECNICO-DEV.md §7 (local, preview,
// staging, production) mais "test" para CI. Todos os ambientes usam o Resend (decisao do usuario,
// 2026-11-11: o Mailpit saiu do projeto).
export const APP_ENVS = ['local', 'test', 'preview', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];
export const EMAIL_PROVIDERS = ['resend'] as const;

export interface EmailEnv {
  readonly APP_ENV?: string | undefined;
  readonly EMAIL_PROVIDER?: string | undefined;
  readonly EMAIL_FROM?: string | undefined;
  readonly SMTP_HOST?: string | undefined;
  readonly SMTP_PORT?: string | undefined;
  readonly RESEND_API_KEY?: string | undefined;
  readonly RESEND_VERIFIED_DOMAIN?: string | undefined;
  /** E-mail da conta Resend do titular; unico destino aceito com o remetente de teste. */
  readonly RESEND_ACCOUNT_RECIPIENT?: string | undefined;
}

export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
