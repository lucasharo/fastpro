// H-016 | Adaptador Pg da recuperacao e da redefinicao de senha do profissional (docs/factory/33-DESENHO-H016.md
// §6.1; 67-DESENHO-H016.md §6). So chama private.professional_challenge_create, private.password_reset_peek,
// private.password_reset_consume e private.professional_login_success (migracao 20261112100500) e o Auth por
// gateway. A senha vai so ao Auth; o token do link sai so para o envio e o banco guarda o hash.
// Ordem da redefinicao: confere o link (peek), troca a senha no Auth, consome o link (consume). Se o consumo
// perder a corrida, a senha ja trocou: risco R-H016-9 (aceito e registrado no desenho 33 §6.1, passo 4).
import { randomUUID } from 'node:crypto';
import { challengeHmacHex, challengeSha256Hex, generateChallengeToken } from './challenges-crypto.js';
import type { SqlClient } from './jobs-tick.js';
import { PROFESSIONAL_LOGIN_KEY_PURPOSE, type ProfessionalAuthGateway } from './professional-auth.js';

export type RecoveryPurpose = 'password_reset' | 'professional_activate';

/** Envio do link de recuperacao ou de ativacao (Mailpit em dev; envio real desligado ate o lancamento). */
export interface RecoveryMailPort {
  recoveryLink(email: string, token: string, purpose: RecoveryPurpose): Promise<void>;
  verificationLink(email: string, token: string): Promise<void>;
  passwordChangedNotice(email: string): Promise<void>;
}

export interface PgProfessionalRecoveryDeps {
  readonly client: SqlClient;
  readonly gateway: ProfessionalAuthGateway;
  readonly mail: RecoveryMailPort;
  /** PEPPER_EMAIL_HMAC: chave do HMAC do e-mail (email_hash e chave do contador de login). */
  readonly pepperEmail: string;
  readonly newId?: () => string;
  readonly newSecret?: () => string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

interface AlvoRedefinicao {
  readonly userId: string;
  readonly authUserId: string;
  readonly email: string;
}

export class PgProfessionalRecovery {
  private readonly newId: () => string;
  private readonly newSecret: () => string;

  constructor(private readonly deps: PgProfessionalRecoveryDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.newSecret = deps.newSecret ?? generateChallengeToken;
  }

  private emailHash(email: string): string {
    return challengeHmacHex(this.deps.pepperEmail, email);
  }

  private loginKey(email: string): string {
    return challengeHmacHex(this.deps.pepperEmail, `${PROFESSIONAL_LOGIN_KEY_PURPOSE}${email}`);
  }

  /** Reenvio do link de verificacao: so para conta profissional ainda nao verificada (professional_verify). */
  async resendVerification(email: string, nowMs: number): Promise<void> {
    const token = this.newSecret();
    const res = await this.deps.client.query(
      'select * from private.professional_challenge_create($1, $2, $3, $4, $5, $6::timestamptz)',
      [email, this.emailHash(email), 'professional_verify', this.newId(), challengeSha256Hex(token), iso(nowMs)],
    );
    if (res.rows.length > 0) await this.deps.mail.verificationLink(email, token);
  }

  /**
   * Pedido de recuperacao. Tenta primeiro o profissional (password_reset); cliente verificado sem perfil
   * recebe o convite de ativacao (professional_activate). Nada se aplica: nada e criado nem enviado.
   */
  async requestRecovery(email: string, nowMs: number): Promise<void> {
    for (const purpose of ['password_reset', 'professional_activate'] as const) {
      const token = this.newSecret();
      const res = await this.deps.client.query(
        'select * from private.professional_challenge_create($1, $2, $3, $4, $5, $6::timestamptz)',
        [email, this.emailHash(email), purpose, this.newId(), challengeSha256Hex(token), iso(nowMs)],
      );
      if (res.rows.length > 0) {
        await this.deps.mail.recoveryLink(email, token, purpose);
        return;
      }
    }
  }

  /** Confere o link sem consumir. Nulo quando nao serve. */
  async peekReset(token: string, nowMs: number): Promise<{ readonly email: string } | null> {
    const alvo = await this.peekCompleto(token, nowMs);
    return alvo === null ? null : { email: alvo.email };
  }

  private async peekCompleto(token: string, nowMs: number): Promise<AlvoRedefinicao | null> {
    const res = await this.deps.client.query('select * from private.password_reset_peek($1, $2::timestamptz)', [
      challengeSha256Hex(token),
      iso(nowMs),
    ]);
    const linha = res.rows[0] as
      | { out_user_id?: unknown; out_auth_user_id?: unknown; out_email?: unknown }
      | undefined;
    if (!linha || typeof linha.out_email !== 'string' || typeof linha.out_auth_user_id !== 'string') return null;
    return {
      userId: String(linha.out_user_id),
      authUserId: linha.out_auth_user_id,
      email: linha.out_email,
    };
  }

  /** Troca a senha e consome o link. Falha do Auth lanca (o link continua valido). */
  async resetPassword(token: string, newPassword: string, nowMs: number): Promise<boolean> {
    const alvo = await this.peekCompleto(token, nowMs);
    if (alvo === null) return false;
    await this.deps.gateway.updatePassword(alvo.authUserId, newPassword);
    const res = await this.deps.client.query('select * from private.password_reset_consume($1, $2::timestamptz)', [
      challengeSha256Hex(token),
      iso(nowMs),
    ]);
    const consumido = res.rows[0] as { out_email?: unknown } | undefined;
    if (!consumido || typeof consumido.out_email !== 'string') return false;
    // Troca bem-sucedida zera o contador de login da conta (33 §6.1, passo 3).
    await this.deps.client.query('select private.professional_login_success($1)', [this.loginKey(consumido.out_email)]);
    // Aviso informativo (33 §6.1, passo 3): falha de envio nao desfaz a troca.
    try {
      await this.deps.mail.passwordChangedNotice(consumido.out_email);
    } catch {
      // Sem dado pessoal em log; o aviso pode ser reenviado pelo suporte depois do lancamento.
    }
    return true;
  }
}
