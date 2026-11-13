// H-037 (Issue #50) | Varredura dos documentos de identidade (docs/factory/107-DESENHO-H037.md, §6.5; CA-11).
// (a) o banco marca pendentes vencidos e recusados; (b) o Storage remove a entrada e o final; (c) so as linhas com
// objeto removido saem do banco; (d) objeto de entrada sem linha conhecida e mais velho que 3 h e orfao.
// O agendamento e de H-110 (ou manual, documentado): esta funcao nao agenda nada.
import { identityDocIncomingKey } from './espelho/keys.js';
import { IDOC_ORPHAN_AGE_MS } from './espelho/constants.js';
import type { IdentityDocFinalPort, IdentityDocStagingPort, IdentityDocStorePort } from './espelho/ports.js';

export interface IdentityDocSweepDeps {
  readonly store: IdentityDocStorePort;
  readonly staging: IdentityDocStagingPort;
  readonly final: IdentityDocFinalPort;
  readonly clock: { nowMs(): number };
}

export interface IdentityDocSweepResultado {
  /** Linhas que o banco marcou nesta rodada (pendentes vencidos e recusados). */
  readonly marcados: number;
  /** Linhas cujo objeto foi removido e que saíram do banco. */
  readonly purgados: number;
  /** Objetos de entrada sem linha conhecida removidos. */
  readonly orfaos: number;
  /** Falhas de Storage ou de banco nesta rodada. Nada e logado com nome, caminho ou conteudo. */
  readonly falhas: number;
}

const UUID_NOME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uma rodada: `limite` limita as linhas marcadas e os objetos listados. */
export async function sweepIdentityDocs(deps: IdentityDocSweepDeps, limite = 200): Promise<IdentityDocSweepResultado> {
  let falhas = 0;

  const itens = await deps.store.sweep(deps.clock.nowMs(), limite);
  const liberados: string[] = [];
  for (const item of itens) {
    try {
      if (item.stagingKey) await deps.staging.remove(identityDocIncomingKey(item.id));
      if (item.finalKey) await deps.final.remove(item.id);
      liberados.push(item.id);
    } catch {
      falhas++;
    }
  }
  const purgados = liberados.length === 0 ? 0 : await deps.store.purgeDone(liberados);

  let orfaos = 0;
  try {
    const chaves = await deps.staging.listOlderThan(IDOC_ORPHAN_AGE_MS, limite);
    const ids = chaves
      .filter((c) => c.startsWith('s/') && UUID_NOME_RE.test(c.slice(2)))
      .map((c) => c.slice(2).toLowerCase());
    const conhecidos = new Set(await deps.store.knownPending(ids));
    for (const id of ids) {
      if (conhecidos.has(id)) continue;
      try {
        await deps.staging.remove(identityDocIncomingKey(id));
        orfaos++;
      } catch {
        falhas++;
      }
    }
  } catch {
    falhas++;
  }

  return { marcados: itens.length, purgados, orfaos, falhas };
}
