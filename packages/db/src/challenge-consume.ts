// H-012 | Consumo do link por POST: handler, adaptadores Pg e autenticacao admin (porta).
// Desenho: docs/factory/46-DESENHO-H012.md, §1 a §5. A ordem e fixa: consumo primeiro (uma chamada
// a private.auth_challenge_consume_link_attach), depois conta, depois etapa de identificacao.
// H-013 (91 §1.3, §1.4): a conclusao (conta, etapa, cookie) e concluirAcesso, a mesma do codigo de 6 digitos.
// Nada aqui loga e-mail, token ou segredo; falhas viram codigos fixos.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ACCOUNT_DEADLINE_MS,
  ACCOUNT_MAX_ATTEMPTS,
  CONSUME_HEADERS,
  identCookieHeader,
  type ClockPort,
  type ConsumeFailureCode,
  type CustomerAccountPort,
  type CustomerAccountResult,
  type SessionStageStore,
  type OpenStageInput,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import {
  challengeAad,
  challengeHmacHex,
  challengeSha256Hex,
  loadChallengeKey,
  openChallengeBlob,
} from './challenges-crypto.js';

// ---------------------------------------------------------------------------------------------
// Portas do consumo (o consumo em si e a etapa vem de domain; o repositorio e daqui).
// ---------------------------------------------------------------------------------------------

export type ConsumeLinkResult =
  | {
      readonly resultado: 'ok';
      readonly challengeId: string;
      readonly purpose: string;
      readonly emailEnc: Buffer;
      readonly draftId: string | null;
      /** H-013: o rascunho do mesmo navegador foi anexado. Nunca vai a resposta; so a metrica. */
      readonly attached: boolean;
    }
  | { readonly resultado: 'invalido' };

export interface ConsumeRepository {
  /**
   * Uma chamada atomica: consome o link (uso unico), anexa o rascunho do navegador (H-013) e devolve o
   * e-mail cifrado, se 'ok'. browserNonceHash e o SHA-256 do cookie __Host-fp_draft, ou null.
   */
  consumeLink(tokenHash: string, nowMs: number, browserNonceHash: string | null): Promise<ConsumeLinkResult>;
}

/** Resultado do Auth admin: criado, ou o e-mail ja existe no Auth (sem usuario local). */
export type AuthCreateResult =
  | { readonly status: 'criado'; readonly authUserId: string }
  | { readonly status: 'ja_existe' };

/** Porta do Auth admin (implementacao real fica para quando houver credencial de desenvolvimento). */
export interface AuthUserAdminPort {
  createUser(email: string): Promise<AuthCreateResult>;
}

/**
 * Dependencias da conclusao do acesso (conta, etapa, cookie). ConsumeDeps e um superconjunto: o codigo de
 * 6 digitos (H-013) usa estas mesmas dependencias, sem caminho proprio de sessao.
 */
export interface AccessDeps {
  readonly accounts: CustomerAccountPort;
  readonly stages: SessionStageStore;
  /** Decifra o e-mail do desafio (AAD = id do desafio). Lanca em falha; nunca registra o valor. */
  readonly decryptEmail: (emailEnc: Buffer, challengeId: string) => string;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  /** Segredo do cookie: 32 bytes em base64url (43 caracteres). */
  readonly newSecret: () => string;
  readonly newSessionId: () => string;
  /** Orcamento de cada tentativa da conta; padrao ACCOUNT_DEADLINE_MS (8 s). */
  readonly accountDeadlineMs?: number;
  /** Metrica sem PII: recebe so o codigo fixo da falha pos-consumo. */
  readonly onFailure?: (codigo: ConsumeFailureCode) => void;
}

export interface ConsumeDeps extends AccessDeps {
  readonly repo: ConsumeRepository;
}

/** Desafio ja consumido (link ou codigo), com o que a conclusao precisa. */
export interface AccessLink {
  readonly challengeId: string;
  readonly purpose: string;
  readonly emailEnc: Buffer;
  readonly draftId: string | null;
}

