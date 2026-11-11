// H-093 | Selecao do adaptador por ambiente (desenho 37 §1). Funcao pura: recebe o objeto de variaveis.
// Recusa a partida em qualquer combinacao fora da tabela; nunca escolhe um provedor padrao.
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import { extractAddress } from './address.js';
import { EmailConfigError } from './errors.js';
import { APP_ENVS, DEV_APP_ENVS, EMAIL_PROVIDERS, isOneOf } from './env.js';
import type { EmailEnv } from './env.js';
import { MailpitProvider } from './mailpit.js';
import type { EmailRenderer } from './renderer.js';
import { ResendProvider } from './resend.js';
import type { HttpTransport, SmtpTransport } from './transports.js';

export interface EmailDeps {
  readonly smtp: SmtpTransport;
  readonly http: HttpTransport;
  readonly renderer: EmailRenderer;
  readonly clock: ClockPort;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);
const PORT_RE = /^\d{1,5}$/;

export function createEmailProvider(env: EmailEnv, deps: EmailDeps): EmailProviderPort {
  const appEnv = (env.APP_ENV ?? '').trim();
  if (!isOneOf(APP_ENVS, appEnv)) throw new EmailConfigError('app_env_invalido');
  const provider = (env.EMAIL_PROVIDER ?? '').trim();
  if (!isOneOf(EMAIL_PROVIDERS, provider)) throw new EmailConfigError('email_provider_invalido');

  const isDev = isOneOf(DEV_APP_ENVS, appEnv);
  if (provider === 'resend' && isDev) {
    throw new EmailConfigError('email_provider_incompativel_com_ambiente');
  }
  if (provider === 'mailpit' && !isDev) {
    throw new EmailConfigError('email_provider_incompativel_com_ambiente');
  }

  if (provider === 'resend') {
    return new ResendProvider(env, { http: deps.http, renderer: deps.renderer, clock: deps.clock });
  }

  const host = (env.SMTP_HOST ?? '').trim();
  if (!LOOPBACK_HOSTS.has(host)) throw new EmailConfigError('smtp_host_nao_local');
  const portText = (env.SMTP_PORT ?? '').trim();
  const port = PORT_RE.test(portText) ? Number(portText) : Number.NaN;
  if (!(port >= 1 && port <= 65535)) throw new EmailConfigError('smtp_porta_invalida');
  const fromHeader = (env.EMAIL_FROM ?? '').trim();
  const fromAddress = extractAddress(fromHeader);
  if (fromAddress === null) throw new EmailConfigError('email_from_invalido');

  return new MailpitProvider(
    { host, port, fromHeader, fromAddress },
    { smtp: deps.smtp, renderer: deps.renderer, clock: deps.clock },
  );
}
