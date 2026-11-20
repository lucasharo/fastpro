// H-058 (Issue #71) | Limite de taxa do aceite por profissional (docs/factory/162-DESENHO-H058.md, §3.4, decisao 869).
// 20 requisicoes por minuto, sobre private.rl_check e private.rl_hit (ja existentes; sem migracao).
// A chave chega em HMAC pela composicao, com o prefixo "accept:": o id do profissional nunca vai em claro
// ao banco nem aparece em log. Erro do banco segue o caminho do SqlClient (sem texto de driver aqui).
import { clampRetryAfter, type RateWindowDecision } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** 20 por minuto (decisao 869). Janela e bucket de 60 s. */
export const ACCEPTANCE_RATE_LIMIT = { limit: 20, spanSeconds: 60, bucketSeconds: 60 } as const;
export const ACCEPTANCE_RATE_KEY_PREFIX = 'accept:';

const SQL_CHECK =
  'select out_ok, out_retry_after from private.rl_check($1::text, $2::int, $3::int, $4::int, $5::timestamptz)';
const SQL_HIT = 'select private.rl_hit($1::text, $2::int, $3::timestamptz)';

export interface PgAcceptanceRateLimitDeps {
  readonly client: SqlClient;
  /** Devolve o HMAC (hex) do profissional, calculado pela composicao com a chave propria da taxa. */
  readonly chaveDoProfissional: (professionalId: string) => string;
}

export class PgAcceptanceRateLimit {
  constructor(private readonly deps: PgAcceptanceRateLimitDeps) {}

  /** Decide se a requisicao cabe na janela. Barrado devolve Retry-After em segundos, limitado pelo dominio. */
  async check(professionalId: string, nowMs: number): Promise<RateWindowDecision> {
    const res = await this.deps.client.query(SQL_CHECK, [
      this.chave(professionalId),
      ACCEPTANCE_RATE_LIMIT.spanSeconds,
      ACCEPTANCE_RATE_LIMIT.bucketSeconds,
      ACCEPTANCE_RATE_LIMIT.limit,
      new Date(nowMs).toISOString(),
    ]);
    const linha = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof linha?.out_ok !== 'boolean') throw new Error('rate_limit_resposta_invalida');
    if (linha.out_ok) return { decision: 'permitido' };
    return { decision: 'barrado', retryAfterSeconds: clampRetryAfter(Number(linha.out_retry_after)) };
  }

  /** Registra uma requisicao que passou da verificacao no balde do instante. */
  async record(professionalId: string, nowMs: number): Promise<void> {
    await this.deps.client.query(SQL_HIT, [
      this.chave(professionalId),
      ACCEPTANCE_RATE_LIMIT.bucketSeconds,
      new Date(nowMs).toISOString(),
    ]);
  }

  private chave(professionalId: string): string {
    return `${ACCEPTANCE_RATE_KEY_PREFIX}${this.deps.chaveDoProfissional(professionalId)}`;
  }
}
