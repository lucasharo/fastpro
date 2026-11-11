// H-014 | Repositorio Pg da sessao de 7 dias (docs/factory/52-DESENHO-H014.md §1 a §3). So chama as
// funcoes private.app_session_* (migracao 20261111180000). Recebe e devolve hashes; o segredo em
// claro nunca chega aqui. Sem regra de negocio: a decisao de conversao e de guarda esta no SQL e em
// @fastpro/domain (session.ts).
import type { AuthMethod, SessionRecord, SessionRepositoryPort } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { challengeSha256Hex } from './challenges-crypto.js';

/** Hash SHA-256 (hex) do segredo do cookie. Mesmo algoritmo da etapa (H-012). */
export function hashSessionSecret(secret: string): string {
  return challengeSha256Hex(secret);
}

const iso = (ms: number): string => new Date(ms).toISOString();

function paraMs(valor: unknown): number {
  const ms = new Date(valor as string | number | Date).getTime();
  if (!Number.isFinite(ms)) throw new Error('data_invalida');
  return ms;
}

function metodo(valor: unknown): AuthMethod {
  if (valor === 'link' || valor === 'password') return valor;
  throw new Error('auth_method_invalido');
}

export class PgSessionRepository implements SessionRepositoryPort {
  constructor(private readonly client: SqlClient) {}

  async convertStage(
    oldHash: string,
    newHash: string,
    nowMs: number,
  ): Promise<{ readonly sessionId: string; readonly userId: string; readonly absoluteExpiresAtMs: number } | null> {
    const res = await this.client.query(
      'select * from private.app_session_convert($1, $2, $3::timestamptz)',
      [oldHash, newHash, iso(nowMs)],
    );
    const row = res.rows[0] as
      | { out_session_id: unknown; out_user_id: unknown; out_absolute_expires_at: unknown }
      | undefined;
    if (!row) return null;
    return {
      sessionId: String(row.out_session_id),
      userId: String(row.out_user_id),
      absoluteExpiresAtMs: paraMs(row.out_absolute_expires_at),
    };
  }

  async authenticate(hash: string, nowMs: number): Promise<SessionRecord | null> {
    const res = await this.client.query('select * from private.app_session_get($1, $2::timestamptz)', [
      hash,
      iso(nowMs),
    ]);
    const row = res.rows[0] as
      | {
          out_session_id: unknown;
          out_user_id: unknown;
          out_recent_auth_at: unknown;
          out_auth_method: unknown;
        }
      | undefined;
    if (!row) return null;
    return {
      sessionId: String(row.out_session_id),
      userId: String(row.out_user_id),
      recentAuthAtMs: row.out_recent_auth_at === null ? null : paraMs(row.out_recent_auth_at),
      authMethod: metodo(row.out_auth_method),
    };
  }

  async revoke(sessionId: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(
      'select private.app_session_revoke($1, $2::timestamptz) as ok',
      [sessionId, iso(nowMs)],
    );
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }

  async revokeAll(userId: string, nowMs: number): Promise<number> {
    const res = await this.client.query(
      'select private.app_session_revoke_all($1, $2::timestamptz) as n',
      [userId, iso(nowMs)],
    );
    return Number((res.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
  }

  async markRecentAuth(sessionId: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(
      'select private.app_session_mark_recent_auth($1, $2::timestamptz) as ok',
      [sessionId, iso(nowMs)],
    );
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }
}
