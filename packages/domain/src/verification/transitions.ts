// Issue 52 (H-039) | Transicoes do caso (124 §3.2; CA-H039-03). Espelho da funcao
// private.verification_transition_allowed do banco: o teste de paridade fica em transitions.test.ts.
import type { EstadoCaso } from './types.js';

export const TRANSICOES_CASO: readonly (readonly [EstadoCaso, EstadoCaso])[] = [
  ['pendente', 'em_revisao'],
  ['em_revisao', 'em_revisao'],
  ['em_revisao', 'aprovada'],
  ['em_revisao', 'recusada'],
  ['em_revisao', 'retida_duplicidade'],
  ['retida_duplicidade', 'aprovada'],
  ['retida_duplicidade', 'recusada'],
  ['retida_duplicidade', 'retida_duplicidade'],
  ['recusada', 'em_revisao'],
  ['retida_duplicidade', 'em_revisao'],
];

/** Verdadeiro se o par (de, para) esta na tabela. Qualquer outro par e recusado pelo banco tambem. */
export function podeTransitar(de: EstadoCaso, para: EstadoCaso): boolean {
  return TRANSICOES_CASO.some(([a, b]) => a === de && b === para);
}
