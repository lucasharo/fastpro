// H-025 | Servico do rascunho (docs/factory/74-DESENHO-H025.md, §1 a §3; R1, R3, R6).
// Ordem fixa depois do corpo: rascunho vivo -> limite de taxa -> escrita no banco. O limite de taxa so
// conta depois que a escrita foi aceita. Nenhum erro interno sai daqui: falha de escrita vira 503 na rota.
import {
  DRAFT_NOT_FOUND_BODY,
  DRAFT_HEADERS,
  DRAFT_RATE_CRIACAO_DIA,
  DRAFT_RATE_CRIACAO_HORA,
  DRAFT_RATE_SALVAR_IP,
  DRAFT_RATE_SALVAR_RASCUNHO,
  DRAFT_CLEAR_COOKIE_HEADER,
  DRAFT_CAP_RETRY_S,
  DRAFT_LIVE_CAP_DEFAULT,
  DRAFT_RATE_LEITURA_IP,
  draftCookieHeader,
  rateLimited,
  toDraftView,
  type DraftFieldsPatch,
  type DraftIdentityRecord,
  type DraftIdentityStorePort,
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftStoreError,
  type DraftStorePort,
  type DraftWriteResult,
  type IdentityFields,
  DRAFT_RATE_CONFIRMAR_IP,
  DRAFT_RATE_CONFIRMAR_RASCUNHO,
  DRAFT_TTL_DAYS,
  decideReview,
  type DraftReviewStorePort,
} from '@fastpro/domain';
import type { DraftHasher } from './draft-hash.js';

export interface DraftClockPort {
  nowMs(): number;
}

/** H-013 (91 §1.5): identificacao do rascunho. O HMAC do e-mail vem da composicao (PEPPER_EMAIL_HMAC). */
export interface DraftIdentityDeps {
  readonly store: DraftIdentityStorePort;
  readonly emailHmac: (email: string) => string;
}

export interface DraftDeps {
  readonly store: DraftStorePort;
  readonly rate: DraftRatePort;
  readonly hasher: DraftHasher;
  /** Gera o segredo de um rascunho novo. Injetado para o teste; em producao, newDraftSecret. */
  readonly newSecret: () => string;
  readonly clock: DraftClockPort;
  /** Teto global de rascunhos vivos. Padrao DRAFT_LIVE_CAP_DEFAULT (5.000). */
  readonly liveCap?: number;
  /** Identificacao (nome e e-mail). Ausente: as rotas /identity respondem 404. */
  readonly identity?: DraftIdentityDeps;
  /** H-030: revisao e confirmacao expressa. Ausente: as rotas /review e /confirm respondem 404. */
  readonly review?: DraftReviewStorePort;
}

