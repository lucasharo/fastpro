// H-011 | Store Pg, pedido com resposta uniforme, diretorio e decorador de provedor do desafio de
// acesso (docs/factory/39-DESENHO-H011.md, §2 a §5). O pipeline (processOutbox) nao muda: o
// decorador e o diretorio ficam em volta do provedor e do diretorio que ele ja usa.
// Nada aqui loga endereco, token ou codigo; erros carregam so codigos fixos.
import { randomUUID } from 'node:crypto';
import {
  ChallengeInputError,
  CHALLENGE_MAX_CODE_ATTEMPTS,
  CHALLENGE_TTL_SECONDS,
  RATE_GLOBAL_VALUE,
  assertChallengePurpose,
  normalizeChallengeEmail,
  normalizeClientIp,
  rateKeyMessage,
  rateLimited,
  type ChallengePurpose,
  type ClockPort,
  type EmailMessage,
  type EmailProviderPort,
  type RateLimits,
  type RecipientDirectoryPort,
  type RecipientResolution,
  type SendResult,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { processOutbox, SendPacer, type NotificationDeps } from './notifications.js';
import {
  ChallengeCryptoError,
  challengeAad,
  challengeHmacHex,
  challengeSha256Hex,
  generateChallengeCode,
  generateChallengeToken,
  openChallengeBlob,
  sealChallengeBlob,
} from './challenges-crypto.js';

export const ACCESS_TEMPLATE_KEY = 'acesso_login';
export const PURGE_KIND = 'auth.challenge.purge';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Store (porta). A implementacao Pg chama as funcoes private.auth_challenge_*.
// ---------------------------------------------------------------------------------------------

export interface CreateChallengeInput {
  readonly id: string;
  readonly emailHash: string;
  readonly purpose: ChallengePurpose;
  readonly linkHash: string;
  readonly codeHmac: string;
  readonly emailEnc: Buffer;
  readonly secretsEnc: Buffer;
  readonly draftId: string | null;
  readonly nowMs: number;
}

export type CreateChallengeResult =
  | { readonly resultado: 'criado'; readonly challengeId: string; readonly outboxId: string }
  | { readonly resultado: 'espera' | 'teto'; readonly retryAfterSeconds: number };

export interface ChallengeRow {
  readonly id: string;
  /** Vivo: nao usado, nao invalidado e dentro dos 15 min (no instante informado). */
  readonly active: boolean;
  readonly emailEnc: Buffer | null;
  readonly secretsEnc: Buffer | null;
  readonly delivered: boolean;
}

export interface ChallengeStore {
  create(input: CreateChallengeInput): Promise<CreateChallengeResult>;
  findRow(id: string, nowMs: number): Promise<ChallengeRow | null>;
  markDelivered(id: string, nowMs: number): Promise<void>;
  /** H-015: pedido com limites de IP e global (private.auth_challenge_request). Opcional em H-011. */
  request?(input: RequestLimitInput): Promise<RequestChallengeResult>;
  /** H-015: tentativa de codigo com bloqueio (private.auth_code_attempt). Opcional em H-011. */
  attemptCode?(input: AttemptCodeInput): Promise<AttemptCodeResult>;
  /** Desafio vivo do par e-mail + intencao (private.auth_challenge_ativo_id), ou null. */
  activeId?(emailHash: string, purpose: ChallengePurpose, nowMs: number): Promise<string | null>;
}

/** H-015 | Entrada do pedido com limites (50 §1.3 item 3). Chaves sao HMAC; nunca IP em claro. */
export interface RequestLimitInput extends CreateChallengeInput {
  readonly ipHmac: string;
  readonly ipKey: string;
  readonly globalHKey: string;
  readonly globalDKey: string;
  readonly limits: RateLimits;
}

export type RequestChallengeResult =
  | CreateChallengeResult
  | { readonly resultado: 'limite'; readonly retryAfterSeconds: number; readonly motivo: string };

/** H-015 | Entrada da tentativa de codigo (50 §1.3 item 4). */
export interface AttemptCodeInput {
  readonly challengeId: string | null;
  readonly emailHash: string;
  readonly purpose: ChallengePurpose;
  readonly codeHmac: string;
  readonly nowMs: number;
  readonly ipKey: string;
  readonly emailKey: string;
  readonly limits: RateLimits;
}

export type AttemptCodeResult = {
  readonly resultado: 'ok' | 'errado' | 'invalido' | 'bloqueado_codigo' | 'bloqueado_ip';
  readonly retryAfterSeconds: number | null;
};

async function enqueuePurge(client: SqlClient, nowMs: number): Promise<void> {
  // Expurgo diario (39 §2): um job por dia, idempotente pela chave do dia.
  await client.query('select private.job_enqueue($1, $2, null, null, 5)', [
    PURGE_KIND,
    `${PURGE_KIND}:${iso(nowMs).slice(0, 10)}`,
  ]);
}

/** Adaptador Pg do store. Cada metodo e uma chamada SQL atomica. */
export class PgChallengeStore implements ChallengeStore {
  constructor(private readonly client: SqlClient) {}

  async create(input: CreateChallengeInput): Promise<CreateChallengeResult> {
    const res = await this.client.query(
      'select * from private.auth_challenge_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        input.id,
        input.emailHash,
        input.purpose,
        input.linkHash,
        input.codeHmac,
        input.emailEnc,
        input.secretsEnc,
        input.draftId,
        null,
        iso(input.nowMs),
      ],
    );
    const r = res.rows[0] as
      | {
          out_resultado: string;
          out_challenge_id: string | null;
          out_outbox_id: string | null;
          out_retry_after: number | null;
        }
      | undefined;
    if (!r) throw new Error('auth_challenge_create_sem_resultado');
    if (r.out_resultado === 'criado' && r.out_challenge_id && r.out_outbox_id) {
      // Expurgo diario (39 §2): um job por dia, idempotente pela chave do dia.
      await this.client.query('select private.job_enqueue($1, $2, null, null, 5)', [
        PURGE_KIND,
        `${PURGE_KIND}:${iso(input.nowMs).slice(0, 10)}`,
      ]);
      return { resultado: 'criado', challengeId: r.out_challenge_id, outboxId: r.out_outbox_id };
    }
    if (
      (r.out_resultado === 'espera' || r.out_resultado === 'teto') &&
      r.out_retry_after !== null
    ) {
      return { resultado: r.out_resultado, retryAfterSeconds: Number(r.out_retry_after) };
    }
    throw new Error('auth_challenge_create_resultado_inesperado');
  }

  async findRow(id: string, nowMs: number): Promise<ChallengeRow | null> {
    const res = await this.client.query(
      `select id,
              (consumed_at is null and invalidated_at is null and expires_at > $2::timestamptz) as active,
              email_enc, secrets_enc, delivered_at
         from app.auth_challenge where id = $1`,
      [id, iso(nowMs)],
    );
    const r = res.rows[0] as
      | {
          id: string;
          active: boolean;
          email_enc: Buffer | null;
          secrets_enc: Buffer | null;
          delivered_at: unknown;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      active: r.active === true,
      emailEnc: r.email_enc,
      secretsEnc: r.secrets_enc,
      delivered: r.delivered_at !== null && r.delivered_at !== undefined,
    };
  }

  async markDelivered(id: string, nowMs: number): Promise<void> {
    await this.client.query(
      'select private.auth_challenge_mark_delivered($1, $2::timestamptz) as ok',
      [id, iso(nowMs)],
    );
  }

  /** H-015: pedido com limites. Chama private.auth_challenge_request (uma transacao, 50 §1.3). */
  async request(input: RequestLimitInput): Promise<RequestChallengeResult> {
    const res = await this.client.query(
      'select * from private.auth_challenge_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        input.id,
        input.emailHash,
        input.purpose,
        input.linkHash,
        input.codeHmac,
        input.emailEnc,
        input.secretsEnc,
        input.draftId,
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
      | {
          out_resultado: string;
          out_challenge_id: string | null;
          out_outbox_id: string | null;
          out_retry_after: number | null;
          out_motivo: string | null;
        }
      | undefined;
    if (!r) throw new Error('auth_challenge_request_sem_resultado');
    if (r.out_resultado === 'criado' && r.out_challenge_id && r.out_outbox_id) {
      await enqueuePurge(this.client, input.nowMs);
      return { resultado: 'criado', challengeId: r.out_challenge_id, outboxId: r.out_outbox_id };
    }
    if (r.out_resultado === 'limite' && r.out_retry_after !== null && r.out_motivo) {
      return {
        resultado: 'limite',
        retryAfterSeconds: Number(r.out_retry_after),
        motivo: r.out_motivo,
      };
    }
    if (
      (r.out_resultado === 'espera' || r.out_resultado === 'teto') &&
      r.out_retry_after !== null
    ) {
      return { resultado: r.out_resultado, retryAfterSeconds: Number(r.out_retry_after) };
    }
    throw new Error('auth_challenge_request_resultado_inesperado');
  }

  /** H-015: tentativa de codigo com bloqueio. Chama private.auth_code_attempt. */
  async attemptCode(input: AttemptCodeInput): Promise<AttemptCodeResult> {
    const res = await this.client.query(
      'select * from private.auth_code_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        input.challengeId,
        input.emailHash,
        input.purpose,
        input.codeHmac,
        CHALLENGE_MAX_CODE_ATTEMPTS,
        iso(input.nowMs),
        input.ipKey,
        input.emailKey,
        input.limits.codigoIpHora,
        input.limits.erroCodigoDia,
      ],
    );
    const r = res.rows[0] as
      | { out_resultado: string; out_retry_after: number | null }
      | undefined;
    if (!r) throw new Error('auth_code_attempt_sem_resultado');
    const resultado = r.out_resultado as AttemptCodeResult['resultado'];
    if (!['ok', 'errado', 'invalido', 'bloqueado_codigo', 'bloqueado_ip'].includes(resultado)) {
      throw new Error('auth_code_attempt_resultado_inesperado');
    }
    return {
      resultado,
      retryAfterSeconds: r.out_retry_after === null ? null : Number(r.out_retry_after),
    };
  }

  async activeId(emailHash: string, purpose: ChallengePurpose, nowMs: number): Promise<string | null> {
    const res = await this.client.query(
      'select private.auth_challenge_ativo_id($1, $2, $3::timestamptz) as id',
      [emailHash, purpose, iso(nowMs)],
    );
    const r = res.rows[0] as { id: string | null } | undefined;
    return r?.id ?? null;
  }
}

