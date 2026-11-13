// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §5.2) | Porta da fila de verificacao no Postgres.
// So chama funcoes private.verification_* com o papel app_system e parametros posicionais. A autorizacao,
// a prova de sessao, a trava e as transicoes estao no SQL; aqui so traduzimos erros. O hash da sessao chega
// pronto no contexto (quem recebe o segredo em claro e a rota) e nenhum valor e registrado.
import type { SqlClient } from '@fastpro/db';
import {
  VerificacaoErro,
  type CodigoErroVerificacao,
  type ContextoAtor,
  type DetalheCaso,
  type EstadoCaso,
  type EstadoRecurso,
  type LinhaFila,
  type MotivoDecisao,
  type VerificationCasePort,
} from '@fastpro/domain';

const SQL_LISTA = 'select * from private.verification_queue_list($1::uuid, $2::text, $3::text, $4::integer, $5::timestamptz, $6::uuid, $7::timestamptz)';
const SQL_DETALHE = 'select * from private.verification_case_detail($1::uuid, $2::text, $3::uuid, $4::timestamptz)';
const SQL_ATRIBUIR = 'select * from private.verification_case_assign($1::uuid, $2::text, $3::uuid, $4::integer, $5::timestamptz)';
const SQL_REATRIBUIR =
  'select * from private.verification_case_reassign($1::uuid, $2::text, $3::uuid, $4::uuid, $5::integer, $6::timestamptz)';
const SQL_DECIDIR =
  'select * from private.verification_case_decide($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::integer, $8::timestamptz)';
const SQL_RECURSO = 'select * from private.verification_case_appeal($1::uuid, $2::timestamptz)';

/** SQLSTATE e codigos VRF do banco para codigos do dominio. 42501 e a negacao uniforme (CA-H039-02). */
const CODIGOS_BANCO: Readonly<Record<string, CodigoErroVerificacao>> = {
  '42501': 'permissao_negada',
  '22023': 'entrada_invalida',
  VRF01: 'caso_conflito',
  VRF02: 'motivo_invalido',
  VRF03: 'explicacao_invalida',
  VRF04: 'identidade_nao_analisada',
  VRF05: 'certificacao_pendente',
  VRF06: 'documento_indisponivel',
  VRF07: 'perfil_suspenso',
};

/** Erro do banco vira VerificacaoErro com codigo do dominio; qualquer outra falha segue como esta (503 na rota). */
export function traduzirErroVerificacao(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in CODIGOS_BANCO) {
    return new VerificacaoErro(CODIGOS_BANCO[code] as CodigoErroVerificacao);
  }
  return err;
}

const iso = (valor: unknown): Date | null => (valor === null || valor === undefined ? null : new Date(valor as string));

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : String(valor);
}

function linha(r: Record<string, unknown>): LinhaFila {
  return {
    id: texto(r.out_id),
    shortId: texto(r.out_short_id),
    status: r.out_status as EstadoCaso,
    appealStatus: r.out_appeal_status as EstadoRecurso,
    slaTargetAt: new Date(r.out_sla_target_at as string),
    receivedAt: iso(r.out_received_at),
    services: Array.isArray(r.out_services) ? (r.out_services as string[]) : [],
    overdue: r.out_overdue === true,
    assignedToMe: r.out_assigned_to_me === true,
    version: Number(r.out_version),
  };
}

export class PgVerificationCasePort implements VerificationCasePort {
  constructor(private readonly client: SqlClient) {}

  private async consulta1(text: string, params: unknown[]): Promise<Record<string, unknown>> {
    const [r] = await this.consulta(text, params);
    if (!r) throw new VerificacaoErro('permissao_negada');
    return r;
  }

  private async consulta(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    try {
      const res = await this.client.query(text, params);
      return res.rows;
    } catch (err) {
      throw traduzirErroVerificacao(err);
    }
  }

  async listar(
    ctx: ContextoAtor,
    entrada: { readonly escopo: string; readonly limite: number; readonly apos: { readonly sla: Date; readonly id: string } | null; readonly now: Date },
  ): Promise<readonly LinhaFila[]> {
    const rows = await this.consulta(SQL_LISTA, [
      ctx.actorId,
      ctx.sessionHash,
      entrada.escopo,
      entrada.limite,
      entrada.apos ? entrada.apos.sla.toISOString() : null,
      entrada.apos ? entrada.apos.id : null,
      entrada.now.toISOString(),
    ]);
    return rows.map(linha);
  }

  async detalhe(ctx: ContextoAtor, entrada: { readonly caseId: string; readonly now: Date }): Promise<DetalheCaso> {
    const r = await this.consulta1(SQL_DETALHE, [ctx.actorId, ctx.sessionHash, entrada.caseId, entrada.now.toISOString()]);
    if (!r) throw new VerificacaoErro('permissao_negada');
    return {
      ...linha(r),
      reasonCode: (r.out_reason_code as MotivoDecisao | null) ?? null,
      explanation: (r.out_explanation as string | null) ?? null,
      decidedAt: iso(r.out_decided_at),
      documentAvailable: r.out_document_available === true,
      documentId: (r.out_document_id as string | null) ?? null,
      documentReceivedAt: iso(r.out_document_received_at),
    };
  }

  async atribuir(ctx: ContextoAtor, entrada: { readonly caseId: string; readonly versao: number; readonly now: Date }) {
    const r = await this.consulta1(SQL_ATRIBUIR, [
      ctx.actorId,
      ctx.sessionHash,
      entrada.caseId,
      entrada.versao,
      entrada.now.toISOString(),
    ]);
    return { status: texto(r.out_status), versao: Number(r.out_version) };
  }

  async reatribuir(
    ctx: ContextoAtor,
    entrada: { readonly caseId: string; readonly responsavel: string; readonly versao: number; readonly now: Date },
  ) {
    const r = await this.consulta1(SQL_REATRIBUIR, [
      ctx.actorId,
      ctx.sessionHash,
      entrada.caseId,
      entrada.responsavel,
      entrada.versao,
      entrada.now.toISOString(),
    ]);
    return { status: texto(r.out_status), versao: Number(r.out_version) };
  }

  async decidir(
    ctx: ContextoAtor,
    entrada: {
      readonly caseId: string;
      readonly decisao: string;
      readonly motivo: string;
      readonly complemento: string | null;
      readonly versao: number;
      readonly now: Date;
    },
  ) {
    const r = await this.consulta1(SQL_DECIDIR, [
      ctx.actorId,
      ctx.sessionHash,
      entrada.caseId,
      entrada.decisao,
      entrada.motivo,
      entrada.complemento,
      entrada.versao,
      entrada.now.toISOString(),
    ]);
    return { status: texto(r.out_status), versao: Number(r.out_version) };
  }

  async receberRecurso(professionalId: string, now: Date): Promise<'ok' | 'sem_caso' | 'nao_elegivel' | 'recurso_ja_usado'> {
    const r = await this.consulta1(SQL_RECURSO, [professionalId, now.toISOString()]);
    return texto(r.out_code) as 'ok' | 'sem_caso' | 'nao_elegivel' | 'recurso_ja_usado';
  }
}