/** Resposta pronta para a rota: status, cabecalhos e corpo ja serializado (vazio no 204). */
export interface DraftOutcome {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function json(status: number, corpo: unknown, extra: Readonly<Record<string, string>> = {}): DraftOutcome {
  return { status, headers: { ...DRAFT_HEADERS, ...extra }, body: JSON.stringify(corpo) };
}

/** 404 uniforme: o mesmo corpo e os mesmos cabecalhos para sem cookie, malformado, outro, vencido e descartado. */
export function draftNotFound(): DraftOutcome {
  return json(404, DRAFT_NOT_FOUND_BODY);
}

function erroDeEscrita(code: DraftStoreError): DraftOutcome {
  if (code === 'servico_invalido') return json(422, { code: 'servico_invalido' });
  // Teto global: 429 neutro, mesma forma do limite por IP (sem revelar o numero).
  if (code === 'teto_global') return resposta429(DRAFT_CAP_RETRY_S);
  return draftNotFound();
}

/** Maior Retry-After entre as politicas que barraram; null quando nenhuma barrou. */
async function barradoPor(
  rate: DraftRatePort,
  pares: readonly (readonly [DraftRatePolicy, string])[],
  nowMs: number,
): Promise<number | null> {
  let pior: number | null = null;
  for (const [policy, chave] of pares) {
    const r = await rate.check(policy, chave, nowMs);
    if (!r.ok && (pior === null || r.retryAfterS > pior)) pior = r.retryAfterS;
  }
  return pior;
}

function resposta429(retryAfterS: number): DraftOutcome {
  const r = rateLimited('pedido', retryAfterS);
  return { status: 429, headers: r.headers, body: r.body };
}

async function contar(
  rate: DraftRatePort,
  pares: readonly (readonly [DraftRatePolicy, string])[],
  nowMs: number,
): Promise<void> {
  for (const [policy, chave] of pares) await rate.hit(policy, chave, nowMs);
}

/** Criacao de rascunho: 10 por hora e 50 por dia por IP-HMAC (R1, CA-10). */
function paresCriacao(ipHmac: string): readonly (readonly [DraftRatePolicy, string])[] {
  return [
    [DRAFT_RATE_CRIACAO_HORA, ipHmac],
    [DRAFT_RATE_CRIACAO_DIA, ipHmac],
  ];
}

/** Salvamento: 120 por 60 s por IP-HMAC e 60 por 60 s por rascunho (chave = hash do segredo). */
function paresSalvar(ipHmac: string, secretHash: string): readonly (readonly [DraftRatePolicy, string])[] {
  return [
    [DRAFT_RATE_SALVAR_IP, ipHmac],
    [DRAFT_RATE_SALVAR_RASCUNHO, secretHash],
  ];
}

export interface PostDraftInput {
  readonly fields: DraftFieldsPatch;
  /** Segredo do cookie ja validado no formato, ou null quando ausente ou malformado. */
  readonly secret: string | null;
  /** IP normalizado do pedido (sem hash). */
  readonly ip: string;
}

/**
 * POST /v1/drafts (idempotente). Com cookie de rascunho vivo: aplica os campos como um PATCH e devolve
 * 200 sem criar linha (D-04). Sem cookie ou com cookie vencido: cria (201), marca o vencido como
 * descartado e entrega um cookie novo.
 */
export async function postDraft(input: PostDraftInput, deps: DraftDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(input.ip);

  if (input.secret !== null) {
    const hash = deps.hasher.secretHash(input.secret);
    const vivo = await deps.store.find(hash, now);
    if (vivo !== null) {
      const espera = await barradoPor(deps.rate, paresSalvar(ipHmac, hash), now);
      if (espera !== null) return resposta429(espera);
      const r: DraftWriteResult = await deps.store.patch({ secretHash: hash, nowMs: now, fields: input.fields });
      if (!r.ok) return erroDeEscrita(r.code);
      await contar(deps.rate, paresSalvar(ipHmac, hash), now);
      return json(200, toDraftView(r.draft), { 'Set-Cookie': draftCookieHeader(input.secret) });
    }
  }

  const espera = await barradoPor(deps.rate, paresCriacao(ipHmac), now);
  if (espera !== null) return resposta429(espera);
  const novo = deps.newSecret();
  const r = await deps.store.create({
    secretHash: deps.hasher.secretHash(novo),
    ipHmac,
    nowMs: now,
    expiredSecretHash: input.secret === null ? null : deps.hasher.secretHash(input.secret),
    liveCap: deps.liveCap ?? DRAFT_LIVE_CAP_DEFAULT,
    fields: input.fields,
  });
  if (!r.ok) return erroDeEscrita(r.code);
  await contar(deps.rate, paresCriacao(ipHmac), now);
  return json(201, toDraftView(r.draft), { 'Set-Cookie': draftCookieHeader(novo) });
}

export interface PatchDraftInput {
  readonly fields: DraftFieldsPatch;
  /** Segredo do cookie, ja validado no formato. A rota responde 404 antes quando ele falta. */
  readonly secret: string;
  readonly ip: string;
}

/** PATCH /v1/drafts/current: salvamento parcial e idempotente; renova o prazo e o cookie (R6). */
export async function patchDraft(input: PatchDraftInput, deps: DraftDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(input.ip);
  const hash = deps.hasher.secretHash(input.secret);
  const espera = await barradoPor(deps.rate, paresSalvar(ipHmac, hash), now);
  if (espera !== null) return resposta429(espera);
  const r = await deps.store.patch({ secretHash: hash, nowMs: now, fields: input.fields });
  if (!r.ok) return erroDeEscrita(r.code);
  await contar(deps.rate, paresSalvar(ipHmac, hash), now);
  return json(200, toDraftView(r.draft), { 'Set-Cookie': draftCookieHeader(input.secret) });
}

/**
 * GET /v1/drafts/current: le o rascunho vivo do cookie. Limite por IP-HMAC (A3): so o 200 conta;
 * o 404 e apenas checado, para que sondagem com cookie inexistente nao consuma a cota.
 */
export async function getDraft(secret: string, ip: string, deps: DraftDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(ip);
  const espera = await barradoPor(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  if (espera !== null) return resposta429(espera);
  const d = await deps.store.find(deps.hasher.secretHash(secret), now);
  if (d === null) return draftNotFound();
  await contar(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  return json(200, toDraftView(d));
}

/** DELETE /v1/drafts/current: descarta o rascunho vivo e limpa o cookie (204). */
export async function discardDraft(secret: string, deps: DraftDeps): Promise<DraftOutcome> {
  const ok = await deps.store.discard(deps.hasher.secretHash(secret), deps.clock.nowMs());
  if (!ok) return draftNotFound();
  return { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': DRAFT_CLEAR_COOKIE_HEADER }, body: '' };
}

/** Forma publica da identificacao: so nome, e-mail e a confirmacao (nunca HMAC, nonce ou id). */
function identidadeView(r: DraftIdentityRecord): DraftOutcome {
  return json(200, { first_name: r.firstName, email: r.email, email_verified: r.emailVerified });
}

/** GET /v1/drafts/current/identity: le nome, e-mail e confirmacao do rascunho vivo. Limite de leitura por IP-HMAC. */
export async function getIdentity(secret: string, ip: string, deps: DraftDeps): Promise<DraftOutcome> {
  if (deps.identity === undefined) return draftNotFound();
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(ip);
  const espera = await barradoPor(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  if (espera !== null) return resposta429(espera);
  const r = await deps.identity.store.identityGet(deps.hasher.secretHash(secret), now);
  if (r === null) return draftNotFound();
  await contar(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  return identidadeView(r);
}

/**
 * PUT /v1/drafts/current/identity (91 §1.5). Limites de salvamento de H-025 (120/60 s por IP-HMAC e 60/60 s por
 * rascunho). Escrever o e-mail aqui nao envia e-mail. Trocar o e-mail zera a confirmacao (no banco).
 */
export async function putIdentity(fields: IdentityFields, secret: string, ip: string, deps: DraftDeps): Promise<DraftOutcome> {
  if (deps.identity === undefined) return draftNotFound();
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(ip);
  const hash = deps.hasher.secretHash(secret);
  const espera = await barradoPor(deps.rate, paresSalvar(ipHmac, hash), now);
  if (espera !== null) return resposta429(espera);
  const r = await deps.identity.store.identitySet({
    secretHash: hash,
    nowMs: now,
    firstName: fields.first_name,
    email: fields.email,
    emailHmac: deps.identity.emailHmac(fields.email),
  });
  if (r === null) return draftNotFound();
  await contar(deps.rate, paresSalvar(ipHmac, hash), now);
  return identidadeView(r);
}

/**
 * GET /v1/drafts/current/review (H-030, 90 §2.1). Nao altera nada. Limite de leitura por IP-HMAC; conta toda
 * resposta que nao seja 404 (200, 409 e 422), porque a tela consulta esta rota durante a espera do e-mail.
 */
export async function getReview(secret: string, ip: string, deps: DraftDeps): Promise<DraftOutcome> {
  if (deps.review === undefined) return draftNotFound();
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(ip);
  const espera = await barradoPor(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  if (espera !== null) return resposta429(espera);
  const r = await deps.review.reviewGet(deps.hasher.secretHash(secret), now);
  if (r === null) return draftNotFound();
  await contar(deps.rate, [[DRAFT_RATE_LEITURA_IP, ipHmac]], now);
  const decisao = decideReview(r);
  if (decisao.kind === 'campos_faltando') return json(422, { code: 'campos_faltando', missing: decisao.missing });
  if (decisao.kind === 'email_nao_confirmado') return json(409, { code: 'email_nao_confirmado' });
  return json(200, decisao.view);
}

export interface PostConfirmInput {
  /** Versao do conteudo que o cliente viu (corpo, ja validado). */
  readonly contentRev: number;
  /** Segredo do cookie, ja validado no formato. A rota responde 404 antes quando ele falta. */
  readonly secret: string;
  readonly ip: string;
}

/**
 * POST /v1/drafts/current/confirm (H-030, 90 §2.2). Limites de 10/60 s por rascunho e 30/60 s por IP-HMAC,
 * contados so depois de aceita (200). Nunca publica: a resposta traz "confirmado" e nunca prazo ou pedido.
 */
export async function postConfirm(input: PostConfirmInput, deps: DraftDeps): Promise<DraftOutcome> {
  if (deps.review === undefined) return draftNotFound();
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(input.ip);
  const hash = deps.hasher.secretHash(input.secret);
  const pares = [
    [DRAFT_RATE_CONFIRMAR_RASCUNHO, hash],
    [DRAFT_RATE_CONFIRMAR_IP, ipHmac],
  ] as const;
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);
  const r = await deps.review.confirm({ secretHash: hash, nowMs: now, contentRev: input.contentRev, ttlDays: DRAFT_TTL_DAYS });
  if (r.kind === 'nao_encontrado') return draftNotFound();
  if (r.kind === 'campos_faltando') return json(422, { code: 'campos_faltando', missing: r.missing });
  if (r.kind === 'email_nao_confirmado') return json(409, { code: 'email_nao_confirmado' });
  if (r.kind === 'conteudo_alterado') return json(409, { code: 'conteudo_alterado' });
  await contar(deps.rate, pares, now);
  return json(200, { status: 'confirmado', confirmed_at: r.confirmedAt, content_rev: r.contentRev });
}
