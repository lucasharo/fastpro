// Adaptadores Pg da entrada do admin por e-mail e senha (migracao 20261127200000), papel app_system.
// E-mail e IP so chegam ao limitador em HMAC (a borda usa PEPPER_EMAIL_HMAC e PEPPER_IP_HMAC).
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ADMIN_LOGIN_EMAIL_LIMIT,
  ADMIN_LOGIN_IP_LIMIT,
  type AdminLoginAttempts,
  type AdminPasswordAccounts,
} from '@fastpro/domain';
import type { AdminLoginChaves } from './admin-login-limits.js';
import { verifyAdminPassword } from './admin-password.js';
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';

const iso = (ms: number): string => new Date(ms).toISOString();

export class PgAdminPasswordAccounts implements AdminPasswordAccounts {
  constructor(private readonly client: SqlClient) {}

  async verify(email: string, password: string): Promise<{ readonly userId: string } | null> {
    const res = await this.client.query('select * from private.admin_password_lookup($1)', [email]);
    const linha = res.rows[0] as { out_user_id?: unknown; out_password_hash?: unknown } | undefined;
    const hash = typeof linha?.out_password_hash === 'string' ? linha.out_password_hash : null;
    const confere = await verifyAdminPassword(password, hash);
    return confere && typeof linha?.out_user_id === 'string' ? { userId: linha.out_user_id } : null;
  }

  /** Sessao de 8 horas; so o hash do segredo vai ao banco. Nulo se a conta deixou de poder entrar. */
  async openSession(userId: string, nowMs: number): Promise<{ readonly secret: string } | null> {
    const secret = randomBytes(32).toString('base64url');
    const res = await this.client.query('select private.admin_session_open($1::uuid, $2::uuid, $3, $4::timestamptz) as ok', [
      randomUUID(),
      userId,
      hashSessionSecret(secret),
      iso(nowMs),
    ]);
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true ? { secret } : null;
  }
}

export class PgAdminLoginAttempts implements AdminLoginAttempts {
  constructor(
    private readonly client: SqlClient,
    private readonly chaves: AdminLoginChaves,
  ) {}

  async reserve(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<boolean> {
    const res = await this.client.query(
      'select private.admin_login_reserve($1, $2, $3::int, $4::int, $5::timestamptz) as ok',
      [this.chaves.email(input.email), this.chaves.ip(input.ip), ADMIN_LOGIN_EMAIL_LIMIT, ADMIN_LOGIN_IP_LIMIT, iso(nowMs)],
    );
    const ok = (res.rows[0] as { ok?: unknown } | undefined)?.ok;
    if (typeof ok !== 'boolean') throw new Error('rate_limit_resposta_invalida');
    return ok;
  }

  async release(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<void> {
    await this.client.query('select private.admin_login_release($1, $2, $3::timestamptz)', [
      this.chaves.email(input.email),
      this.chaves.ip(input.ip),
      iso(nowMs),
    ]);
  }
}
