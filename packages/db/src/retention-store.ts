// H-109 (Issue 118) | Adaptadores Pg da retencao (docs/factory/82-DESENHO-H109.md §2, §5). Cada metodo e uma
// chamada a uma funcao private.retention_* ou private.legal_hold_* (uma transacao no banco). O SQL nao e
// montado aqui com dado de entrada: parametros sempre posicionais. Erros do banco viram codigo fixo.
import type { SqlClient } from './jobs-tick.js';
import {
  codigoDeRetencao,
  RetentionAdminError,
  type MudancaPolitica,
  type PoliticaExpurgo,
  type ObjetoFila,
  type ResultadoLote,
  type RetentionAdminPort,
  type RetentionClass,
  type RetentionObjectRef,
  type RetentionStorePort,
  type SujeitoHold,
} from '@fastpro/domain';

const DESCONHECIDO = 'retencao_indisponivel';

/** Converte a mensagem do RAISE em codigo conhecido; qualquer outra falha vira codigo generico, sem detalhe. */
function erroDoBanco(err: unknown): RetentionAdminError {
  const mensagem = err instanceof Error ? err.message : '';
  return new RetentionAdminError(codigoDeRetencao(mensagem) ?? DESCONHECIDO);
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class PgRetentionStore implements RetentionStorePort {
  constructor(private readonly client: SqlClient) {}

  async listarPoliticas(): Promise<readonly PoliticaExpurgo[]> {
    const res = await this.client.query(
      'select id, data_class, enabled, dry_run, action, period is not null as periodo from app.retention_policy',
    );
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        dataClass: String(row.data_class) as RetentionClass,
        enabled: row.enabled === true,
        dryRun: row.dry_run === true,
        action: (row.action as PoliticaExpurgo['action']) ?? null,
        periodoPresente: row.periodo === true,
      };
    });
  }

  async simular(politicaId: string, nowMs: number): Promise<{ elegiveis: number; retidos: number }> {
    const res = await this.client.query('select private.retention_dry_run($1::uuid, $2::timestamptz) as r', [
      politicaId,
      iso(nowMs),
    ]);
    const r = (res.rows[0] as { r: { eligible: number; held: number } }).r;
    return { elegiveis: Number(r.eligible), retidos: Number(r.held) };
  }

  async marcarLote(politicaId: string, limite: number, nowMs: number): Promise<readonly string[]> {
    const res = await this.client.query('select private.retention_mark_batch($1::uuid, $2::integer, $3::timestamptz) as ids', [
      politicaId,
      limite,
      iso(nowMs),
    ]);
    const ids = (res.rows[0] as { ids: string[] | null } | undefined)?.ids ?? [];
    return ids.map(String);
  }

  async enfileirarObjeto(politicaId: string, sujeitoId: string, objeto: RetentionObjectRef, nowMs: number): Promise<void> {
    await this.client.query('select private.retention_queue_add($1::uuid, $2::uuid, $3, $4, $5::timestamptz)', [
      politicaId,
      sujeitoId,
      objeto.bucket,
      objeto.path,
      iso(nowMs),
    ]);
  }

  async objetosPendentes(
    politicaId: string,
    sujeitos: readonly string[],
    limite: number,
  ): Promise<readonly ObjetoFila[]> {
    const res = await this.client.query(
      'select id, bucket, object_path from private.retention_queue_pending($1::uuid, $2::uuid[], $3::integer)',
      [politicaId, [...sujeitos], limite],
    );
    return res.rows.map((r) => {
      const row = r as { id: string; bucket: string; object_path: string };
      return {
        id: String(row.id),
        objeto: { bucket: row.bucket as RetentionObjectRef['bucket'], path: row.object_path },
      };
    });
  }

  async registrarRemocao(filaId: string, ok: boolean, nowMs: number): Promise<void> {
    await this.client.query('select private.retention_queue_result($1::uuid, $2::boolean, $3::timestamptz)', [
      filaId,
      ok,
      iso(nowMs),
    ]);
  }

  async finalizarLote(
    politicaId: string,
    sujeitos: readonly string[],
    nowMs: number,
    numeroLote: number,
  ): Promise<ResultadoLote> {
    const res = await this.client.query(
      'select private.retention_finalize_batch($1::uuid, $2::uuid[], $3::timestamptz, $4::integer) as r',
      [politicaId, [...sujeitos], iso(nowMs), numeroLote],
    );
    const r = (res.rows[0] as { r: { processed: number; held: number; failed: number } }).r;
    return { processados: Number(r.processed), suspensos: Number(r.held), falhos: Number(r.failed) };
  }
}

