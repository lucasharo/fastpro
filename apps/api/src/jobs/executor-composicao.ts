// Executor dos jobs do pipeline de avisos (outbox -> item -> e-mail) com as regras do ciclo central (Pacote D:
// aceite, mensagem nova, escolha e cancelamento). Ate aqui a API nao executava jobs: o banco enfileirava e ninguem
// processava. Roda pela rota do tick (origem 'a') e de forma oportunista depois das requisicoes (origem 'c').
// So reivindica os tres tipos do pipeline (um filtro por tipo); outros tipos de job ficam para os seus executores.
// No envio, so processa e-mails das categorias do ciclo; os demais (ex.: codigo de login) falham com retentativa e
// seguem para o caminho proprio, que ja envia logo depois da resposta.
import {
  JobRegistry,
  PgCycleSource,
  PgDsrTitularDirectory,
  PgJobStore,
  TickService,
  registerJobHandler,
  registerNotificationHandlers,
  type AcceptanceConnection,
  type JobContext,
  type JobHandler,
  type NotificationDeps,
  type TickOrigin,
  type TickReport,
} from '@fastpro/db';
import { NotificationRuleRegistry, registerCycleRules, type ClockPort, type EmailProviderPort } from '@fastpro/domain';
import { createCycleAwareRenderer, createEmailProvider, createFetchHttpTransport, createMinimalRenderer } from '@fastpro/email';

type Ambiente = Readonly<Record<string, string | undefined>>;

const TIPOS = ['outbox.dispatch', 'notification.flush', 'email.send'] as const;
const CATEGORIAS_DO_CICLO = new Set(['aceite', 'mensagem', 'selecao', 'cancelamento']);

const RELOGIO: ClockPort = {
  nowMs: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export interface ExecutorJobs {
  rodar(origem: TickOrigin): Promise<TickReport[]>;
}

export interface ExecutorOpcoes {
  readonly abrirConexaoDedicada?: (connectionString: string) => () => Promise<AcceptanceConnection>;
}

class ForaDoExecutorError extends Error {}

/** Envio so para e-mails do ciclo; o resto falha (com retentativa) para o executor proprio. */
class EnvioDoCiclo implements JobHandler {
  constructor(
    private readonly conexao: AcceptanceConnection,
    private readonly base: JobHandler,
  ) {}

  async run(job: JobContext): Promise<void> {
    const r = await this.conexao.query('select category, class from ops.email_outbox where id = $1::uuid', [job.payload_ref]);
    const linha = r.rows[0] as { category?: unknown; class?: unknown } | undefined;
    if (!linha || linha.class === 'auth' || !CATEGORIAS_DO_CICLO.has(String(linha.category))) throw new ForaDoExecutorError();
    await this.base.run(job);
  }
}

export function montarExecutorJobs(env: Ambiente, opcoes: ExecutorOpcoes = {}): ExecutorJobs | undefined {
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (url === '' || site === '' || opcoes.abrirConexaoDedicada === undefined) return undefined;
  let provider: EmailProviderPort;
  try {
    provider = createEmailProvider(env, {
      http: createFetchHttpTransport(),
      renderer: createCycleAwareRenderer(createMinimalRenderer(), site),
      clock: RELOGIO,
    });
  } catch {
    return undefined;
  }
  const abrir = opcoes.abrirConexaoDedicada(url);
  return {
    async rodar(origem: TickOrigin): Promise<TickReport[]> {
      const conexao = await abrir();
      try {
        const regras = new NotificationRuleRegistry();
        registerCycleRules(regras, new PgCycleSource(conexao));
        const deps: NotificationDeps = {
          client: conexao,
          registry: regras,
          provider,
          directory: new PgDsrTitularDirectory(conexao),
          clock: RELOGIO,
          useDbClock: true,
        };
        const base = new JobRegistry();
        registerNotificationHandlers(base, deps);
        const registro = new JobRegistry();
        for (const tipo of TIPOS) {
          const handler = base.get(tipo);
          if (handler === undefined) continue;
          registerJobHandler(registro, tipo, tipo === 'email.send' ? new EnvioDoCiclo(conexao, handler) : handler);
        }
        const store = new PgJobStore(conexao);
        const relatorios: TickReport[] = [];
        for (const tipo of TIPOS) {
          relatorios.push(await new TickService({ store, registry: registro, kindFilter: tipo }).run(origem));
        }
        return relatorios;
      } finally {
        conexao.release();
      }
    },
  };
}

/** Tick oportunista: no maximo uma execucao por minuto por instancia, uma por vez; nunca propaga erro. */
export function montarTickOportunista(executor: ExecutorJobs | undefined): ((path: string) => Promise<void>) | undefined {
  if (executor === undefined) return undefined;
  let rodando = false;
  let ultima = 0;
  return async (path: string) => {
    if (rodando || path === '/health' || path.startsWith('/internal/')) return;
    const agora = Date.now();
    if (agora - ultima < 60_000) return;
    rodando = true;
    ultima = agora;
    try {
      await executor.rodar('c');
    } catch {
      /* falha fechada: a proxima tentativa vem na proxima janela */
    } finally {
      rodando = false;
    }
  };
}
