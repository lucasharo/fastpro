// H-016 | Contador de envios do cadastro e do reenvio sobre ops.rate_counter (private.rl_check e
// private.rl_hit, ja existentes; sem migracao nova). A chave chega em HMAC pela composicao (33 §3.1, §4.4):
// e-mail e IP nunca vao em claro ao banco. Porta: ProfessionalSendLimitPort (@fastpro/domain).
import {
  clampRetryAfter,
  type ProfessionalSendLimitPort,
  type ProfessionalSendRuleSpec,
  type RateWindowDecision,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

const SQL_CHECK =
  'select out_ok, out_retry_after from private.rl_check($1::text, $2::int, $3::int, $4::int, $5::timestamptz)';
const SQL_HIT = 'select private.rl_hit($1::text, $2::int, $3::timestamptz)';

export interface PgProfessionalSendLimitDeps {
  readonly client: SqlClient;
  /** Chave HMAC (64 hex) da regra e do valor (e-mail normalizado ou IP). */
  readonly chave: (spec: ProfessionalSendRuleSpec) => string;
}

export class PgProfessionalSendLimit implements ProfessionalSendLimitPort {
  constructor(private readonly deps: PgProfessionalSendLimitDeps) {}

  async check(spec: ProfessionalSendRuleSpec, nowMs: number): Promise<RateWindowDecision> {
    const res = await this.deps.client.query(SQL_CHECK, [
      this.deps.chave(spec),
      spec.spanSeconds,
      spec.bucketSeconds,
      spec.limit,
      new Date(nowMs).toISOString(),
    ]);
    const linha = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof linha?.out_ok !== 'boolean') throw new Error('rate_limit_resposta_invalida');
    if (linha.out_ok) return { decision: 'permitido' };
    return { decision: 'barrado', retryAfterSeconds: clampRetryAfter(Number(linha.out_retry_after)) };
  }

  async record(spec: ProfessionalSendRuleSpec, nowMs: number): Promise<void> {
    await this.deps.client.query(SQL_HIT, [
      this.deps.chave(spec),
      spec.bucketSeconds,
      new Date(nowMs).toISOString(),
    ]);
  }
}