/** Cadastro (apps/api): cada metodo chama uma funcao de cadastro; a regra de permissao esta no banco. */
export class PgRetentionAdmin implements RetentionAdminPort {
  constructor(private readonly client: SqlClient) {}

  async lerPolitica(classe: RetentionClass): Promise<{ id: string; simulacaoRegistrada: boolean } | null> {
    const res = await this.client.query(
      'select id, last_dry_run_at is not null as simulacao from app.retention_policy where data_class = $1',
      [classe],
    );
    const row = res.rows[0] as { id: string; simulacao: boolean } | undefined;
    return row ? { id: String(row.id), simulacaoRegistrada: row.simulacao === true } : null;
  }

  async proporPolitica(
    actorId: string,
    mudanca: MudancaPolitica,
    politicaId: string,
    changeId: string,
    nowMs: number,
  ): Promise<{ approvalRequestId: string }> {
    void politicaId;
    try {
      const res = await this.client.query(
        `select private.retention_policy_propose($1::uuid, $2::uuid, $3, make_interval(secs => $4::double precision),
           $5, $6, $7::timestamptz, $8::boolean, $9::boolean, $10::timestamptz) as aprovacao`,
        [
          actorId,
          changeId,
          mudanca.dataClass,
          mudanca.periodSeconds,
          mudanca.action,
          mudanca.legalBasisRef,
          mudanca.effectiveFrom,
          mudanca.enabled,
          mudanca.dryRun,
          iso(nowMs),
        ],
      );
      return { approvalRequestId: String((res.rows[0] as { aprovacao: string }).aprovacao) };
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async registrarNegacaoPolitica(
    actorId: string,
    classe: RetentionClass,
    motivo: string,
    nowMs: number,
  ): Promise<void> {
    try {
      await this.client.query('select private.retention_policy_denied_record($1::uuid, $2, $3, $4::timestamptz)', [
        actorId,
        classe,
        motivo,
        iso(nowMs),
      ]);
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async votar(
    approvalId: string,
    approverId: string,
    nowMs: number,
  ): Promise<'pendente' | 'aprovada' | 'expirada'> {
    try {
      const res = await this.client.query('select private.admin_approval_vote($1::uuid, $2::uuid, $3::timestamptz) as estado', [
        approvalId,
        approverId,
        iso(nowMs),
      ]);
      return (res.rows[0] as { estado: 'pendente' | 'aprovada' | 'expirada' }).estado;
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async aplicarPolitica(actorId: string, changeId: string, nowMs: number): Promise<void> {
    try {
      await this.client.query('select private.retention_policy_apply($1::uuid, $2::uuid, $3::timestamptz)', [
        actorId,
        changeId,
        iso(nowMs),
      ]);
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async colocarHold(
    actorId: string,
    hold: { subjectType: SujeitoHold; subjectId: string; reasonCode: string },
    nowMs: number,
  ): Promise<{ holdId: string }> {
    try {
      const res = await this.client.query(
        'select private.legal_hold_place($1::uuid, $2, $3::uuid, $4, $5::timestamptz) as id',
        [actorId, hold.subjectType, hold.subjectId, hold.reasonCode, iso(nowMs)],
      );
      return { holdId: String((res.rows[0] as { id: string }).id) };
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async proporLiberacaoHold(actorId: string, holdId: string, nowMs: number): Promise<{ approvalRequestId: string }> {
    try {
      const res = await this.client.query(
        'select private.legal_hold_release_propose($1::uuid, $2::uuid, $3::timestamptz) as aprovacao',
        [actorId, holdId, iso(nowMs)],
      );
      return { approvalRequestId: String((res.rows[0] as { aprovacao: string }).aprovacao) };
    } catch (err) {
      throw erroDoBanco(err);
    }
  }

  async liberarHold(actorId: string, holdId: string, approvalId: string, nowMs: number): Promise<void> {
    try {
      await this.client.query('select private.legal_hold_release_apply($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)', [
        actorId,
        holdId,
        approvalId,
        iso(nowMs),
      ]);
    } catch (err) {
      throw erroDoBanco(err);
    }
  }
}
