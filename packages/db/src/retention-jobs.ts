// H-109 (Issue 118) | Job retention.purge ligado ao tick (docs/factory/82-DESENHO-H109.md §2 e §4).
// Registro no JobRegistry (padrao de registerChallengeHandlers). Sem politica habilitada o handler nao toca em
// nada (CA-H109-01). Modo dry_run: so simula. Nenhum agendamento pg_cron e criado aqui: o disparo diario fica
// para a etapa de operacao, depois da aprovacao. Storage e banco entram por injecao; nenhum segredo e lido aqui.
import {
  caminhoDeObjetoValido,
  isRetentionBucket,
  runRetentionPurge,
  type OpcoesExpurgo,
  type RetentionClass,
  type RetentionObjectRef,
  type RetentionObjectsPort,
  type RetentionStoragePort,
  type RetentionStorePort,
} from '@fastpro/domain';
import { registerJobHandler, type JobHandler, type JobRegistry } from './jobs-tick.js';

export const RETENTION_PURGE_KIND = 'retention.purge';

/** Chave de dedupe do dia (um job por dia, idempotente), como em auth.challenge.purge. */
export function retentionPurgeDedupeKey(nowMs: number): string {
  return `${RETENTION_PURGE_KIND}:${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/** Classes com adaptador SQL (private.retention_finalize_rc01/rc02). As demais recebem sem_alvo. */
export const RETENTION_CLASSES_COM_ADAPTADOR: ReadonlySet<RetentionClass> = new Set<RetentionClass>(['RC-01', 'RC-02']);

/**
 * Fonte de objetos de RC-01 e RC-02. O esquema atual nao guarda caminho de objeto para essas classes:
 * o documento do profissional fica cifrado em professional_profile.document_enc (H-035), e nenhum codigo
 * grava em identity-docs. Por isso a lista vem vazia; quando a historia dona do bucket gravar objetos,
 * esta fonte passa a ler o caminho (sem mudar o expurgo). Outras classes nao tem fonte.
 */
export class ObjetosRetencaoSql implements RetentionObjectsPort {
  async objetosDe(
    classe: RetentionClass,
    sujeitos: readonly string[],
  ): Promise<readonly { sujeitoId: string; objeto: RetentionObjectRef }[]> {
    if (!RETENTION_CLASSES_COM_ADAPTADOR.has(classe) || sujeitos.length === 0) return [];
    return [];
  }
}

export interface SupabaseStorageOpcoes {
  /** URL base do projeto (sem barra final). Vem do ambiente, nunca de codigo. */
  readonly baseUrl: string;
  /** Chave de servico do Storage. Vem do ambiente do job; nunca e registrada. */
  readonly serviceKey: string;
  readonly fetchImpl?: typeof fetch;
}

/** Falha do Storage com codigo fixo: sem URL, chave ou caminho na mensagem. */
export class RetentionStorageError extends Error {
  readonly code: 'objeto_recusado' | 'storage_falha';
  constructor(code: 'objeto_recusado' | 'storage_falha') {
    super(code);
    this.name = 'RetentionStorageError';
    this.code = code;
  }
}

/**
 * Remove objeto pela API do Storage (DELETE). 404 = ja ausente = sucesso (CA-H109-09). Bucket fora da
 * lista conhecida ou caminho invalido e recusado antes de qualquer chamada de rede.
 */
export class SupabaseStorageRetencao implements RetentionStoragePort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SupabaseStorageOpcoes) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async remover(objeto: RetentionObjectRef): Promise<void> {
    if (!isRetentionBucket(objeto.bucket) || !caminhoDeObjetoValido(objeto.path)) {
      throw new RetentionStorageError('objeto_recusado');
    }
    const caminho = objeto.path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.opts.baseUrl}/storage/v1/object/${objeto.bucket}/${caminho}`;
    let status: number;
    try {
      const res = await this.fetchImpl(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey },
      });
      status = res.status;
    } catch {
      throw new RetentionStorageError('storage_falha');
    }
    if ((status >= 200 && status < 300) || status === 404) return;
    throw new RetentionStorageError('storage_falha');
  }
}

export interface RetentionPurgeDeps {
  readonly store: RetentionStorePort;
  readonly objetos: RetentionObjectsPort;
  readonly storage: RetentionStoragePort;
  readonly now: () => number;
  readonly adaptadores?: ReadonlySet<RetentionClass>;
  readonly limiteLote?: number;
  readonly maxLotes?: number;
  readonly orcamentoMs?: number;
}

/** Handler do job: chama o expurgo do dominio com as portas. Erros propagam para o tick (retentativa). */
export class RetentionPurgeHandler implements JobHandler {
  constructor(private readonly deps: RetentionPurgeDeps) {}

  async run(): Promise<void> {
    const opcoes: OpcoesExpurgo = {
      store: this.deps.store,
      objetos: this.deps.objetos,
      storage: this.deps.storage,
      adaptadores: this.deps.adaptadores ?? RETENTION_CLASSES_COM_ADAPTADOR,
      now: this.deps.now,
      limiteLote: this.deps.limiteLote,
      maxLotes: this.deps.maxLotes,
      orcamentoMs: this.deps.orcamentoMs,
    };
    await runRetentionPurge(opcoes);
  }
}

/** Registro do job no tick (chamado pela composicao do app quando o tick tiver registro de handlers). */
export function registerRetentionHandlers(registry: JobRegistry, deps: RetentionPurgeDeps): void {
  registerJobHandler(registry, RETENTION_PURGE_KIND, new RetentionPurgeHandler(deps));
}
