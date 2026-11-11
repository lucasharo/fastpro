// H-093 | Selecao do adaptador por ambiente (desenho 37 §1). Funcao pura: recebe o objeto de variaveis.
// Recusa a partida em qualquer valor fora da lista; nunca escolhe um provedor padrao.
// Decisao do usuario (2026-11-11): o Mailpit saiu do projeto; local, test, preview, staging e
// production usam o Resend (a trava de destinatario da conta vale em todos).
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import { EmailConfigError } from './errors.js';
import { APP_ENVS, EMAIL_PROVIDERS, isOneOf } from './env.js';
import type { EmailEnv } from './env.js';
import type { EmailRenderer } from './renderer.js';
import { ResendProvider } from './resend.js';
import type { HttpTransport, SmtpTransport } from './transports.js';

export interface EmailDeps {
  readonly smtp: SmtpTransport;
  readonly http: HttpTransport;
  readonly renderer: EmailRenderer;
  readonly clock: ClockPort;
}

export function createEmailProvider(env: EmailEnv, deps: EmailDeps): EmailProviderPort {
  const appEnv = (env.APP_ENV ?? '').trim();
  if (!isOneOf(APP_ENVS, appEnv)) throw new EmailConfigError('app_env_invalido');
  const provider = (env.EMAIL_PROVIDER ?? '').trim();
  if (!isOneOf(EMAIL_PROVIDERS, provider)) throw new EmailConfigError('email_provider_invalido');

  return new ResendProvider(env, { http: deps.http, renderer: deps.renderer, clock: deps.clock });
}
