// H-016 | Adaptador Pg da troca de senha do profissional logado (docs/factory/33-DESENHO-H016.md §6.2; CA-H016-20).
// So chama private.app_session_get (sessao viva e prova recente), private.professional_me (conta do Auth e
// estado), private.professional_sessions_revoke_others (mantem a sessao atual) e o Auth por gateway. A senha
// vai so ao Auth. O aviso de troca nunca faz a troca falhar: falha de envio so e registrada, sem dados pessoais.
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';
import type { ProfessionalAuthGateway } from './professional-auth.js';

/** Aviso informativo de senha alterada (33 §6.1; Mailpit em dev; envio real desligado ate o lancamento). */
export interface PasswordNoticePort {
  passwordChangedNotice(email: string): Promise<void>;
}

export interface PgProfessionalPasswordDeps {
  readonly client: SqlClient;
  readonly gateway: ProfessionalAuthGateway;
  readonly mail: PasswordNoticePort;
  /** Registro de falha do aviso, sem e-mail nem dados pessoais. Padrao: nenhum. */
  readonly evento?: (nome: string) => void;
}

export interface PgSessionAccount {
  readonly sessionId: string;
  readonly userId: string;
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly recentAuthAtMs: number | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function paraMs(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const ms = new Date(valor as string | number | Date).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export class PgProfessionalPassword {
  constructor(private readonly deps: PgProfessionalPasswordDeps) {}

  /** Sessao viva com perfil profissional, ou nulo (sessao de cliente, expirada, revogada ou inexistente). */
  async sessionAccount(secret: string, nowMs: number): Promise<PgSessionAccount | null> {
    const sessao = await this.deps.client.query('select * from private.app_session_get($1, $2::timestamptz)', [
      hashSessionSecret(secret),
      iso(nowMs),
    ]);
    const s = sessao.rows[0] as
      | { out_session_id?: unknown; out_user_id?: unknown; out_recent_auth_at?: unknown }
      | undefined;
    if (!s || typeof s.out_session_id !== 'string' || typeof s.out_user_id !== 'string') return null;
    const res = await this.deps.client.query('select * from private.professional_me($1)', [s.out_user_id]);
    const p = res.rows[0] as
      | { out_auth_user_id?: unknown; out_email?: unknown; out_email_verified?: unknown; out_active?: unknown }
      | undefined;
    if (!p || typeof p.out_auth_user_id !== 'string' || typeof p.out_email !== 'string' || p.out_active !== true) {
      return null;
    }
    return {
      sessionId: s.out_session_id,
      userId: s.out_user_id,
      authUserId: p.out_auth_user_id,
      email: p.out_email,
      emailVerified: p.out_email_verified === true,
      recentAuthAtMs: paraMs(s.out_recent_auth_at),
    };
  }

  /** Troca no Auth, revoga as outras sessoes e envia o aviso. Falha do Auth lanca (nada muda). */
  async changePassword(conta: PgSessionAccount, novaSenha: string, nowMs: number): Promise<void> {
    await this.deps.gateway.updatePassword(conta.authUserId, novaSenha);
    await this.deps.client.query('select private.professional_sessions_revoke_others($1, $2, $3::timestamptz)', [
      conta.userId,
      conta.sessionId,
      iso(nowMs),
    ]);
    try {
      await this.deps.mail.passwordChangedNotice(conta.email);
    } catch {
      this.deps.evento?.('professional_aviso_senha_falhou');
    }
  }
}
