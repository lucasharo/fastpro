// H-073 (Issue 83) / H-015 (50 §3) | Limites de tentativas do login admin (AdminLoginLimits) sobre o limitador
// generico de identidade: private.rl_check e private.rl_hit (ops.rate_counter). Sem migracao nova. As chaves
// chegam ja em HMAC (a borda usa PEPPER_EMAIL_HMAC e PEPPER_IP_HMAC): e-mail e IP nunca vao em claro ao banco.
// counts devolve o limite quando a chave esta bloqueada (o dominio so compara com o limite); nao e uma contagem.
// As duas chamadas (conferir e registrar) nao sao atomicas; o bloqueio chega com a proxima tentativa.
import { ADMIN_LOGIN_EMAIL_LIMIT, ADMIN_LOGIN_IP_LIMIT, type AdminLoginCounts, type AdminLoginLimits } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Janela de 15 min (H-015) com balde de 1 min. */
export const ADMIN_LOGIN_SPAN_S = 15 * 60;
export const ADMIN_LOGIN_BUCKET_S = 60;

export interface AdminLoginChaves {
  /** Chave HMAC (64 hex) do e-mail. */
  readonly email: (email: string) => string;
  /** Chave HMAC (64 hex) do IP. */
  readonly ip: (ip: string) => string;
}

const SQL_CHECK =
  'select out_ok from private.rl_check($1::text, $2::int, $3::int, $4::int, $5::timestamptz)';
const SQL_HIT = 'select private.rl_hit($1::text, $2::int, $3::timestamptz)';

export class PgAdminLoginLimits implements AdminLoginLimits {
  constructor(
    private readonly client: SqlClient,
    private readonly chaves: AdminLoginChaves,
  ) {}

  async counts(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<AdminLoginCounts> {
    const email = await this.bloqueada(this.chaves.email(input.email), ADMIN_LOGIN_EMAIL_LIMIT, nowMs);
    const ip = await this.bloqueada(this.chaves.ip(input.ip), ADMIN_LOGIN_IP_LIMIT, nowMs);
    return {
      email: email ? ADMIN_LOGIN_EMAIL_LIMIT : 0,
      ip: ip ? ADMIN_LOGIN_IP_LIMIT : 0,
    };
  }

  async recordFailure(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<void> {
    await this.client.query(SQL_HIT, [this.chaves.email(input.email), ADMIN_LOGIN_BUCKET_S, new Date(nowMs).toISOString()]);
    await this.client.query(SQL_HIT, [this.chaves.ip(input.ip), ADMIN_LOGIN_BUCKET_S, new Date(nowMs).toISOString()]);
  }

  /** Bloqueada quando a janela ja tem `limite` falhas (rl_check devolve ok enquanto houver vaga). */
  private async bloqueada(chave: string, limite: number, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_CHECK, [
      chave,
      ADMIN_LOGIN_SPAN_S,
      ADMIN_LOGIN_BUCKET_S,
      limite,
      new Date(nowMs).toISOString(),
    ]);
    const ok = (res.rows[0] as { out_ok?: unknown } | undefined)?.out_ok;
    if (typeof ok !== 'boolean') throw new Error('rate_limit_resposta_invalida');
    return !ok;
  }
}
