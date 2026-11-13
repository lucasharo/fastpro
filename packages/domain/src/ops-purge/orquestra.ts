// H-110 (Issue 119) | Orquestracao pura dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §2).
// Ordem fixa (E1 a E9), isolamento de falha por bloco (RN-H110-13, caso de borda 9), orcamento de tempo, teto de
// lotes e contagens. Nao conhece banco nem Storage: os executores sao injetados.
import {
  BLOCOS_OPS_PURGE,
  LIMITE_LOTE_PADRAO,
  MAX_LOTES_PADRAO,
  ORCAMENTO_MS_PADRAO,
  type BlocoOpsPurge,
  type ContagensOpsPurge,
  type EstadoBlocoOpsPurge,
  type OpcoesOpsPurge,
  type RelatorioOpsPurge,
  type ResultadoLoteOpsPurge,
} from './types.js';

const ESTADOS_PULADO: ReadonlySet<EstadoBlocoOpsPurge> = new Set(['pulado_ausente', 'pulado_incompativel']);

/**
 * Executa os blocos na ordem recebida (que deve ser BLOCOS_OPS_PURGE). Um bloco que falha vira `falha` e os demais
 * seguem. Um bloco continua enquanto remover linhas, sem falhas e dentro do orcamento e do teto de lotes.
 */
export async function executaOpsPurge(opcoes: OpcoesOpsPurge): Promise<RelatorioOpsPurge> {
  const limite = opcoes.limiteLote ?? LIMITE_LOTE_PADRAO;
  const orcamento = opcoes.orcamentoMs ?? ORCAMENTO_MS_PADRAO;
  const maxLotes = opcoes.maxLotes ?? MAX_LOTES_PADRAO;
  if (!Number.isInteger(limite) || limite < 1 || limite > 5000) {
    throw new RangeError('limite de lote invalido');
  }
  const inicio = opcoes.agora();
  const contagens: Record<string, number> = { run_no: opcoes.numeroExecucao ?? 1 };
  const estados = {} as Record<BlocoOpsPurge, EstadoBlocoOpsPurge>;
  let restante = false;

  const esgotado = (): boolean => opcoes.agora() - inicio >= orcamento;

  for (const bloco of BLOCOS_OPS_PURGE) {
    const executor = opcoes.executores.find((e) => e.bloco === bloco);
    let removidos = 0;
    let retidos = 0;
    let falhos = 0;
    let estado: EstadoBlocoOpsPurge = 'ok';

    if (!executor) {
      estado = 'pulado_ausente';
    } else if (esgotado()) {
      estado = 'nao_executado';
      restante = true;
    } else {
      for (let lote = 1; lote <= maxLotes; lote += 1) {
        let r: ResultadoLoteOpsPurge;
        try {
          r = await executor.lote(limite);
        } catch {
          r = { estado: 'falha', removidos: 0, retidos: 0, falhos: 1 };
        }
        if (r.estado !== 'ok') {
          estado = r.estado;
          retidos = r.retidos;
          falhos += r.falhos;
          break;
        }
        removidos += r.removidos;
        retidos = r.retidos;
        falhos += r.falhos;
        if (r.falhos > 0) {
          estado = 'falha';
          break;
        }
        if (r.removidos === 0) break;
        if (lote === maxLotes) {
          restante = true;
          break;
        }
        if (esgotado()) {
          restante = true;
          break;
        }
      }
    }

    estados[bloco] = estado;
    const n = bloco;
    contagens[`${n}_removidos`] = removidos;
    contagens[`${n}_retidos`] = retidos;
    contagens[`${n}_falhos`] = falhos;
    contagens[`${n}_pulado`] = ESTADOS_PULADO.has(estado) ? 1 : 0;
  }

  return { contagens: contagens as ContagensOpsPurge, estados, restante };
}