/** ok: etapa aberta e cookie pronto. Falhas: codigo fixo (quem chama registra a metrica); 'conta_bloqueada' nao e falha nossa. */
export type AccessOutcome =
  | { readonly ok: true; readonly setCookie: string }
  | { readonly ok: false; readonly codigo: ConsumeFailureCode | 'conta_bloqueada' };

export interface ConsumeResponse {
  readonly status: 200 | 400 | 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, string>>;
  /** So no 200 (46 §2 e §4). */
  readonly setCookie?: string;
}

const LINK_INVALIDO: ConsumeResponse = {
  status: 400,
  headers: CONSUME_HEADERS,
  body: { code: 'link_invalido' },
};

function linkInvalido(): ConsumeResponse {
  return LINK_INVALIDO;
}

export function notificarFalha(deps: { readonly onFailure?: (codigo: ConsumeFailureCode) => void }, codigo: ConsumeFailureCode): void {
  try {
    deps.onFailure?.(codigo);
  } catch {
    // Metrica nunca altera a resposta.
  }
}

function indisponivel(deps: AccessDeps, codigo: ConsumeFailureCode): ConsumeResponse {
  notificarFalha(deps, codigo);
  return { status: 503, headers: CONSUME_HEADERS, body: { code: 'acesso_indisponivel' } };
}

/** Limita a espera de uma chamada; o prazo esgotado vira erro (e a tentativa e refeita). */
function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('prazo_esgotado')), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Ate ACCOUNT_MAX_ATTEMPTS tentativas. So falha transitoria (ou erro/prazo) gera nova tentativa. */
async function garantirConta(
  deps: AccessDeps,
  email: string,
  nowMs: number,
): Promise<CustomerAccountResult> {
  const prazo = deps.accountDeadlineMs ?? ACCOUNT_DEADLINE_MS;
  for (let tentativa = 1; tentativa <= ACCOUNT_MAX_ATTEMPTS; tentativa++) {
    try {
      const r = await comPrazo(deps.accounts.ensureCustomer(email, nowMs), prazo);
      if (r.status !== 'falha') return r;
    } catch {
      // Erro de rede, prazo ou 5xx/429 do Auth: a operacao e idempotente, tenta de novo.
    }
  }
  return { status: 'falha' };
}

/**
 * Conclusao do acesso depois do consumo (H-012 §2 e §4; H-013 §1.4): decifra o e-mail, garante a conta,
 * abre a etapa de identificacao e devolve o cookie. Link e codigo chamam esta mesma funcao. Falha nossa
 * devolve o codigo fixo; quem chama registra a metrica (uma vez) e decide a resposta HTTP.
 */
export async function concluirAcesso(deps: AccessDeps, link: AccessLink, nowMs: number): Promise<AccessOutcome> {
  let email: string;
  try {
    email = deps.decryptEmail(link.emailEnc, link.challengeId);
  } catch {
    return { ok: false, codigo: 'consumo_falha_decifra' };
  }

  const conta = await garantirConta(deps, email, nowMs);
  if (conta.status === 'bloqueado') return { ok: false, codigo: 'conta_bloqueada' };
  if (conta.status === 'falha') {
    return { ok: false, codigo: 'consumo_falha_conta' };
  }

  const secret = deps.newSecret();
  const entrada: OpenStageInput = {
    sessionId: deps.newSessionId(),
    userId: conta.userId,
    challengeId: link.challengeId,
    purpose: link.purpose,
    draftId: link.draftId,
    hashDoSegredo: challengeSha256Hex(secret),
    nowMs,
  };
  let aberta: boolean;
  try {
    aberta = await deps.stages.openStage(entrada);
  } catch {
    aberta = false;
  }
  if (!aberta) return { ok: false, codigo: 'consumo_falha_etapa' };
  return { ok: true, setCookie: identCookieHeader(secret) };
}

