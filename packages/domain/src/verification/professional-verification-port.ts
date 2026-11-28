// Issue 54 (H-041) | Porta do estado visivel e do recurso do profissional (docs/factory/141-DESENHO-H041.md §7).
// O adaptador (apps/api/src/verification) implementa esta porta; o dominio nao conhece banco nem HTTP.
import type { LinhaEstadoVerificacao } from './professional-verification-state.js';

/** Codigo unico de recurso indisponivel: sem caso, nao elegivel e ja usado devolvem o mesmo 409. */
export const CODIGO_RECURSO_INDISPONIVEL = 'recurso_indisponivel';

export type ResultadoRecurso = 'ok' | typeof CODIGO_RECURSO_INDISPONIVEL;

export interface ProfessionalVerificationPort {
  /** Linha de estado do profissional da sessao; nulo quando a conta nao tem perfil profissional. */
  lerEstado(profissional: string): Promise<LinhaEstadoVerificacao | null>;
  /** Pedido de revisao; so recusada sem recurso anterior devolve 'ok'. */
  pedirRecurso(profissional: string, agora: Date): Promise<ResultadoRecurso>;
}