// ---------------------------------------------------------------------------------------------
// Pedido (POST /v1/auth/challenges): resposta uniforme. Nenhuma consulta a conta acontece aqui.
// ---------------------------------------------------------------------------------------------

export interface OutboxDispatchPort {
  /** Agenda o envio da saida logo apos a resposta. Falha aqui nao muda a resposta (contingencia). */
  schedule(outboxId: string): void;
}

export interface ChallengeSecrets {
  /** AUTH_CHALLENGE_KEY decodificada (32 bytes). */
  readonly key: Buffer;
  /** PEPPER_EMAIL_HMAC e PEPPER_CODE_HMAC, lidos pelo chamador. Nunca registrados. */
  readonly pepperEmail: string;
  readonly pepperCode: string;
}

/** H-015 | Limites do pedido e da verificacao (50 §1, §4). Chaves de IP usam PEPPER_IP_HMAC. */
export interface RateContext {
  readonly pepperIp: string;
  readonly limits: RateLimits;
  /** Metricas de contagem (50 §2.7). Nunca recebe e-mail, IP ou codigo. */
  readonly metric?: (name: string, labels: Readonly<Record<string, string>>) => void;
}

export interface RequestChallengeDeps {
  readonly store: ChallengeStore;
  readonly secrets: ChallengeSecrets;
  readonly clock: ClockPort;
  readonly dispatch: OutboxDispatchPort;
  /** Quando presente, o pedido usa os limites de H-015 (exige store.request). */
  readonly rate?: RateContext;
}