/** Contexto do consumo: o nonce do navegador (SHA-256 do cookie do rascunho), quando houver cookie. */
export interface ConsumeContext {
  readonly browserNonceHash?: string | null;
}

/**
 * Consumo do link (POST, corpo ja validado). `token` e qualquer texto de ate 512 caracteres.
 * Uma unica chamada ao repositorio; link invalido de qualquer tipo recebe a mesma resposta.
 */
export async function consumeChallenge(
  deps: ConsumeDeps,
  token: string,
  ctx: ConsumeContext = {},
): Promise<ConsumeResponse> {
  const nowMs = deps.clock.nowMs();

  let link: ConsumeLinkResult;
  try {
    link = await deps.repo.consumeLink(challengeSha256Hex(token), nowMs, ctx.browserNonceHash ?? null);
  } catch {
    // Falha antes do consumo (ou anexacao desfeita junto): nada foi gasto, resposta de falha nossa.
    return indisponivel(deps, 'consumo_falha_banco');
  }
  if (link.resultado !== 'ok') return linkInvalido();

  // A partir daqui o link ja esta gasto. Falha nossa responde 503, nunca link_invalido (D-H012-4).
  const r = await concluirAcesso(
    deps,
    { challengeId: link.challengeId, purpose: link.purpose, emailEnc: link.emailEnc, draftId: link.draftId },
    nowMs,
  );
  if (!r.ok) {
    if (r.codigo === 'conta_bloqueada') return linkInvalido();
    return indisponivel(deps, r.codigo);
  }
  return {
    status: 200,
    headers: CONSUME_HEADERS,
    body: { status: 'identificado' },
    setCookie: r.setCookie,
  };
}

// ---------------------------------------------------------------------------------------------
// Adaptadores Pg. Cada metodo e uma chamada SQL atomica (funcoes private.*, papel app_system).
// ---------------------------------------------------------------------------------------------

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface ConsumeRow {
  out_resultado: string;
  out_challenge_id: string | null;
  out_purpose: string | null;
  out_email_enc: Buffer | null;
  out_draft_id: string | null;
  out_attached: boolean | null;
}

export class PgConsumeRepository implements ConsumeRepository {
  constructor(private readonly client: SqlClient) {}

  async consumeLink(tokenHash: string, nowMs: number, browserNonceHash: string | null): Promise<ConsumeLinkResult> {
    const res = await this.client.query(
      'select * from private.auth_challenge_consume_link_attach($1, $2::timestamptz, $3)',
      [tokenHash, iso(nowMs), browserNonceHash],
    );
    const r = res.rows[0] as ConsumeRow | undefined;
    if (!r) throw new Error('auth_challenge_consume_sem_resultado');
    if (r.out_resultado !== 'ok') return { resultado: 'invalido' };
    if (!r.out_challenge_id || !r.out_purpose || !r.out_email_enc) {
      throw new Error('auth_challenge_consume_incompleto');
    }
    return {
      resultado: 'ok',
      challengeId: r.out_challenge_id,
      purpose: r.out_purpose,
      emailEnc: r.out_email_enc,
      draftId: r.out_draft_id,
      attached: r.out_attached === true,
    };
  }
}

export class PgSessionStageStore implements SessionStageStore {
  constructor(private readonly client: SqlClient) {}

  async openStage(input: OpenStageInput): Promise<boolean> {
    const res = await this.client.query(
      'select private.app_session_open_stage($1, $2, $3, $4, $5, $6, $7::timestamptz) as id',
      [
        input.sessionId,
        input.userId,
        input.challengeId,
        input.purpose,
        input.draftId,
        input.hashDoSegredo,
        iso(input.nowMs),
      ],
    );
    const r = res.rows[0] as { id: unknown } | undefined;
    return typeof r?.id === 'string';
  }
}

interface UserFindRow {
  out_user_id: string;
  out_status: string;
}

