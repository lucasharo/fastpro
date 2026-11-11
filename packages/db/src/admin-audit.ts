// H-104 (#113) | Adaptadores Pg da consulta a auditoria (docs/factory/63-DESENHO-H104.md §1 e §5).
// Recebem o segredo do cookie e o convertem em hash SHA-256 antes de qualquer chamada ao banco; o
// segredo em claro nunca sai deste modulo. So chamam private.audit_query (role app_system). Sem regra de
// negocio: validacao, autoridade e teto de 90 dias estao no SQL e em @fastpro/domain (audit-query.ts).
import type { AuditQueryInput, AuditQueryPage, AuditQueryPort } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';

const iso = (ms: number): string => new Date(ms).toISOString();

const SQL_AUDIT_QUERY = `select private.audit_query($1::uuid, $2::text, $3::timestamptz, $4::timestamptz,
  $5::text, $6::text, $7::uuid, $8::bigint, $9::int, $10::timestamptz) as page`;

/**
 * Porta de leitura da trilha. Erros do banco sobem como estao (com `code` = SQLSTATE ou ADM30/ADM31);
 * quem traduz para 404/403/422/503 e o dominio (mapAuditQueryDbError), sem eco de dado.
 */
export class PgAuditQueryPort implements AuditQueryPort {
  constructor(private readonly client: SqlClient) {}

  async query(input: AuditQueryInput): Promise<AuditQueryPage> {
    const res = await this.client.query(SQL_AUDIT_QUERY, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      iso(input.fromMs),
      iso(input.toMs),
      input.action,
      input.objectType,
      input.objectId,
      input.cursor,
      input.limit,
      iso(input.nowMs),
    ]);
    const row = res.rows[0] as { page?: unknown } | undefined;
    if (row?.page === undefined || row.page === null || typeof row.page !== 'object') {
      throw new Error('auditoria_resposta_invalida');
    }
    return row.page as AuditQueryPage;
  }
}
