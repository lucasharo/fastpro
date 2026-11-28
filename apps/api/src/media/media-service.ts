// H-026 (Issue #39) | Servico da quarentena de fotos (docs/factory/88-DESENHO-H026.md, §1 a §3; CA-01 a CA-06, CA-12).
// Ordem fixa depois do corpo: cotas (checagem sem contar) -> banco (posse, limite, repeticao) -> Storage
// (URL de envio ou stat) -> contagem da cota so depois de aceite. A API nunca le os bytes do arquivo.
// Erros internos nao saem daqui: a rota converte falha em 503 fixo. Nada de log com segredo, URL ou caminho.
import {
  DRAFT_CAP_RETRY_S,
  DRAFT_HEADERS,
  mediaObjectKey,
  rateLimited,
  MEDIA_GLOBAL_CAP,
  MEDIA_RATE_CONFIRMA_RASCUNHO,
  MEDIA_RATE_EMISSAO_IP_DIA,
  MEDIA_RATE_EMISSAO_IP_HORA,
  MEDIA_RATE_EMISSAO_RASCUNHO_DIA,
  MEDIA_RATE_EMISSAO_RASCUNHO_HORA,
  MEDIA_RATE_LEITURA_IP,
  MEDIA_UPLOAD_URL_TTL_S,
  type DraftRatePolicy,
  type DraftRatePort,
  type MediaEmissaoCorpo,
  type MediaRecord,
  type MediaStorePort,
  type QuarantineStoragePort,
} from '@fastpro/domain';
import type { DraftHasher } from '../drafts/draft-hash.js';
import { draftNotFound, type DraftOutcome } from '../drafts/draft-service.js';
import { reduzirFoto, type ReduceDeps } from './media-reduce-service.js';

export interface MediaClockPort {
  nowMs(): number;
}

export interface MediaDeps {
  readonly store: MediaStorePort;
  readonly storage: QuarantineStoragePort;
  readonly rate: DraftRatePort;
  readonly hasher: DraftHasher;
  readonly clock: MediaClockPort;
  /** Teto global de vagas vivas. Padrao MEDIA_GLOBAL_CAP (150). */
  readonly globalCap?: number;
  /** Reducao da foto confirmada (H-027): redutor, Storage da reducao, limite da instancia e contadores. */
  readonly reduce: ReduceDeps;
}

const JSON_HEADERS: Readonly<Record<string, string>> = DRAFT_HEADERS;

function json(status: number, corpo: unknown, extra: Readonly<Record<string, string>> = {}): DraftOutcome {
  return { status, headers: { ...JSON_HEADERS, ...extra }, body: JSON.stringify(corpo) };
}

function erro(status: number, code: string): DraftOutcome {
  return json(status, { code });
}