/**
 * Conta do cliente: procura o usuario local pelo e-mail; se nao houver, cria no Auth e grava a
 * linha (idempotente). Usuario bloqueado devolve 'bloqueado' (link_invalido, sem sessao).
 */
export class PgCustomerAccounts implements CustomerAccountPort {
  /**
   * emailHash (H-097, F-1): HMAC do e-mail normalizado (PEPPER_EMAIL_HMAC), o mesmo do pedido de login.
   * Quando informado, grava app.app_user.email_hmac pela private.app_user_set_email_hmac (idempotente).
   */
  constructor(
    private readonly client: SqlClient,
    private readonly authAdmin: AuthUserAdminPort,
    private readonly emailHash?: (email: string) => string,
  ) {}

  private async gravarHmac(userId: string, email: string): Promise<void> {
    if (this.emailHash === undefined) return;
    await this.client.query('select private.app_user_set_email_hmac($1::uuid, $2) as ok', [
      userId,
      this.emailHash(email),
    ]);
  }

  async ensureCustomer(email: string, nowMs: number): Promise<CustomerAccountResult> {
    const achado = await this.client.query('select * from private.app_user_find($1)', [email]);
    const existente = achado.rows[0] as UserFindRow | undefined;
    if (existente) {
      await this.gravarHmac(existente.out_user_id, email);
      return existente.out_status === 'ativo'
        ? { status: 'ok', userId: existente.out_user_id }
        : { status: 'bloqueado' };
    }

    const criado = await this.authAdmin.createUser(email);
    // 'ja_existe' sem usuario local: a busca no Auth por e-mail nao foi provada (NAO VERIFICADO).
    if (criado.status !== 'criado') return { status: 'falha' };

    const gravado = await this.client.query(
      'select * from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      [email, criado.authUserId, iso(nowMs)],
    );
    const linha = gravado.rows[0] as UserFindRow | undefined;
    if (!linha) return { status: 'falha' };
    await this.gravarHmac(linha.out_user_id, email);
    return linha.out_status === 'ativo'
      ? { status: 'ok', userId: linha.out_user_id }
      : { status: 'bloqueado' };
  }
}

/** Segredo do cookie: 256 bits aleatorios em base64url (43 caracteres). */
export function newIdentSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function newUuid(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------------------------
// Composicao: liga o handler aos adaptadores Pg. A chave de cifra vem do ambiente (AUTH_CHALLENGE_KEY)
// e nunca e registrada; sem ela a composicao falha com erro de configuracao, sem valor.
// ---------------------------------------------------------------------------------------------

export interface ConsumeWiring {
  readonly client: SqlClient;
  readonly authAdmin: AuthUserAdminPort;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly env?: NodeJS.ProcessEnv;
  readonly accountDeadlineMs?: number;
  readonly onFailure?: (codigo: ConsumeFailureCode) => void;
}

/** Dependencias da conclusao do acesso montadas a partir da fiacao (sem o repositorio do consumo). */
export function buildAccessDeps(w: ConsumeWiring): AccessDeps {
  const key = loadChallengeKey(w.env);
  const pepperEmail = (w.env ?? process.env).PEPPER_EMAIL_HMAC;
  return {
    accounts: new PgCustomerAccounts(
      w.client,
      w.authAdmin,
      pepperEmail !== undefined ? (email) => challengeHmacHex(pepperEmail, email) : undefined,
    ),
    stages: new PgSessionStageStore(w.client),
    decryptEmail: (emailEnc, challengeId) =>
      openChallengeBlob(key, emailEnc, challengeAad(challengeId, 'email_enc')),
    clock: w.clock,
    newSecret: newIdentSecret,
    newSessionId: newUuid,
    accountDeadlineMs: w.accountDeadlineMs,
    onFailure: w.onFailure,
  };
}

export function buildConsumeDeps(w: ConsumeWiring): ConsumeDeps {
  return {
    ...buildAccessDeps(w),
    repo: new PgConsumeRepository(w.client),
  };
}
