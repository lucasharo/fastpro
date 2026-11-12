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
  type DraftRatePolicy,
  type DraftRatePort,
  type DraftStoreError,
  type DraftStorePort,
  type DraftWriteResult,
} from '@fastpro/domain';
import type { DraftHasher } from './draft-hash.js';

export interface DraftClockPort {
  nowMs(): number;
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
