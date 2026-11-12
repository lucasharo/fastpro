// H-109 (Issue 118) | Expurgo idempotente em lotes com tres fases (docs/factory/82-DESENHO-H109.md §2 e §4).
//   A (banco, uma transacao): marca os sujeitos elegiveis como 'expurgando' e devolve os ids.
//   B (fora do banco): remove cada objeto do Storage. Objeto ja ausente conta como sucesso.
//   C (banco, uma transacao): reconfere legal_hold, aplica a acao e grava o evento do lote.
// A ordem objeto-antes-da-linha evita objeto orfao sem ponteiro (CA-H109-09). Dry run: so simula.
// Logica pura: as portas (banco e Storage) sao injetadas. Erros nunca carregam dado pessoal.
import {
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES_PER_RUN,
  RETENTION_OBJECTS_PER_BATCH,
  type RetentionAction,
  type RetentionClass,
  type RetentionObjectRef,
} from './types.js';

/** Politica lida de app.retention_policy. periodoPresente=false = job desligado (CA-H109-01). */
export interface PoliticaExpurgo {
  readonly id: string;
  readonly dataClass: RetentionClass;
  readonly enabled: boolean;
  readonly dryRun: boolean;
  readonly action: RetentionAction | null;
  readonly periodoPresente: boolean;
}

/** Resultado da fase C: so contagens. */
export interface ResultadoLote {
  readonly processados: number;
  readonly suspensos: number;
  readonly falhos: number;
}

/** Objeto da fila (app.retention_object_queue) pendente de remocao. */
export interface ObjetoFila {
  readonly id: string;
  readonly objeto: RetentionObjectRef;
}

/** Porta do banco. Cada metodo e uma chamada atomica (uma transacao no adaptador). */
export interface RetentionStorePort {
  listarPoliticas(): Promise<readonly PoliticaExpurgo[]>;
  /** Simulacao: conta elegiveis e retidos por hold, grava evento de lote com dry_run e nao muda linhas. */
  simular(politicaId: string, nowMs: number): Promise<{ readonly elegiveis: number; readonly retidos: number }>;
  /** Fase A. Devolve os ids dos sujeitos marcados neste lote (novos ou retomados). */
  marcarLote(politicaId: string, limite: number, nowMs: number): Promise<readonly string[]>;
  /** Grava na fila os objetos de um sujeito (idempotente por bucket e caminho). */
  enfileirarObjeto(politicaId: string, sujeitoId: string, objeto: RetentionObjectRef, nowMs: number): Promise<void>;
  /** Objetos pendentes dos sujeitos do lote. */
  objetosPendentes(politicaId: string, sujeitos: readonly string[], limite: number): Promise<readonly ObjetoFila[]>;
  /** Marca removido (ok) ou soma uma tentativa (falha). */
  registrarRemocao(filaId: string, ok: boolean, nowMs: number): Promise<void>;
  /** Fase C. Reconfere hold, aplica a acao e grava o evento do lote na mesma transacao. */
  finalizarLote(
    politicaId: string,
    sujeitos: readonly string[],
    nowMs: number,
    numeroLote: number,
  ): Promise<ResultadoLote>;
}

/** Fonte de objetos por classe (adaptadores RC-01, RC-02; vazia onde o esquema nao tem objeto). */
export interface RetentionObjectsPort {
  objetosDe(
    classe: RetentionClass,
    sujeitos: readonly string[],
  ): Promise<readonly { readonly sujeitoId: string; readonly objeto: RetentionObjectRef }[]>;
}

/** Porta do Storage. remover() resolve quando o objeto saiu ou ja nao existia; lanca em falha. */
export interface RetentionStoragePort {
  remover(objeto: RetentionObjectRef): Promise<void>;
}

export interface RelatorioExpurgo {
  politicasLidas: number;
  ignoradas: number;
  semAlvo: number;
  simulacoes: number;
  lotes: number;
  processados: number;
  suspensos: number;
  falhos: number;
  falhasStorage: number;
  interrompido: boolean;
}

