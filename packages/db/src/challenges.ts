// H-011 | Store Pg, pedido com resposta uniforme, diretorio e decorador de provedor do desafio de
// acesso (docs/factory/39-DESENHO-H011.md, §2 a §5). O pipeline (processOutbox) nao muda: o
// decorador e o diretorio ficam em volta do provedor e do diretorio que ele ja usa.
// Nada aqui loga endereco, token ou codigo; erros carregam so codigos fixos.
import { randomUUID } from 'node:crypto';
import {
  ChallengeInputError,
  CHALLENGE_TTL_SECONDS,
  assertChallengePurpose,
  normalizeChallengeEmail,
  type ChallengePurpose,
  type ClockPort,
  type EmailMessage,
  type EmailProviderPort,
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

export interface RequestChallengeDeps {
  readonly store: ChallengeStore;
  readonly secrets: ChallengeSecrets;
  readonly clock: ClockPort;
  readonly dispatch: OutboxDispatchPort;
}

export interface ChallengeHttpResponse {
  readonly status: 202 | 422 | 429;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Pedido de desafio. Mesmo caminho para e-mail cadastrado ou nao (CA-H011-01/03). */
export async function requestChallenge(
  deps: RequestChallengeDeps,
  body: unknown,
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
  const result = await deps.store.create({
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
  });

  if (result.resultado === 'criado') {
    try {
      deps.dispatch.schedule(result.outboxId);
    } catch {
      // Contingencia: o job email.send criado junto com a saida entrega no proximo tick.
    }
    return { status: 202, headers: NO_STORE, body: { status: 'recebido' } };
  }

  const retry = result.retryAfterSeconds;
  return {
    status: 429,
    headers: { ...NO_STORE, 'Retry-After': String(retry) },
    body: { code: 'muitos_pedidos', retry_after_seconds: retry },
  };
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
