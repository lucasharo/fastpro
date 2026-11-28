// H-016 | Montagem do cadastro, do login, da conta, da recuperacao e da troca de senha do profissional sobre o
// banco real (papel app_system), o Supabase Auth (chave secreta so no servidor) e o mesmo provedor de e-mail
// do login (Resend, via EmailProviderPort). So monta com as variaveis completas; sem elas, as rotas dao 404 e a
// lista de pendencias traz so os nomes (nunca os valores). Sem interruptor: envio liberado (decisao 55).
import { createHmac } from 'node:crypto';
import type { ClockPort, ProfessionalVerificationStatus } from '@fastpro/domain';
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createFetchHttpTransport,
  createMinimalRenderer,
  createProfessionalAwareRenderer,
  createProfessionalMailAdapter,
  EmailConfigError,
  providerSink,
  ProfessionalMailConfigError,
} from '@fastpro/email';
import type { HttpTransport } from '@fastpro/email';
import {
  PgProfessionalAccount,
  PgProfessionalAuth,
  PgProfessionalRecovery,
  PgProfessionalSendLimit,
  PgProfessionalPassword,
  SupabaseAuthGateway,
  type SqlClient,
} from '@fastpro/db';
import type { ProfessionalRouteOptions } from './professional-route.js';
import type { ProfessionalAccountRouteOptions } from './professional-account-route.js';
import type { ProfessionalRecoveryRouteOptions } from './professional-recovery-route.js';
import type { ProfessionalPasswordRouteOptions } from './professional-password-route.js';

/** Variaveis que precisam estar preenchidas (somente nomes aparecem nas pendencias). */
export const PROFISSIONAL_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'PEPPER_EMAIL_HMAC',
  'PEPPER_IP_HMAC',
  'SITE_URL',
] as const;

export interface ProfissionalMontado {
  readonly professional: ProfessionalRouteOptions | undefined;
  readonly professionalAccount: ProfessionalAccountRouteOptions | undefined;
  readonly professionalRecovery: ProfessionalRecoveryRouteOptions | undefined;
  readonly professionalPassword: ProfessionalPasswordRouteOptions | undefined;
  readonly pendencias: readonly string[];
}

export interface ProfissionalOpcoes {
  /** Cliente SQL do papel app_system para a connection string (um por URL, reaproveitado). */
  readonly abrirCliente: (connectionString: string) => SqlClient;
  readonly relogio?: { nowMs(): number };
  /** Transporte HTTP do provedor de e-mail; padrao: fetch do Node. Injetado nos testes. */
  readonly http?: HttpTransport;
}

const vazio = (pendencias: readonly string[]): ProfissionalMontado => ({
  professional: undefined,
  professionalAccount: undefined,
  professionalRecovery: undefined,
  professionalPassword: undefined,
  pendencias,
});

const preenchida = (env: Readonly<Record<string, string | undefined>>, nome: string): boolean =>
  (env[nome] ?? '').trim() !== '';

/** HMAC em hex com o pepper dado; a chave do limite nunca e o e-mail ou o IP em claro. */
const hmacHex = (pepper: string, texto: string): string => createHmac('sha256', pepper).update(texto).digest('hex');

export function montarProfissional(
  env: Readonly<Record<string, string | undefined>>,
  opcoes: ProfissionalOpcoes,
): ProfissionalMontado {
  const pendencias = PROFISSIONAL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome)) as string[];
  if (pendencias.length > 0) return vazio(pendencias);

  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const clock: ClockPort = {
    nowMs: () => relogio.nowMs(),
    sleep: (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)),
  };
  const renderer = createProfessionalAwareRenderer(createAuthAwareRenderer(createMinimalRenderer()));

  let provider: ReturnType<typeof createEmailProvider>;
  try {
    provider = createEmailProvider(env, {
      http: opcoes.http ?? createFetchHttpTransport(),
      renderer,
      clock,
    });
  } catch (erro) {
    if (erro instanceof EmailConfigError) return vazio(['EMAIL (configuracao recusada pelo adaptador)']);
    throw erro;
  }

  let mail: ReturnType<typeof createProfessionalMailAdapter>;
  try {
    mail = createProfessionalMailAdapter({ renderer, sink: providerSink(provider), baseUrl: env.SITE_URL ?? '' });
  } catch (erro) {
    if (erro instanceof ProfessionalMailConfigError) return vazio(['SITE_URL (origem recusada pelo adaptador de e-mail)']);
    throw erro;
  }

  const client = opcoes.abrirCliente(env.DATABASE_URL_APP_SYSTEM ?? '');
  const gateway = new SupabaseAuthGateway({
    url: env.SUPABASE_URL ?? '',
    secretKey: env.SUPABASE_SECRET_KEY ?? '',
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  });
  const pepperEmail = env.PEPPER_EMAIL_HMAC ?? '';
  const pepperIp = env.PEPPER_IP_HMAC ?? '';
  const limits = new PgProfessionalSendLimit({
    client,
    chave: (spec) => hmacHex(spec.rule === 'ip_hora' ? pepperIp : pepperEmail, `${spec.rule}|${spec.value}`),
  });

  const auth = new PgProfessionalAuth({ client, gateway, mail, pepperEmail });
  const recovery = new PgProfessionalRecovery({ client, gateway, mail, pepperEmail });
  const password = new PgProfessionalPassword({ client, gateway, mail });
  const account = new PgProfessionalAccount(client);

  return {
    professional: { port: auth, limits, clock },
    professionalAccount: {
      port: {
        // O banco so grava os estados do CHECK de professional_profile; o cast e so de tipo.
        me: async (secret, nowMs) => {
          const estado = await account.me(secret, nowMs);
          return estado === null
            ? null
            : { emailVerified: estado.emailVerified, status: estado.status as ProfessionalVerificationStatus };
        },
      },
      clock,
    },
    professionalRecovery: { port: recovery, limits, clock },
    professionalPassword: { port: password, clock },
    pendencias: [],
  };
}
