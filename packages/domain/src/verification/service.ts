// Issue 52 (H-039) | Servico da fila de verificacao: valida a entrada e delega a porta (124 §5.1).
// A autorizacao e feita no banco (dentro de cada funcao); o servico nao decide permissao.
import { validarDecisao } from './reasons.js';
import { type RelogioVerificacao, type ContextoAtor, VerificacaoErro, type VerificationCasePort } from './ports.js';
import {
  ESCOPOS_FILA,
  LIMITE_FILA_MAX,
  type Decisao,
  type EscopoFila,
  type LinhaFila,
  type MotivoDecisao,
} from './types.js';

export class VerificationService {
  constructor(
    private readonly port: VerificationCasePort,
    private readonly clock: RelogioVerificacao,
  ) {}

  listar(
    ctx: ContextoAtor,
    entrada: { readonly escopo: string; readonly limite: number; readonly apos?: { readonly sla: Date; readonly id: string } | null },
  ): Promise<readonly LinhaFila[]> {
    if (!(ESCOPOS_FILA as readonly string[]).includes(entrada.escopo)) throw new VerificacaoErro('entrada_invalida');
    if (!Number.isInteger(entrada.limite) || entrada.limite < 1 || entrada.limite > LIMITE_FILA_MAX) {
      throw new VerificacaoErro('entrada_invalida');
    }
    return this.port.listar(ctx, {
      escopo: entrada.escopo as EscopoFila,
      limite: entrada.limite,
      apos: entrada.apos ?? null,
      now: this.clock.now(),
    });
  }

  detalhe(ctx: ContextoAtor, caseId: string) {
    if (!caseId) throw new VerificacaoErro('entrada_invalida');
    return this.port.detalhe(ctx, { caseId, now: this.clock.now() });
  }

  atribuir(ctx: ContextoAtor, caseId: string, versao: number) {
    return this.port.atribuir(ctx, { caseId, versao, now: this.clock.now() });
  }

  reatribuir(ctx: ContextoAtor, caseId: string, responsavel: string, versao: number) {
    if (!responsavel) throw new VerificacaoErro('entrada_invalida');
    return this.port.reatribuir(ctx, { caseId, responsavel, versao, now: this.clock.now() });
  }

  decidir(
    ctx: ContextoAtor,
    caseId: string,
    entrada: { readonly decisao: string; readonly motivo: string; readonly complemento?: string | null; readonly versao: number },
  ) {
    const r = validarDecisao(entrada);
    if (!r.ok) throw new VerificacaoErro(r.codigo);
    return this.port.decidir(ctx, {
      caseId,
      decisao: entrada.decisao as Decisao,
      motivo: entrada.motivo as MotivoDecisao,
      complemento: r.complemento,
      versao: entrada.versao,
      now: this.clock.now(),
    });
  }

  receberRecurso(professionalId: string) {
    return this.port.receberRecurso(professionalId, this.clock.now());
  }
}
