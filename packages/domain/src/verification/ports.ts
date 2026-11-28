// Issue 52 (H-039) | Portas da fila de verificacao (124 §5.1). O dominio nao conhece banco. A leitura do
// documento usa IdentityDocReaderPort, declarada em packages/domain/src/identity-docs/ports.ts (sem mudanca).
import type {
  CodigoErroVerificacao,
  Decisao,
  DetalheCaso,
  EscopoFila,
  EstadoRecurso,
  LinhaFila,
  MotivoDecisao,
} from './types.js';
import type { DuplicateView } from './duplicate-retention.js';

export interface RelogioVerificacao {
  now(): Date;
}

/** Erro do dominio. O adaptador traduz os codigos VRF e 42501 do banco para estes codigos. */
export class VerificacaoErro extends Error {
  constructor(readonly codigo: CodigoErroVerificacao) {
    super(codigo);
    this.name = 'VerificacaoErro';
  }
}

export interface ContextoAtor {
  readonly actorId: string;
  readonly sessionHash: string;
}

export interface VerificationCasePort {
  listar(
    ctx: ContextoAtor,
    entrada: { readonly escopo: EscopoFila; readonly limite: number; readonly apos: { readonly sla: Date; readonly id: string } | null; readonly now: Date },
  ): Promise<readonly LinhaFila[]>;
  atribuir(ctx: ContextoAtor, entrada: { readonly caseId: string; readonly versao: number; readonly now: Date }): Promise<{ readonly status: string; readonly versao: number }>;
  reatribuir(
    ctx: ContextoAtor,
    entrada: { readonly caseId: string; readonly responsavel: string; readonly versao: number; readonly now: Date },
  ): Promise<{ readonly status: string; readonly versao: number }>;
  decidir(
    ctx: ContextoAtor,
    entrada: {
      readonly caseId: string;
      readonly decisao: Decisao;
      readonly motivo: MotivoDecisao;
      readonly complemento: string | null;
      readonly versao: number;
      readonly now: Date;
    },
  ): Promise<{ readonly status: string; readonly versao: number }>;
  detalhe(ctx: ContextoAtor, entrada: { readonly caseId: string; readonly now: Date }): Promise<DetalheCaso>;
  duplicateView(ctx: ContextoAtor, entrada: { readonly caseId: string; readonly now: Date }): Promise<DuplicateView>;
  receberRecurso(
    professionalId: string,
    now: Date,
  ): Promise<'ok' | 'sem_caso' | 'nao_elegivel' | 'recurso_ja_usado'>;
}

export type { EstadoRecurso };
