// H-019 | Adaptadores Pg da busca de servico (docs/factory/64-DESENHO-H019.md, §2, §3.1, §3.3).
// Recebem um SqlClient injetado (sem abrir conexao, sem ler variavel de ambiente). A composicao decide
// a conexao e a chave do limite de taxa. O IP nunca vai ao banco em claro: so o HMAC dele.
import { createHmac } from 'node:crypto';
import { CATALOG_SEARCH_RATE, CATALOG_SEARCH_RETRY_AFTER_S } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Chave minima do HMAC do limite de taxa (256 bits em base 16 ou equivalente). */
export const CATALOG_RATE_KEY_MIN_LENGTH = 32;
export const CATALOG_RATE_KEY_PREFIX = 'catalog_search:' as const;

export interface CatalogSearchConnection extends SqlClient {
  release(): void;
}

export interface CatalogSqlTxLike {
  query(text: string, params: readonly unknown[]): Promise<readonly unknown[]>;
}

/**
 * Transacao curta numa conexao dedicada (pega do pool e devolvida ao fim). Commit se fn termina;
 * rollback e repasse do erro se nao. O rollback que falha nao mascara o erro original.
 */
export class PgCatalogSqlRunner {
  constructor(private readonly connect: () => Promise<CatalogSearchConnection>) {}

  async transaction<T>(fn: (tx: CatalogSqlTxLike) => Promise<T>): Promise<T> {
    const conn = await this.connect();
    try {
      await conn.query('begin');
      try {
        const out = await fn({
          query: async (text, params) => (await conn.query(text, [...params])).rows,
        });
        await conn.query('commit');
        return out;
      } catch (erro) {
        await conn.query('rollback').catch(() => undefined);
        throw erro;
      }
    } finally {
      conn.release();
    }
  }
}

export const SQL_RL_CHECK =
  'select out_ok, out_retry_after from private.rl_check($1, $2, $3, $4, $5::timestamptz)';
export const SQL_RL_HIT = 'select private.rl_hit($1, $2, $3::timestamptz)';

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Limite de taxa da busca (CATALOG_SEARCH_RATE: 90 por 60 s por IP) via private.rl_check/rl_hit.
 * A chave do balde e 'catalog_search:' + HMAC-SHA256(ip). Chave ausente ou curta: erro na composicao.
 */
export class PgCatalogRateLimit {
  constructor(
    private readonly client: SqlClient,
    private readonly hmacKey: string,
    private readonly nowMs: () => number,
  ) {
    if (hmacKey.length < CATALOG_RATE_KEY_MIN_LENGTH) throw new Error('chave_taxa_busca_invalida');
  }

  private chave(ip: string): string {
    const digest = createHmac('sha256', this.hmacKey).update(ip, 'utf8').digest('hex');
    return `${CATALOG_RATE_KEY_PREFIX}${digest}`;
  }

  async check(ip: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly retryAfterS: number }> {
    const { spanS, bucketS, limit } = CATALOG_SEARCH_RATE;
    const res = await this.client.query(SQL_RL_CHECK, [
      this.chave(ip),
      spanS,
      bucketS,
      limit,
      iso(this.nowMs()),
    ]);
    const row = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof row?.out_ok !== 'boolean') throw new Error('rl_resposta_invalida');
    if (row.out_ok) return { ok: true };
    const espera = typeof row.out_retry_after === 'number' ? row.out_retry_after : CATALOG_SEARCH_RETRY_AFTER_S;
    return { ok: false, retryAfterS: espera };
  }

  async hit(ip: string): Promise<void> {
    await this.client.query(SQL_RL_HIT, [this.chave(ip), CATALOG_SEARCH_RATE.bucketS, iso(this.nowMs())]);
  }
}
