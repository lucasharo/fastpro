// H-014 | Repositorio Pg da sessao de 7 dias (docs/factory/52-DESENHO-H014.md §1 a §4). So chama as
// funcoes private.app_session_* (migracao 20261111180000) e as do step-up (migracao 20261111310000).
// Recebe e devolve hashes; o segredo em claro nunca chega aqui. Sem regra de negocio: a decisao de
// conversao, de guarda e de janela esta no SQL e em @fastpro/domain (session.ts, step-up.ts).
import { randomUUID } from 'node:crypto';
import type { AuthMethod, SessionRecord, SessionRepositoryPort, StepUpRequest } from '@fastpro/domain';
import {
  CHALLENGE_MAX_CODE_ATTEMPTS,
  RATE_GLOBAL_VALUE,
  normalizeChallengeEmail,
  normalizeClientIp,
  rateKeyMessage,
  type RateLimits,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import {
  challengeAad,
  challengeHmacHex,
  challengeSha256Hex,
  generateChallengeCode,
  generateChallengeToken,
  sealChallengeBlob,
} from './challenges-crypto.js';

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

// ---------------------------------------------------------------------------------------------
// H-014 | Codigo de step-up (52 §4.2 e §4.3). Reaproveita o desafio de H-011 e os limites de H-015.
// ---------------------------------------------------------------------------------------------

/** Segredos do desafio (nunca registrados). A chave cifra o e-mail; os peppers geram hashes e HMACs. */
export interface StepUpSecrets {
  /** AUTH_CHALLENGE_KEY decodificada (32 bytes). */
  readonly key: Buffer;
  readonly pepperEmail: string;
  readonly pepperCode: string;
  readonly pepperIp: string;
}

export type StepUpRequestOutcome =
  | { readonly resultado: 'criado'; readonly outboxId: string }
  | {
      readonly resultado: 'limite' | 'espera' | 'teto' | 'negado';
      readonly retryAfterSeconds: number | null;
    };

export type StepUpVerifyOutcome =
  | { readonly resultado: 'ok' | 'errado' | 'invalido' | 'negado' }
  | {
      readonly resultado: 'bloqueado_codigo' | 'bloqueado_ip';
      readonly retryAfterSeconds: number | null;
    };

const RESULTADOS_PEDIDO = new Set(['criado', 'limite', 'espera', 'teto', 'negado']);
const RESULTADOS_PROVA = new Set(['ok', 'errado', 'invalido', 'negado', 'bloqueado_codigo', 'bloqueado_ip']);

/** Adaptador Pg do step-up: so chama private.step_up_* e le o e-mail e o desafio vivo. */
export class PgStepUpStore {
  constructor(private readonly client: SqlClient) {}

  /** E-mail da pessoa (app_user.email). Nulo se a conta nao existir. */
  async emailOfUser(userId: string): Promise<string | null> {
    const res = await this.client.query('select email from app.app_user where id = $1', [userId]);
    const r = res.rows[0] as { email?: unknown } | undefined;
    return typeof r?.email === 'string' ? r.email : null;
  }

  /** Desafio vivo de step-up do e-mail (de qualquer sessao; a sessao e conferida no SQL). */
  async activeChallengeId(emailHash: string, nowMs: number): Promise<string | null> {
    const res = await this.client.query(
      "select private.auth_challenge_ativo_id($1, 'step_up', $2::timestamptz) as id",
      [emailHash, iso(nowMs)],
    );
    const r = res.rows[0] as { id?: string | null } | undefined;
    return r?.id ?? null;
  }

  async request(input: {
    readonly sessionId: string;
    readonly id: string;
    readonly emailHash: string;
    readonly linkDigest: string;
    readonly codeHmac: string;
    readonly emailEnc: Buffer;
    readonly secretsEnc: Buffer;
    readonly ipHmac: string;
    readonly nowMs: number;
    readonly ipKey: string;
    readonly globalHKey: string;
    readonly globalDKey: string;
    readonly limits: RateLimits;
  }): Promise<StepUpRequestOutcome> {
    const res = await this.client.query(
      'select * from private.step_up_request($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13,$14,$15)',
      [
        input.sessionId,
        input.id,
        input.emailHash,
        input.linkDigest,
        input.codeHmac,
        input.emailEnc,
        input.secretsEnc,
        input.ipHmac,
        iso(input.nowMs),
        input.ipKey,
        input.globalHKey,
        input.globalDKey,
        input.limits.pedidoIpHora,
        input.limits.pedidoGlobalHora,
        input.limits.pedidoGlobalDia,
      ],
    );
    const r = res.rows[0] as
      | { out_resultado: string; out_outbox_id: unknown; out_retry_after: unknown }
      | undefined;
    if (!r || !RESULTADOS_PEDIDO.has(r.out_resultado)) throw new Error('step_up_request_resultado_inesperado');
    if (r.out_resultado === 'criado') {
      if (r.out_outbox_id === null) throw new Error('step_up_request_sem_saida');
      return { resultado: 'criado', outboxId: String(r.out_outbox_id) };
    }
    return {
      resultado: r.out_resultado as 'limite' | 'espera' | 'teto' | 'negado',
      retryAfterSeconds: r.out_retry_after === null ? null : Number(r.out_retry_after),
    };
  }

  async verify(input: {
    readonly sessionId: string;
    readonly challengeId: string | null;
    readonly emailHash: string;
    readonly codeHmac: string;
    readonly nowMs: number;
    readonly ipKey: string;
    readonly emailKey: string;
    readonly limits: RateLimits;
  }): Promise<StepUpVerifyOutcome> {
    const res = await this.client.query(
      'select * from private.step_up_verify($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10)',
      [
        input.sessionId,
        input.challengeId,
        input.emailHash,
        input.codeHmac,
        CHALLENGE_MAX_CODE_ATTEMPTS,
        iso(input.nowMs),
        input.ipKey,
        input.emailKey,
        input.limits.codigoIpHora,
        input.limits.erroCodigoDia,
      ],
    );
    const r = res.rows[0] as { out_resultado: string; out_retry_after: unknown } | undefined;
    if (!r || !RESULTADOS_PROVA.has(r.out_resultado)) throw new Error('step_up_verify_resultado_inesperado');
    if (r.out_resultado === 'bloqueado_codigo' || r.out_resultado === 'bloqueado_ip') {
      return {
        resultado: r.out_resultado,
        retryAfterSeconds: r.out_retry_after === null ? null : Number(r.out_retry_after),
      };
    }
    return { resultado: r.out_resultado as 'ok' | 'errado' | 'invalido' | 'negado' };
  }
}

export interface StepUpCodeDeps {
  readonly store: PgStepUpStore;
  readonly secrets: StepUpSecrets;
  readonly clock: { nowMs(): number };
  readonly limits: RateLimits;
}

/**
 * Pedido do codigo de step-up (52 §4.3). Trabalho identico para qualquer sessao: segredo, hashes e
 * cifra sao gerados sempre. O token do link e descartado (ninguem o recebe; o link nao consome este
 * desafio). Quem chama envia a saida (outboxId) e responde 202, ou 429/401 conforme o resultado.
 */
export async function requestStepUpCode(
  deps: StepUpCodeDeps,
  session: SessionRecord,
  clientIp: string | null | undefined,
): Promise<StepUpRequestOutcome> {
  const emailRaw = await deps.store.emailOfUser(session.userId);
  if (emailRaw === null) return { resultado: 'negado', retryAfterSeconds: null };
  const email = normalizeChallengeEmail(emailRaw);

  const id = randomUUID();
  const token = generateChallengeToken();
  const code = generateChallengeCode();
  const ip = normalizeClientIp(clientIp);
  const pepperIp = deps.secrets.pepperIp;
  return deps.store.request({
    sessionId: session.sessionId,
    id,
    emailHash: challengeHmacHex(deps.secrets.pepperEmail, email),
    linkDigest: challengeSha256Hex(token),
    codeHmac: challengeHmacHex(deps.secrets.pepperCode, `${id}|${code}`),
    emailEnc: sealChallengeBlob(deps.secrets.key, email, challengeAad(id, 'email_enc')),
    // So o codigo vai ao envio (sem token de link): mesmo AAD de secrets_enc de H-011.
    secretsEnc: sealChallengeBlob(
      deps.secrets.key,
      JSON.stringify({ code }),
      challengeAad(id, 'secrets_enc'),
    ),
    ipHmac: challengeHmacHex(pepperIp, ip.value),
    nowMs: deps.clock.nowMs(),
    ipKey: challengeHmacHex(pepperIp, rateKeyMessage('pedido', 'ip', ip.value)),
    globalHKey: challengeHmacHex(pepperIp, rateKeyMessage('pedido', 'global_h', RATE_GLOBAL_VALUE)),
    globalDKey: challengeHmacHex(pepperIp, rateKeyMessage('pedido', 'global_d', RATE_GLOBAL_VALUE)),
    limits: deps.limits,
  });
}

/** Resposta da prova do step-up na rota (mesma forma de StepUpProofPort em apps/api). */
export type CodeProofOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 401 | 422 | 429; readonly code: string };

