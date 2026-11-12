// H-097 (Issue 107) | Ligacao do consumo do link (POST /v1/auth/challenges/consume) e da verificacao do codigo
// (POST /v1/auth/challenges/verify, PROPOSTA: o desenho ainda nao fixa o caminho) em vercel.ts.
// Variaveis existentes em .env.example, nunca registradas. Sem elas, a rota fica 404 e a pendencia leva
// so o NOME. O adaptador de Auth admin usa a API oficial do Supabase Auth com a chave secreta do servidor.
import {
  buildConsumeDeps,
  loadChallengeKey,
  PgChallengeStore,
  type AuthCreateResult,
  type AuthUserAdminPort,
  type ConsumeDeps,
  type SqlClient,
  type VerifyChallengeDeps,
} from '@fastpro/db';
import { RATE_LIMIT_DEFAULTS, type ClockPort } from '@fastpro/domain';
import type { ConsumeRouteOptions } from '../../consume-route.js';
import type { ChallengeVerifyRouteOptions } from '../../challenge-verify-route.js';

export const CONSUMO_LINK_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'AUTH_CHALLENGE_KEY',
  'PEPPER_IP_HMAC',
  'PEPPER_EMAIL_HMAC',
  'PEPPER_CODE_HMAC',
  'SITE_URL',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
] as const;

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface AuthAdminOpcoes {
  readonly baseUrl: string;
  readonly chaveSecreta: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Criacao de usuario do cliente no Supabase Auth (POST /auth/v1/admin/users). Duplicado vira ja_existe;
 * qualquer outra falha lanca erro com codigo fixo, sem corpo nem e-mail.
 */
export function criarAuthAdminSupabase(opcoes: AuthAdminOpcoes): AuthUserAdminPort {
  const base = opcoes.baseUrl.replace(/\/+$/, '');
  const chamada = opcoes.fetch ?? fetch;
  const limite = opcoes.timeoutMs ?? 10_000;
  return {
    async createUser(email: string): Promise<AuthCreateResult> {
      let res: Response;
      try {
        res = await chamada(`${base}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: opcoes.chaveSecreta,
            Authorization: `Bearer ${opcoes.chaveSecreta}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, email_confirm: true }),
          signal: AbortSignal.timeout(limite),
        });
      } catch {
        throw new Error('auth_admin_indisponivel');
      }
      if (res.status === 422 || res.status === 409) return { status: 'ja_existe' };
      if (res.status < 200 || res.status > 299) throw new Error('auth_admin_indisponivel');
      const corpo = (await res.json()) as { id?: unknown };
      if (typeof corpo.id !== 'string') throw new Error('auth_admin_resposta_invalida');
      return { status: 'criado', authUserId: corpo.id };
    },
  };
}

export interface ConsumoVerificacaoOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: ClockPort;
  readonly fetchAuth?: typeof fetch;
}

export interface ConsumoVerificacaoMontado {
  readonly consume: ConsumeRouteOptions | undefined;
  readonly verify: ChallengeVerifyRouteOptions | undefined;
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

export function montarConsumoEVerificacao(
  env: Ambiente,
  opcoes: ConsumoVerificacaoOpcoes = {},
): ConsumoVerificacaoMontado {
  const pendencias: string[] = CONSUMO_LINK_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (opcoes.abrirCliente === undefined) {
    pendencias.push('fabrica do cliente SQL do consumo (ainda nao montada na funcao)');
  }
  if (pendencias.length > 0) return { consume: undefined, verify: undefined, pendencias };

  let chave: Buffer;
  try {
    chave = loadChallengeKey(env);
  } catch {
    return { consume: undefined, verify: undefined, pendencias: ['AUTH_CHALLENGE_KEY (invalida)'] };
  }
  const abrir = opcoes.abrirCliente as (connectionString: string) => SqlClient;
  const url = env.DATABASE_URL_APP_SYSTEM ?? '';
  let client = clientes.get(url);
  if (client === undefined) {
    client = abrir(url);
    clientes.set(url, client);
  }
  const clock: ClockPort = opcoes.relogio ?? {
    nowMs: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  const authAdmin = criarAuthAdminSupabase({
    baseUrl: env.SUPABASE_URL ?? '',
    chaveSecreta: env.SUPABASE_SECRET_KEY ?? '',
    ...(opcoes.fetchAuth !== undefined ? { fetch: opcoes.fetchAuth } : {}),
  });
  const consumeDeps: ConsumeDeps = buildConsumeDeps({ client, authAdmin, clock, env: env as NodeJS.ProcessEnv });

  const store = new PgChallengeStore(client);
  const verifyDeps: VerifyChallengeDeps = {
    store,
    secrets: {
      key: chave,
      pepperEmail: env.PEPPER_EMAIL_HMAC ?? '',
      pepperCode: env.PEPPER_CODE_HMAC ?? '',
    },
    clock,
    rate: { pepperIp: env.PEPPER_IP_HMAC ?? '', limits: RATE_LIMIT_DEFAULTS },
  };

  return {
    consume: { deps: consumeDeps, siteUrl: env.SITE_URL ?? '' },
    verify: { deps: verifyDeps },
    pendencias: [],
  };
}
