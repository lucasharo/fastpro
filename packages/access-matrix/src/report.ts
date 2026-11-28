// H-115 (Issue 124) | Relatorio de paridade (desenho §7). Funcao pura: nenhuma leitura de arquivo.
// Cada executor imprime uma linha `H115 PARIDADE ...` com ids de caso, nunca dado de PII.
import type { AccessCase, AccessLayer } from './types.js';

export type CaseResult = 'ok' | 'falha' | 'pendente';

export interface ParityEvidence {
  readonly camada: AccessLayer;
  /** Resultado por id de caso ('CP-01' -> 'ok'). Caso ativo sem resultado conta como pendente. */
  readonly resultados: Readonly<Record<string, CaseResult>>;
}

export interface ParityReport {
  readonly camada: AccessLayer;
  readonly ativos: number;
  readonly ok: number;
  readonly falhas: readonly string[];
  readonly pendentes: readonly string[];
  readonly linha: string;
}

export function buildParityReport(cases: readonly AccessCase[], evidence: ParityEvidence): ParityReport {
  const ativos = cases.filter((c) => c.status === 'active' && c.layers.includes(evidence.camada));
  const falhas: string[] = [];
  const pendentes: string[] = [];
  let ok = 0;
  for (const c of ativos) {
    const r = evidence.resultados[c.id];
    if (r === 'ok') ok += 1;
    else if (r === 'falha') falhas.push(c.id);
    else pendentes.push(c.id);
  }
  const lista = (ids: readonly string[]) => `[${ids.join(',')}]`;
  const linha = `H115 PARIDADE camada=${evidence.camada} ativos=${ativos.length} ok=${ok} falhas=${lista(falhas)} pendentes=${lista(pendentes)}`;
  return { camada: evidence.camada, ativos: ativos.length, ok, falhas, pendentes, linha };
}
