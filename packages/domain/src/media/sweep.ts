// H-026 (Issue #39) | Expurgo da quarentena em duas fases (docs/factory/88-DESENHO-H026.md, §4; F-09; CA-07, CA-11).
//   A (banco): media_sweep marca e devolve os ids a expurgar (pendentes vencidos, rascunho descartado/vencido).
//   B (Storage): remove cada objeto. Ausente conta como sucesso.
//   C (banco): media_purge_done apaga so as linhas cujo objeto saiu. Falha de Storage deixa a linha marcada.
// Varredura de orfaos: objeto 'd/<uuid>' mais antigo que 3 h sem linha e removido. Sem agendamento aqui
// (o tick e de H-110): o servico e chamado pelo job ou manualmente. Erros nunca carregam chave ou URL.
import {
  MEDIA_ORPHAN_AGE_MS,
  MEDIA_ORPHAN_LIST_LIMIT,
  MEDIA_SWEEP_BATCH,
  mediaIdFromKey,
  mediaObjectKey,
} from './media.js';
import type { MediaStorePort, QuarantineStoragePort } from './ports.js';

export interface SweepDeps {
  readonly store: Pick<MediaStorePort, 'sweep' | 'purgeDone' | 'known'>;
  readonly storage: Pick<QuarantineStoragePort, 'remove' | 'listOlderThan'>;
  readonly nowMs: () => number;
  readonly lote?: number;
  readonly limiteOrfaos?: number;
}

/** Contagens apenas (nenhum id, chave ou caminho sai no relatorio). */
export interface SweepReport {
  readonly marcados: number;
  readonly removidos: number;
  readonly falhas: number;
  readonly orfaosRemovidos: number;
  readonly falhasOrfaos: number;
}

export async function sweepQuarantine(deps: SweepDeps): Promise<SweepReport> {
  const agora = deps.nowMs();
  const ids = await deps.store.sweep(agora, deps.lote ?? MEDIA_SWEEP_BATCH);

  const removidos: string[] = [];
  let falhas = 0;
  for (const id of ids) {
    try {
      await deps.storage.remove(mediaObjectKey(id));
      removidos.push(id);
    } catch {
      falhas++;
    }
  }
  let linhasApagadas = 0;
  if (removidos.length > 0) linhasApagadas = await deps.store.purgeDone(removidos);

  const antigos = await deps.storage.listOlderThan(agora - MEDIA_ORPHAN_AGE_MS, deps.limiteOrfaos ?? MEDIA_ORPHAN_LIST_LIMIT);
  const candidatos = antigos.map(mediaIdFromKey).filter((id): id is string => id !== null);
  const comLinha = new Set(candidatos.length > 0 ? await deps.store.known(candidatos) : []);
  let orfaosRemovidos = 0;
  let falhasOrfaos = 0;
  for (const id of candidatos) {
    if (comLinha.has(id)) continue;
    try {
      await deps.storage.remove(mediaObjectKey(id));
      orfaosRemovidos++;
    } catch {
      falhasOrfaos++;
    }
  }

  return {
    marcados: ids.length,
    removidos: linhasApagadas,
    falhas,
    orfaosRemovidos,
    falhasOrfaos,
  };
}
