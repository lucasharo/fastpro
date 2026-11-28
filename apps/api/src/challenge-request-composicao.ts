// H-097 (Issue 107) | Montagem do pedido de login (POST /v1/auth/challenges) e do envio pos-resposta.
// So monta com as variaveis existentes em .env.example (nomes, nunca valores, nos avisos). Sem elas, a
// rota continua inexistente (404) e a pendencia vai so com o NOME. Nao ha interruptor de e-mail.
import {
  createAuthAwareRenderer,
  createEmailProvider,
  createFetchHttpTransport,
  createMinimalRenderer,
  EmailConfigError,
} from '@fastpro/email';
import {
  NotificationRuleRegistry,
  RATE_LIMIT_DEFAULTS,
  type ClockPort,
  type EmailProviderPort,
  type RecipientDirectoryPort,
  type RecipientResolution,
} from '@fastpro/domain';
import {
  ChallengeEmailProvider,
  ChallengeRecipientDirectory,
  PgChallengeStore,
  dispatchChallengeOutbox,
  loadChallengeKey,
  type NotificationDeps,
  type SqlClient,
} from '@fastpro/db';
import { EMAIL_ENV_OBRIGATORIAS, type ComposicaoEnv } from './composicao.js';
import { criarDespachoPosResposta, type WaitUntil } from './challenge-dispatch.js';
import type { ChallengeRequestRouteOptions } from './challenge-request-route.js';

/** Variaveis do pedido de login (alem das do e-mail). Nomes de .env.example; nenhum valor e registrado. */
export const PEDIDO_LOGIN_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'AUTH_CHALLENGE_KEY',
  'PEPPER_EMAIL_HMAC',
  'PEPPER_CODE_HMAC',
  'PEPPER_IP_HMAC',
  'SITE_URL',
] as const;

export interface PedidoLoginOpcoes {
  /** Fabrica do cliente SQL do papel app_system (um cliente por URL). Sem ela, a rota nao liga. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly relogio?: ClockPort;
  /** Primitiva pos-resposta da plataforma. Ausente: o envio imediato nao acontece (contingencia do tick). */
  readonly waitUntil?: WaitUntil;
  /** Metrica de codigo fixo (ex.: metric do pacote da plataforma). Recebe so nome e rotulo com codigo fixo. */
  readonly metrica?: (nome: string, rotulos: Readonly<Record<string, string>>) => void;
}

export interface PedidoLoginMontado {
  readonly options: ChallengeRequestRouteOptions | undefined;
  readonly pendencias: readonly string[];
}

const RELOGIO_PADRAO: ClockPort = {
  nowMs: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** Diretorio base: qualquer destinatario que nao seja desafio fica sem endereco (nao ha outro envio aqui). */
const SEM_DESTINO: RecipientDirectoryPort = {
  resolve: async (): Promise<RecipientResolution> => ({ status: 'inexistente' }),
};

const clientes = new Map<string, SqlClient>();

function clienteDe(url: string, abrir: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrir(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

function preenchida(env: ComposicaoEnv, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

export function montarPedidoLogin(
  env: ComposicaoEnv,
  opcoes: PedidoLoginOpcoes = {},
): PedidoLoginMontado {
  const pendencias: string[] = [
    ...PEDIDO_LOGIN_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome)),
    ...EMAIL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome)),
  ];
  if (opcoes.abrirCliente === undefined) {
    pendencias.push('fabrica do cliente SQL do pedido de login (ainda nao montada na funcao)');
  }
  if (pendencias.length > 0) return { options: undefined, pendencias };

  const clock = opcoes.relogio ?? RELOGIO_PADRAO;
  let chave: Buffer;
  try {
    chave = loadChallengeKey(env);
  } catch {
    return { options: undefined, pendencias: ['AUTH_CHALLENGE_KEY (invalida)'] };
  }

  let email: EmailProviderPort;
  try {
    email = createEmailProvider(env, {
      http: createFetchHttpTransport(),
      renderer: createAuthAwareRenderer(createMinimalRenderer()),
      clock,
    });
  } catch (erro) {
    if (erro instanceof EmailConfigError) {
      return { options: undefined, pendencias: ['EMAIL (configuracao recusada pelo adaptador)'] };
    }
    throw erro;
  }

  const abrir = opcoes.abrirCliente as (connectionString: string) => SqlClient;
  const client = clienteDe(env.DATABASE_URL_APP_SYSTEM ?? '', abrir);
  const store = new PgChallengeStore(client);
  const provider = new ChallengeEmailProvider(email, store, {
    key: chave,
    siteUrl: env.SITE_URL ?? '',
    clock,
  });
  const directory = new ChallengeRecipientDirectory(SEM_DESTINO, store, chave, clock);
  const notificacao: NotificationDeps = {
    client,
    registry: new NotificationRuleRegistry(),
    provider,
    directory,
    clock,
    useDbClock: true,
  };
  const dispatch = criarDespachoPosResposta({
    enviar: (outboxId) => dispatchChallengeOutbox(notificacao, outboxId),
    ...(opcoes.waitUntil !== undefined ? { waitUntil: opcoes.waitUntil } : {}),
    onFalha: (codigo) => opcoes.metrica?.('envio_pos_resposta_falhou', { codigo }),
  });

  return {
    options: {
      deps: {
        store,
        secrets: {
          key: chave,
          pepperEmail: env.PEPPER_EMAIL_HMAC ?? '',
          pepperCode: env.PEPPER_CODE_HMAC ?? '',
        },
        clock,
        dispatch,
        rate: { pepperIp: env.PEPPER_IP_HMAC ?? '', limits: RATE_LIMIT_DEFAULTS },
      },
    },
    pendencias: [],
  };
}