export interface ChallengeHttpResponse {
  readonly status: 200 | 202 | 422 | 429;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Pedido de desafio. Mesmo caminho para e-mail cadastrado ou nao (CA-H011-01/03). */
export async function requestChallenge(
  deps: RequestChallengeDeps,
  body: unknown,
  clientIp?: string | null,
): Promise<ChallengeHttpResponse> {
  const raw = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  let email: string;
  let purpose: ChallengePurpose;
  let draftId: string | null;
  try {
    if (typeof raw.email !== 'string') throw new ChallengeInputError('email_invalido');
    email = normalizeChallengeEmail(raw.email);
    if (!EMAIL_SHAPE_RE.test(email)) throw new ChallengeInputError('email_invalido');
    purpose = assertChallengePurpose(typeof raw.purpose === 'string' ? raw.purpose : 'login');
    const d = raw.draft_id;
    if (d === undefined || d === null) {
      draftId = null;
    } else if (typeof d === 'string' && UUID_RE.test(d)) {
      draftId = d;
    } else {
      throw new Error('draft_id_invalido');
    }
  } catch {
    return { status: 422, headers: NO_STORE, body: { code: 'pedido_invalido' } };
  }

  // Trabalho identico para qualquer e-mail: segredos, hashes e cifras sao gerados sempre.
  const id = randomUUID();
  const token = generateChallengeToken();
  const code = generateChallengeCode();
  const base: CreateChallengeInput = {
    id,
    emailHash: challengeHmacHex(deps.secrets.pepperEmail, email),
    purpose,
    linkHash: challengeSha256Hex(token),
    codeHmac: challengeHmacHex(deps.secrets.pepperCode, `${id}|${code}`),
    emailEnc: sealChallengeBlob(deps.secrets.key, email, challengeAad(id, 'email_enc')),
    secretsEnc: sealChallengeBlob(
      deps.secrets.key,
      JSON.stringify({ token, code }),
      challengeAad(id, 'secrets_enc'),
    ),
    draftId,
    nowMs: deps.clock.nowMs(),
  };

  let result: RequestChallengeResult;
  if (deps.rate) {
    if (!deps.store.request) throw new Error('store_sem_limites');
    const ip = normalizeClientIp(clientIp);
    if (ip.ausente) deps.rate.metric?.('rate.ip_ausente', {});
    const pepper = deps.rate.pepperIp;
    result = await deps.store.request({
      ...base,
      ipHmac: challengeHmacHex(pepper, ip.value),
      ipKey: challengeHmacHex(pepper, rateKeyMessage('pedido', 'ip', ip.value)),
      globalHKey: challengeHmacHex(pepper, rateKeyMessage('pedido', 'global_h', RATE_GLOBAL_VALUE)),
      globalDKey: challengeHmacHex(pepper, rateKeyMessage('pedido', 'global_d', RATE_GLOBAL_VALUE)),
      limits: deps.rate.limits,
    });
  } else {
    result = await deps.store.create(base);
  }

  if (result.resultado === 'criado') {
    try {
      deps.dispatch.schedule(result.outboxId);
    } catch {
      // Contingencia: o job email.send criado junto com a saida entrega no proximo tick.
    }
    return { status: 202, headers: NO_STORE, body: { status: 'recebido' } };
  }

  // 429 (50 §2.2): mesma forma para qualquer e-mail, vinda do dominio. Motivo nunca vai ao cliente.
  const recusa = rateLimited('pedido', result.retryAfterSeconds);
  return { status: 429, headers: recusa.headers, body: JSON.parse(recusa.body) as Record<string, unknown> };
}

/** Entrada da verificacao do codigo (sem rota HTTP ainda; H-013 monta a tela). */
export interface VerifyChallengeDeps {
  readonly store: ChallengeStore;
  readonly secrets: ChallengeSecrets;
  readonly clock: ClockPort;
  readonly rate: RateContext;
}

/**
 * Verificacao do codigo (50 §2.5, §3). Errado e invalido geram a mesma resposta; bloqueio do e-mail
 * ou do IP geram 429 com Retry-After. Quem chama deve sempre informar o e-mail (50 §8, H-013).
 */
export async function verifyChallengeCode(
  deps: VerifyChallengeDeps,
  input: { readonly email: string; readonly code: string; readonly purpose: ChallengePurpose; readonly clientIp?: string | null },
): Promise<ChallengeHttpResponse> {
  if (!deps.store.attemptCode || !deps.store.activeId) throw new Error('store_sem_limites');
  let email: string;
  try {
    email = normalizeChallengeEmail(input.email);
  } catch {
    return { status: 422, headers: NO_STORE, body: { code: 'codigo_invalido' } };
  }
  if (!/^\d{6}$/.test(input.code)) {
    return { status: 422, headers: NO_STORE, body: { code: 'codigo_invalido' } };
  }

  const now = deps.clock.nowMs();
  const pepperEmail = deps.secrets.pepperEmail;
  const pepperIp = deps.rate.pepperIp;
  const emailHash = challengeHmacHex(pepperEmail, email);
  // Sem desafio ativo, o codigo ainda passa pelo mesmo caminho (mesmo trabalho, mesmo contador).
  const ativo = await deps.store.activeId(emailHash, input.purpose, now);
  const ip = normalizeClientIp(input.clientIp);
  if (ip.ausente) deps.rate.metric?.('rate.ip_ausente', {});

  const r = await deps.store.attemptCode({
    challengeId: ativo,
    emailHash,
    purpose: input.purpose,
    codeHmac: challengeHmacHex(deps.secrets.pepperCode, `${ativo ?? randomUUID()}|${input.code}`),
    nowMs: now,
    ipKey: challengeHmacHex(pepperIp, rateKeyMessage('codigo', 'ip', ip.value)),
    emailKey: challengeHmacHex(pepperEmail, rateKeyMessage('erro_codigo', 'email', email)),
    limits: deps.rate.limits,
  });

  if (r.resultado === 'ok') {
    return { status: 200, headers: NO_STORE, body: { status: 'codigo_ok' } };
  }
  if (r.resultado === 'bloqueado_codigo' || r.resultado === 'bloqueado_ip') {
    const recusa = rateLimited('codigo', r.retryAfterSeconds ?? 1);
    return { status: 429, headers: recusa.headers, body: JSON.parse(recusa.body) as Record<string, unknown> };
  }
  return { status: 422, headers: NO_STORE, body: { code: 'codigo_invalido' } };
}

/** Envio de uma saida ja criada, com o pacer padrao (chamado pelo dispatch, depois da resposta). */
export async function dispatchChallengeOutbox(
  d: NotificationDeps,
  outboxId: string,
): Promise<void> {
  await processOutbox(d, outboxId, new SendPacer(d.clock));
}

// ---------------------------------------------------------------------------------------------
// Decorador de provedor e diretorio de destinatario (DD-3). So mexe em acesso_login.
// ---------------------------------------------------------------------------------------------

export interface ChallengeEmailOptions {
  readonly key: Buffer;
  /** Base do link (SITE_URL). O segredo vai no fragmento, nunca no caminho. */
  readonly siteUrl: string;
  readonly clock: ClockPort;
}

function recusa(code: string): SendResult {
  return { kind: 'recusa_permanente', code };
}

/** Envolve o provedor real. Monta link e codigo so em memoria, no instante do envio. */
export class ChallengeEmailProvider implements EmailProviderPort {
  readonly name: string;