/**
 * Prova por codigo (52 §4.2, CodeProof). Desafio vivo do e-mail; o HMAC do codigo usa o id do
 * desafio (como em H-011). Sem desafio vivo, a tentativa segue o mesmo caminho e conta erro.
 * Codigo certo grava recent_auth_at no mesmo SQL que consome o desafio.
 */
export class CodeProof {
  constructor(private readonly deps: StepUpCodeDeps) {}

  async verify(
    session: SessionRecord,
    body: StepUpRequest,
    nowMs: number,
    clientIp?: string | null,
  ): Promise<CodeProofOutcome> {
    if (!body.ok || body.method !== 'code') return { ok: false, status: 422, code: 'metodo_invalido' };

    const emailRaw = await this.deps.store.emailOfUser(session.userId);
    if (emailRaw === null) return { ok: false, status: 401, code: 'nao_autenticado' };
    const email = normalizeChallengeEmail(emailRaw);

    const { secrets, store, limits } = this.deps;
    const emailHash = challengeHmacHex(secrets.pepperEmail, email);
    const ativo = await store.activeChallengeId(emailHash, nowMs);
    const ip = normalizeClientIp(clientIp);
    const r = await store.verify({
      sessionId: session.sessionId,
      challengeId: ativo,
      emailHash,
      codeHmac: challengeHmacHex(secrets.pepperCode, `${ativo ?? randomUUID()}|${body.code}`),
      nowMs,
      ipKey: challengeHmacHex(secrets.pepperIp, rateKeyMessage('codigo', 'ip', ip.value)),
      emailKey: challengeHmacHex(secrets.pepperEmail, rateKeyMessage('erro_codigo', 'email', email)),
      limits,
    });

    if (r.resultado === 'ok') return { ok: true };
    if (r.resultado === 'bloqueado_codigo' || r.resultado === 'bloqueado_ip') {
      return { ok: false, status: 429, code: 'muitas_tentativas' };
    }
    if (r.resultado === 'negado') return { ok: false, status: 401, code: 'nao_autenticado' };
    return { ok: false, status: 422, code: 'codigo_invalido' };
  }
}
