// H-016 | Adaptador do cadastro, da verificacao e do login por senha do profissional (docs/factory/
// 33-DESENHO-H016.md §3 a §5; 67-DESENHO-H016.md §6). So chama as funcoes private.professional_*
// (migracao 20261111400000) e o Supabase Auth por HTTP. A senha entra aqui so para ir ao Auth: nunca
// e guardada, logada ou devolvida. O token do link sai so para o envio, e o banco guarda o hash.
import { randomUUID } from 'node:crypto';
import {
  challengeHmacHex,
  challengeSha256Hex,
  generateChallengeToken,
} from './challenges-crypto.js';
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';
import {
  type ProfessionalAuthPort,
  type ProfessionalCredential,
  type ProfessionalGateOutcome,
} from '@fastpro/domain';

/** Prefixo de finalidade da chave do contador: separa do HMAC de outros usos do mesmo e-mail. */
export const PROFESSIONAL_LOGIN_KEY_PURPOSE = 'professional-login|';

/** Conferencia e criacao de usuario no Supabase Auth (chave secreta so no servidor). */
export interface ProfessionalAuthGateway {
  /** Cria o usuario com e-mail confirmado. 'existente' quando o e-mail ja existe no Auth. */
  createUser(email: string, password: string): Promise<{ readonly authUserId: string } | 'existente'>;
  /** Remove o usuario do Auth (compensacao quando o banco recusa). */
  deleteUser(authUserId: string): Promise<void>;
  /** Confere a senha. Nulo para senha errada ou usuario inexistente. Nao guarda os tokens devolvidos. */
  signInWithPassword(email: string, password: string): Promise<{ readonly authUserId: string } | null>;
}

/** Envio do link de verificacao (Mailpit em dev; a fila de e-mail entra na proxima etapa). */
export interface ProfessionalMailPort {
  verificationLink(email: string, token: string): Promise<void>;
}

export interface PgProfessionalAuthDeps {
  readonly client: SqlClient;
  readonly gateway: ProfessionalAuthGateway;
  readonly mail: ProfessionalMailPort;
  /** PEPPER_EMAIL_HMAC: chave do HMAC do e-mail (email_hash e chave do contador). */
  readonly pepperEmail: string;
  /** Identificadores novos (padrao: UUID aleatorio). Injetado nos testes. */
  readonly newId?: () => string;
  /** Segredos novos (padrao: 32 bytes em base64url). Injetado nos testes. */
  readonly newSecret?: () => string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function linhaUnica(rows: unknown[]): Record<string, unknown> | undefined {
  return rows[0] as Record<string, unknown> | undefined;
}

export class PgProfessionalAuth implements ProfessionalAuthPort {
  private readonly newId: () => string;
  private readonly newSecret: () => string;

  constructor(private readonly deps: PgProfessionalAuthDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.newSecret = deps.newSecret ?? generateChallengeToken;
  }

  private emailHash(email: string): string {
    return challengeHmacHex(this.deps.pepperEmail, email);
  }

  private loginKey(email: string): string {
    return challengeHmacHex(this.deps.pepperEmail, `${PROFESSIONAL_LOGIN_KEY_PURPOSE}${email}`);
  }

  /**
   * Cadastro (33 §3.2): Auth primeiro, depois a transacao do banco. Se o banco recusar ou o e-mail ja
   * existir no banco, o usuario recem-criado no Auth e removido. Em 'existente' nada e enviado.
   */
  async register(email: string, password: string, nowMs: number): Promise<void> {
    const criado = await this.deps.gateway.createUser(email, password);
    if (criado === 'existente') return;

    const userId = this.newId();
    const challengeId = this.newId();
    const token = this.newSecret();
    let resultado: string | undefined;
    try {
      const res = await this.deps.client.query(
        'select * from private.professional_register_create($1, $2, $3, $4, $5, $6, $7::timestamptz)',
        [
          userId,
          criado.authUserId,
          email,
          this.emailHash(email),
          challengeId,
          challengeSha256Hex(token),
          iso(nowMs),
        ],
      );
      resultado = String(linhaUnica(res.rows)?.out_resultado ?? '');
    } catch (err) {
      await this.deps.gateway.deleteUser(criado.authUserId).catch(() => undefined);
      throw err;
    }
    if (resultado !== 'criado') {
      await this.deps.gateway.deleteUser(criado.authUserId);
      return;
    }
    await this.deps.mail.verificationLink(email, token);
  }

