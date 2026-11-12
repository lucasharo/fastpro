// H-016 | Adaptador Pg de GET /v1/professional/me (docs/factory/33-DESENHO-H016.md §5.2, §8). So chama
// private.app_session_get (sessao viva) e private.professional_me (estado). O segredo do cookie entra so
// como hash SHA-256; nada e gravado nem devolvido alem do estado.
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';

export interface PgProfessionalAccountMe {
  readonly emailVerified: boolean;
  readonly status: string;
}

export class PgProfessionalAccount {
  constructor(private readonly client: SqlClient) {}

  /** Nulo quando a sessao nao existe, expirou, foi revogada ou nao tem perfil profissional. */
  async me(secret: string, nowMs: number): Promise<PgProfessionalAccountMe | null> {
    const sessao = await this.client.query('select * from private.app_session_get($1, $2::timestamptz)', [
      hashSessionSecret(secret),
      new Date(nowMs).toISOString(),
    ]);
    const linhaSessao = sessao.rows[0] as { out_user_id?: unknown } | undefined;
    if (!linhaSessao || typeof linhaSessao.out_user_id !== 'string') return null;
    const res = await this.client.query('select * from private.professional_me($1)', [linhaSessao.out_user_id]);
    const linha = res.rows[0] as { out_email_verified?: unknown; out_status?: unknown } | undefined;
    if (!linha || typeof linha.out_status !== 'string') return null;
    return { emailVerified: linha.out_email_verified === true, status: linha.out_status };
  }
}