/** 429 neutro: so Retry-After, sem campo que revele o limite (CA-12, RF-021). */
function resposta429(retryAfterS: number): DraftOutcome {
  const r = rateLimited('pedido', retryAfterS);
  return { status: 429, headers: r.headers, body: r.body };
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

async function contar(
  rate: DraftRatePort,
  pares: readonly (readonly [DraftRatePolicy, string])[],
  nowMs: number,
): Promise<void> {
  for (const [policy, chave] of pares) await rate.hit(policy, chave, nowMs);
}

/** Visao publica do registro: so id, estado e se foi confirmado. Nada de caminho, bucket ou tamanho. */
function visao(m: MediaRecord): { id: string; status: string; confirmed: boolean } {
  return { id: m.id, status: m.status, confirmed: m.confirmed };
}

export interface IssueInput {
  readonly corpo: MediaEmissaoCorpo;
  /** Segredo do cookie ja validado no formato (a rota responde 404 antes quando ele falta). */
  readonly secret: string;
  readonly ip: string;
}

/**
 * POST /v1/media/uploads. Nova vaga: 201 com URL de envio de uso unico. Repeticao de pendente: 200 com a
 * URL do mesmo id. Repeticao de confirmado: 200 sem URL (CA-04). Sexta vaga: 422 photo_limit antes de
 * assinar qualquer URL (CA-02).
 */
export async function issueMedia(input: IssueInput, deps: MediaDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(input.ip);
  const hash = deps.hasher.secretHash(input.secret);
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [
    [MEDIA_RATE_EMISSAO_RASCUNHO_HORA, hash],
    [MEDIA_RATE_EMISSAO_RASCUNHO_DIA, hash],
    [MEDIA_RATE_EMISSAO_IP_HORA, ipHmac],
    [MEDIA_RATE_EMISSAO_IP_DIA, ipHmac],
  ];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const r = await deps.store.issue({
    secretHash: hash,
    clientUploadId: input.corpo.clientUploadId,
    type: input.corpo.type,
    bytes: input.corpo.bytes,
    nowMs: now,
    globalCap: deps.globalCap ?? MEDIA_GLOBAL_CAP,
  });

  if (r.code === 'not_found') return draftNotFound();
  if (r.code === 'photo_limit') return erro(422, 'photo_limit');
  if (r.code === 'cap') return resposta429(DRAFT_CAP_RETRY_S);
  if (r.media === null) throw new Error('midia_resposta_invalida');

  if (r.media.confirmed) {
    await contar(deps.rate, pares, now);
    return json(200, visao(r.media));
  }

  const { url } = await deps.storage.createUploadUrl(mediaObjectKey(r.media.id), MEDIA_UPLOAD_URL_TTL_S);
  await contar(deps.rate, pares, now);
  const corpo = {
    id: r.media.id,
    status: r.media.status,
    upload_url: url,
    upload_expires_at: new Date(now + MEDIA_UPLOAD_URL_TTL_S * 1000).toISOString(),
  };
  return json(r.code === 'new' ? 201 : 200, corpo);
}

export interface FinalizeInput {
  readonly id: string;
  readonly secret: string;
  readonly ip: string;
}

/**
 * POST /v1/media/{id}/finalize (H-026 + H-027). Confirma o envio (stat e media_finalize, idempotente, CA-04) e,
 * em seguida, reduz a foto (93 §2.3). 'ready' so e gravado pela reducao (media_reduce_done). Erros de confirmacao
 * seguem iguais (404, 409, 413). Repeticao depois de confirmado nao reencoda (CA-06).
 */
export async function finalizeMedia(input: FinalizeInput, deps: MediaDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const hash = deps.hasher.secretHash(input.secret);
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [[MEDIA_RATE_CONFIRMA_RASCUNHO, hash]];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const atual = await deps.store.get(hash, input.id, now);
  if (atual === null) return draftNotFound();

  if (!atual.confirmed) {
    const info = await deps.storage.stat(mediaObjectKey(input.id));
    const r = await deps.store.finalize(hash, input.id, info === null ? null : info.bytes, now);
    switch (r.code) {
      case 'confirmed':
      case 'replay':
        if (r.media === null) throw new Error('midia_resposta_invalida');
        break;
      case 'not_found':
        return draftNotFound();
      case 'expired':
        return erro(409, 'upload_expirado');
      case 'missing':
        return erro(409, 'upload_nao_encontrado');
      case 'too_large':
        return erro(413, 'arquivo_grande');
      default:
        throw new Error('midia_resposta_invalida');
    }
  }
  // Cota de confirmacao: conta toda finalizacao aceita, inclusive a repetida que dispara a reducao (93 R4).
  await contar(deps.rate, pares, now);
  return reduzirFoto({ id: input.id, hash }, deps.reduce, now);
}

export interface ReadInput {
  readonly id: string;
  readonly secret: string;
  readonly ip: string;
}

/** GET /v1/media/{id}: estado do registro por posse. Sem URL e sem arquivo (CA-06, CA-10). */
export async function getMedia(input: ReadInput, deps: MediaDeps): Promise<DraftOutcome> {
  const now = deps.clock.nowMs();
  const ipHmac = deps.hasher.ipHmac(input.ip);
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [[MEDIA_RATE_LEITURA_IP, ipHmac]];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const m = await deps.store.get(deps.hasher.secretHash(input.secret), input.id, now);
  if (m === null) return draftNotFound();
  await contar(deps.rate, pares, now);
  return json(200, visao(m));
}