  constructor(
    private readonly inner: EmailProviderPort,
    private readonly store: ChallengeStore,
    private readonly opts: ChallengeEmailOptions,
  ) {
    this.name = inner.name;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (message.templateKey !== ACCESS_TEMPLATE_KEY) return this.inner.send(message);

    const id = message.params.challenge_ref;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return recusa('desafio_inativo');
    const now = this.opts.clock.nowMs();
    const row = await this.store.findRow(id, now);
    if (!row || !row.active) return recusa('desafio_inativo');
    if (row.delivered) return { kind: 'aceito', providerMessageId: 'ja_entregue' };
    if (!row.secretsEnc) return recusa('segredo_indisponivel');

    let token: string;
    let code: string;
    try {
      const segredos = JSON.parse(
        openChallengeBlob(this.opts.key, row.secretsEnc, challengeAad(id, 'secrets_enc')),
      ) as { token: string; code: string };
      token = segredos.token;
      code = segredos.code;
    } catch (err) {
      const codigo = err instanceof ChallengeCryptoError ? err.code : 'segredo_indisponivel';
      return recusa(codigo);
    }

    const result = await this.inner.send({
      ...message,
      params: {
        link: `${this.opts.siteUrl}/acesso#t=${token}`,
        code,
        minutos: CHALLENGE_TTL_SECONDS / 60,
      },
    });
    if (result.kind === 'aceito') await this.store.markDelivered(id, now);
    return result;
  }
}

/** Diretorio do desafio: id de desafio resolve o endereco cifrado; qualquer outro id vai ao base. */
export class ChallengeRecipientDirectory implements RecipientDirectoryPort {
  constructor(
    private readonly base: RecipientDirectoryPort,
    private readonly store: ChallengeStore,
    private readonly key: Buffer,
    private readonly clock: ClockPort,
  ) {}

  async resolve(recipientUserId: string): Promise<RecipientResolution> {
    if (!UUID_RE.test(recipientUserId)) return this.base.resolve(recipientUserId);
    const row = await this.store.findRow(recipientUserId, this.clock.nowMs());
    if (!row) return this.base.resolve(recipientUserId);
    if (!row.active || !row.emailEnc) return { status: 'inexistente' };
    return {
      status: 'ok',
      email: openChallengeBlob(this.key, row.emailEnc, challengeAad(recipientUserId, 'email_enc')),
    };
  }
}
