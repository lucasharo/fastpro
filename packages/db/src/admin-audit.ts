// H-104 (Issue 113) | Adaptadores Pg da consulta a auditoria (docs/factory/63-DESENHO-H104.md §1 e §5).
// Recebem o segredo do cookie e o convertem em hash SHA-256 antes de qualquer chamada ao banco; o
// segredo em claro nunca sai deste modulo. So chamam private.audit_query (role app_system). Sem regra de
// negocio: validacao, autoridade e teto de 90 dias estao no SQL e em @fastpro/domain (audit-query.ts).
import {
  AUDIT_QUERY_RATE_LIMIT,
  AUDIT_QUERY_RATE_WINDOW_MS,
  type AuditQueryInput,
  type AuditQueryPage,
  type AuditQueryPort,
  type AuditQueryRateLimit,
} from '@fastpro/domain';
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

const SQL_RATE_TAKE = 'select private.audit_query_rate_take($1::uuid, $2::timestamptz, $3::int, $4::int) as ok';

/**
 * Limite de consultas por admin (30 em 5 min, 63 R-2): uma chamada confere a janela e consome a vaga
 * na mesma transacao, com trava por admin no banco (private.audit_query_rate_take). Nao ha leitura
 * separada: duas consultas concorrentes nao passam do limite. Vaga consumida = true.
 */
export class PgAuditQueryRateLimit implements AuditQueryRateLimit {
  constructor(
    private readonly client: SqlClient,
    private readonly limit: number = AUDIT_QUERY_RATE_LIMIT,
    private readonly windowSeconds: number = AUDIT_QUERY_RATE_WINDOW_MS / 1000,
  ) {}

  async take(adminUserId: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_RATE_TAKE, [
      adminUserId,
      iso(nowMs),
      this.limit,
      this.windowSeconds,
    ]);
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }
}
