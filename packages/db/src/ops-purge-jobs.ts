// H-110 (Issue 119) | Job ops.purge ligado ao tick (docs/factory/105-DESENHO-H110.md §2 e §8).
// Registro no JobRegistry, padrao de registerRetentionHandlers. Os blocos E1 e E9 usam uma porta de Storage
// injetada (QuarentenaArquivosPort); E2 a E8 sao so SQL. Nenhum segredo e lido aqui. Nenhum agendamento e criado
// aqui: o disparo diario e pg_cron (condicionado) ou manual pelo runbook.
import {
  executaOpsPurge,
  type ExecutorBlocoOpsPurge,
  type OpcoesOpsPurge,
  type RelatorioOpsPurge,
  type ResultadoLoteOpsPurge,
} from '@fastpro/domain';
import { registerJobHandler, type JobContext, type JobHandler, type JobRegistry } from './jobs-tick.js';
import { PgOpsPurgeStore, type FuncaoBlocoOpsPurge } from './ops-purge-store.js';

export const OPS_PURGE_KIND = 'ops.purge';

/** Porta de remocao de objetos da quarentena (implementada por SupabaseStorageQuarentena ou por teste). */
export interface QuarentenaArquivosPort {
  remover(nome: string): Promise<void>;
}

export interface OpsPurgeDeps {
  readonly store: PgOpsPurgeStore;
  readonly arquivos: QuarentenaArquivosPort;
  /** Caminho do objeto de uma foto na quarentena (formato definido pela Issue 141; injetado, G-3). */
  readonly caminhoDoObjeto: (assetId: string) => string;
  readonly now: () => number;
  readonly limiteLote?: number;
  readonly orcamentoMs?: number;
  readonly maxLotes?: number;
}

const soma = (a: ResultadoLoteOpsPurge, b: ResultadoLoteOpsPurge): ResultadoLoteOpsPurge => ({
  estado: a.estado === 'ok' || b.estado === 'ok' ? 'ok' : a.estado,
  removidos: a.removidos + b.removidos,
  retidos: a.retidos + b.retidos,
  falhos: a.falhos + b.falhos,
});

/** Bloco SQL simples: uma funcao private.ops_purge_* por lote. */
function blocoSql(bloco: ExecutorBlocoOpsPurge['bloco'], store: PgOpsPurgeStore, agora: () => number,
  funcao: FuncaoBlocoOpsPurge): ExecutorBlocoOpsPurge {
  return { bloco, lote: (limite) => store.bloco(funcao, agora(), limite) };
}

/** E1: marca no SQL, depois o Node remove o objeto e so entao apaga a linha (ordem objeto antes da linha, RN-H110-12). */
function blocoE1(deps: OpsPurgeDeps, agora: () => number): ExecutorBlocoOpsPurge {
  return {
    bloco: 'e1',
    async lote(limite) {
      const marca = await deps.store.bloco('ops_purge_media_mark', agora(), limite);
      if (marca.estado !== 'ok') return marca;
      let removidos = 0;
      let falhos = 0;
      for (const id of await deps.store.sobrasOriginais(limite)) {
        try {
          await deps.arquivos.remover(deps.caminhoDoObjeto(id));
          if (await deps.store.marcarOriginalRemovido(id, agora())) removidos += 1;
        } catch {
          falhos += 1;
        }
      }
      const prontos: string[] = [];
      const falharam: string[] = [];
      for (const id of await deps.store.marcados(limite)) {
        try {
          await deps.arquivos.remover(deps.caminhoDoObjeto(id));
          prontos.push(id);
        } catch {
          falhos += 1;
          falharam.push(id);
        }
      }
      // Falha de objeto (ex.: objeto_recusado) e contada e a foto vai para o fim da fila: sem isso, a mesma foto
      // ocupava o topo de marcados em todo lote e travava a fila (achado 2 do Code Review).
      try {
        await deps.store.adiarMarcados(falharam, agora());
      } catch {
        falhos += 1;
      }
      removidos += await deps.store.concluirMarcados(prontos);
      return { estado: 'ok', removidos, retidos: 0, falhos };
    },
  };
}

/** E6: saida de eventos (E6a) e saida de e-mail (E6b), somadas. */
function blocoE6(store: PgOpsPurgeStore, agora: () => number): ExecutorBlocoOpsPurge {
  return {
    bloco: 'e6',
    async lote(limite) {
      const a = await store.bloco('ops_purge_outbox_event', agora(), limite);
      const b = await store.bloco('ops_purge_email_outbox', agora(), limite);
      return soma(a, b);
    },
  };
}

/**
 * E9: objetos orfaos do bucket quarentena. O filtro (padrao uuid e sem linha em app.media_asset) e o limite ficam
 * no SQL; o Node so remove os nomes que vieram e soma os fora do padrao (retidos).
 */
function blocoE9(deps: OpsPurgeDeps, agora: () => number): ExecutorBlocoOpsPurge {
  return {
    bloco: 'e9',
    async lote(limite) {
      const r = await deps.store.orfaos(agora(), limite);
      if (r.estado !== 'ok') return { estado: r.estado, removidos: 0, retidos: 0, falhos: 0 };
      let removidos = 0;
      let falhos = 0;
      for (const nome of r.nomes) {
        try {
          await deps.arquivos.remover(nome);
          removidos += 1;
        } catch {
          falhos += 1;
        }
      }
      return { estado: 'ok', removidos, retidos: r.retidos, falhos };
    },
  };
}

/** Monta os executores E1 a E9 a partir das dependencias. */
export function montaExecutoresOpsPurge(deps: OpsPurgeDeps): ExecutorBlocoOpsPurge[] {
  const agora = deps.now;
  const store = deps.store;
  return [
    blocoE1(deps, agora),
    blocoSql('e2', store, agora, 'ops_purge_draft'),
    blocoSql('e3', store, agora, 'ops_purge_auth_challenge'),
    blocoSql('e4', store, agora, 'ops_purge_session'),
    blocoSql('e5', store, agora, 'ops_purge_provider_event'),
    blocoE6(store, agora),
    { bloco: 'e7', lote: (limite) => store.bloco('ops_purge_idempotency', agora(), limite) },
    blocoSql('e8', store, agora, 'ops_purge_media_access'),
    blocoE9(deps, agora),
  ];
}

/** Handler do job: executa os blocos, audita so as contagens e nao propaga falha de bloco. */
export class OpsPurgeHandler implements JobHandler {
  constructor(private readonly deps: OpsPurgeDeps) {}

  async run(job: JobContext): Promise<void> {
    const opcoes: OpcoesOpsPurge = {
      executores: montaExecutoresOpsPurge(this.deps),
      agora: this.deps.now,
      limiteLote: this.deps.limiteLote,
      orcamentoMs: this.deps.orcamentoMs,
      maxLotes: this.deps.maxLotes,
    };
    const relatorio: RelatorioOpsPurge = await executaOpsPurge(opcoes);
    await this.deps.store.auditar(job.id, relatorio.contagens);
  }
}

/** Registro no tick (chamado pela composicao do app; a composicao e fase 2 da Issue 141 e da Issue 43). */
export function registerOpsPurgeHandlers(registry: JobRegistry, deps: OpsPurgeDeps): void {
  registerJobHandler(registry, OPS_PURGE_KIND, new OpsPurgeHandler(deps));
}
