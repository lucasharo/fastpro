// Issue 68 (H-055) | Adaptador de projecao da descoberta (docs/factory/153-DESENHO-H055.md, §2 A-1 e A-4, §5.2).
// Para cada id devolvido pela descoberta, chama a projecao do profissional no MESMO instante, em lotes de no maximo 8,
// e devolve as linhas na ordem da descoberta. Id sem linha (o pedido encerrou entre as duas leituras) e descartado
// em silencio (A-4). Reusa o mapeamento seguro de request-visibility.ts: nenhuma coordenada, nenhum endereco.
// Erro do banco vira o codigo fixo discovery_projecao_falhou; nenhum texto de driver sai daqui.
import type { SqlClient } from './jobs-tick.js';
import { PgRequestVisibilityStore, type ProfessionalRequestRow } from './request-visibility.js';

/** Paralelismo maximo por lote (§5.2). */
export const DISCOVERY_PROJECAO_PARALELO = 8;

export type DiscoveryProjectionErrorCode = 'discovery_projecao_falhou';

/** Erro com texto fixo: o codigo e o unico detalhe que sai do adaptador. */
export class DiscoveryProjectionError extends Error {
  readonly code: DiscoveryProjectionErrorCode;

  constructor(code: DiscoveryProjectionErrorCode) {
    super(code);
    this.name = 'DiscoveryProjectionError';
    this.code = code;
  }
}

export class PgDiscoveryProjectionStore {
  private readonly visibilidade: PgRequestVisibilityStore;

  constructor(client: SqlClient) {
    this.visibilidade = new PgRequestVisibilityStore(client);
  }

  /**
   * Projeta os pedidos ids (ordem da descoberta) para o profissional no instante `at`.
   * Devolve so as linhas encontradas, mantendo a ordem de entrada.
   */
  async project(
    professionalId: string,
    requestIds: readonly string[],
    at: Date,
  ): Promise<readonly ProfessionalRequestRow[]> {
    if (Number.isNaN(at.getTime())) throw new DiscoveryProjectionError('discovery_projecao_falhou');
    const nowMs = at.getTime();
    const porPosicao: (ProfessionalRequestRow | null)[] = new Array<ProfessionalRequestRow | null>(
      requestIds.length,
    ).fill(null);

    try {
      for (let inicio = 0; inicio < requestIds.length; inicio += DISCOVERY_PROJECAO_PARALELO) {
        const lote = requestIds.slice(inicio, inicio + DISCOVERY_PROJECAO_PARALELO);
        const linhas = await Promise.all(
          lote.map((requestId) => this.visibilidade.readProfessional(professionalId, requestId, nowMs)),
        );
        linhas.forEach((linha, i) => {
          porPosicao[inicio + i] = linha;
        });
      }
    } catch {
      throw new DiscoveryProjectionError('discovery_projecao_falhou');
    }

    return porPosicao.filter((linha): linha is ProfessionalRequestRow => linha !== null);
  }
}