  async confirmVerification(token: string, nowMs: number): Promise<boolean> {
    const res = await this.deps.client.query(
      'select * from private.professional_verify_confirm($1, $2::timestamptz)',
      [challengeSha256Hex(token), iso(nowMs)],
    );
    return res.rows.length > 0;
  }

  async loginGate(email: string, nowMs: number): Promise<ProfessionalGateOutcome> {
    const res = await this.deps.client.query(
      'select * from private.professional_login_gate($1, $2::timestamptz)',
      [this.loginKey(email), iso(nowMs)],
    );
    const linha = linhaUnica(res.rows);
    if (linha?.out_bloqueada === true) {
      return { kind: 'bloqueada', retryAfterSeconds: Number(linha.out_retry_after) };
    }
    return { kind: 'tentativa' };
  }

  async verifyPassword(email: string, password: string): Promise<ProfessionalCredential | null> {
    const auth = await this.deps.gateway.signInWithPassword(email, password);
    if (auth === null) return null;
    const res = await this.deps.client.query('select * from private.professional_account_by_email($1)', [
      email,
    ]);
    const linha = linhaUnica(res.rows);
    if (!linha || String(linha.out_auth_user_id) !== auth.authUserId) {
      return { userId: '', emailVerified: false, active: false };
    }
    return {
      userId: String(linha.out_user_id),
      emailVerified: linha.out_verified === true,
      active: linha.out_active === true,
    };
  }

  async loginSucceeded(email: string): Promise<void> {
    await this.deps.client.query('select private.professional_login_success($1)', [this.loginKey(email)]);
  }

  async openSession(
    credential: ProfessionalCredential,
    nowMs: number,
  ): Promise<{ readonly secret: string }> {
    const secret = this.newSecret();
    const res = await this.deps.client.query(
      'select * from private.professional_session_open($1, $2, $3, $4::timestamptz)',
      [this.newId(), credential.userId, hashSessionSecret(secret), iso(nowMs)],
    );
    if (res.rows.length === 0) throw new Error('sessao_nao_aberta');
    return { secret };
  }
}

export interface SupabaseAuthConfig {
  /** SUPABASE_URL, sem barra final. */
  readonly url: string;
  /** Chave secreta de administracao do Auth, so no servidor (ver docs/factory). Nunca no navegador nem em log. */
  readonly secretKey: string;
  /** Chave publica (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) para o login por senha. */
  readonly publishableKey: string;
  readonly fetch?: typeof fetch;
}

async function corpoJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const valor = (await res.json()) as unknown;
    return valor !== null && typeof valor === 'object' ? (valor as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Supabase Auth por HTTP (plano gratuito; sem SDK). Erros nunca carregam e-mail, senha ou token:
 * a mensagem traz so o passo e o status.
 */
export class SupabaseAuthGateway implements ProfessionalAuthGateway {
  constructor(private readonly cfg: SupabaseAuthConfig) {}

  private get base(): string {
    return this.cfg.url.replace(/\/+$/, '');
  }

  private get http(): typeof fetch {
    return this.cfg.fetch ?? fetch;
  }

  private adminHeaders(): Record<string, string> {
    return {
      apikey: this.cfg.secretKey,
      Authorization: `Bearer ${this.cfg.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createUser(email: string, password: string): Promise<{ readonly authUserId: string } | 'existente'> {
    const res = await this.http(`${this.base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.adminHeaders(),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (res.ok) {
      const corpo = await corpoJson(res);
      if (typeof corpo.id !== 'string') throw new Error('auth_createUser_resposta_invalida');
      return { authUserId: corpo.id };
    }
    const corpo = await corpoJson(res);
    if (corpo.error_code === 'email_exists' || corpo.error_code === 'user_already_exists') return 'existente';
    throw new Error(`auth_createUser_${res.status}`);
  }

  async deleteUser(authUserId: string): Promise<void> {
    const res = await this.http(`${this.base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`auth_deleteUser_${res.status}`);
  }

  async signInWithPassword(email: string, password: string): Promise<{ readonly authUserId: string } | null> {
    const res = await this.http(`${this.base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.cfg.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 400 || res.status === 401) return null;
    if (!res.ok) throw new Error(`auth_token_${res.status}`);
    const corpo = await corpoJson(res);
    const user = corpo.user as { id?: unknown } | undefined;
    if (typeof user?.id !== 'string') throw new Error('auth_token_resposta_invalida');
    return { authUserId: user.id };
  }
}