export interface OpcoesExpurgo {
  readonly store: RetentionStorePort;
  readonly objetos: RetentionObjectsPort;
  readonly storage: RetentionStoragePort;
  /** Classes com adaptador registrado. Classe fora desta lista recebe sem_alvo (nada e feito). */
  readonly adaptadores: ReadonlySet<RetentionClass>;
  readonly now: () => number;
  readonly limiteLote?: number;
  readonly maxLotes?: number;
  readonly limiteObjetos?: number;
  /** Orcamento de tempo da execucao (ms); ao esgotar, a execucao para e a proxima retoma. */
  readonly orcamentoMs?: number;
}

/**
 * Executa o expurgo para todas as politicas. Politica desligada (enabled=false ou sem periodo) nao toca
 * em nada (CA-H109-01). Politica com dry_run=true so simula. Politica ativa roda lotes ate acabar,
 * atingir o teto de lotes ou esgotar o orcamento. Falha de Storage deixa o objeto na fila (nova tentativa).
 */
export async function runRetentionPurge(opts: OpcoesExpurgo): Promise<RelatorioExpurgo> {
  const limiteLote = opts.limiteLote ?? RETENTION_BATCH_SIZE;
  const maxLotes = opts.maxLotes ?? RETENTION_MAX_BATCHES_PER_RUN;
  const limiteObjetos = opts.limiteObjetos ?? RETENTION_OBJECTS_PER_BATCH;
  const inicio = opts.now();
  const orcamento = opts.orcamentoMs ?? Number.POSITIVE_INFINITY;
  const rel: RelatorioExpurgo = {
    politicasLidas: 0,
    ignoradas: 0,
    semAlvo: 0,
    simulacoes: 0,
    lotes: 0,
    processados: 0,
    suspensos: 0,
    falhos: 0,
    falhasStorage: 0,
    interrompido: false,
  };

  const politicas = await opts.store.listarPoliticas();
  rel.politicasLidas = politicas.length;

  for (const p of politicas) {
    if (!p.enabled || !p.periodoPresente || p.action === null || p.action === 'reter') {
      rel.ignoradas++;
      continue;
    }
    if (!opts.adaptadores.has(p.dataClass)) {
      rel.semAlvo++;
      continue;
    }
    const agora = opts.now();
    if (p.dryRun) {
      await opts.store.simular(p.id, agora);
      rel.simulacoes++;
      continue;
    }

    let lotesDaPolitica = 0;
    while (lotesDaPolitica < maxLotes) {
      if (opts.now() - inicio >= orcamento) {
        rel.interrompido = true;
        return rel;
      }
      const agoraLote = opts.now();
      const sujeitos = await opts.store.marcarLote(p.id, limiteLote, agoraLote);
      if (sujeitos.length === 0) break;
      lotesDaPolitica++;
      rel.lotes++;

      // Fase A (complemento): objetos dos sujeitos marcados entram na fila antes de qualquer remocao.
      const achados = await opts.objetos.objetosDe(p.dataClass, sujeitos);
      for (const a of achados) await opts.store.enfileirarObjeto(p.id, a.sujeitoId, a.objeto, agoraLote);

      // Fase B: remocao no Storage, fora do banco.
      const pendentes = await opts.store.objetosPendentes(p.id, sujeitos, limiteObjetos);
      for (const item of pendentes) {
        try {
          await opts.storage.remover(item.objeto);
          await opts.store.registrarRemocao(item.id, true, opts.now());
        } catch {
          rel.falhasStorage++;
          await opts.store.registrarRemocao(item.id, false, opts.now());
        }
      }

      // Fase C: reconfere hold e aplica a acao, com o evento do lote na mesma transacao.
      const res = await opts.store.finalizarLote(p.id, sujeitos, opts.now(), lotesDaPolitica);
      rel.processados += res.processados;
      rel.suspensos += res.suspensos;
      rel.falhos += res.falhos;

      if (sujeitos.length < limiteLote) break;
    }
  }
  return rel;
}
