// H-029 (Issue #42) | Servico da galeria do dono (docs/factory/98-DESENHO-H029.md, §2 a §5).
// Dono sempre pelo cookie do rascunho (hash do segredo). Nada de nome, caminho, bucket ou tamanho na resposta.
// Falha interna vira 503 fixo; leitura divergente nunca serve o objeto (contador leitura_divergente).
import {
  DRAFT_HEADERS,
  MEDIA_DELETE_PHYSICAL_BUDGET_MS,
  MEDIA_RATE_EXCLUI_RASCUNHO,
  MEDIA_RATE_IMAGEM_IP,
  MEDIA_RATE_LEITURA_IP,
  MEDIA_RATE_ORDEM_RASCUNHO,
  fotoReduzidaValida,
  rateLimited,
  visaoGaleria,
  type DraftRatePolicy,
  type DraftRatePort,
  type GaleriaContador,
  type MediaGalleryStorePort,
  type MediaReduceStoragePort,
  type MediaStorePort,
  type ReducedPhotoReaderPort,
} from '@fastpro/domain';
import type { DraftHasher } from '../drafts/draft-hash.js';
import { draftNotFound } from '../drafts/draft-service.js';

/** Resposta da galeria: JSON como texto, ou bytes da imagem (so na leitura). */
export interface GalleryOutcome {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

export interface GalleryClockPort {
  nowMs(): number;
}

export interface GalleryDeps {
  readonly gallery: MediaGalleryStorePort;
  readonly reader: ReducedPhotoReaderPort;
  /** Remocao fisica do original e da versao reduzida (portas da reducao; ausente conta como sucesso). */
  readonly storage: MediaReduceStoragePort;
  /** Expurgo fase C (media_purge_done) depois da remocao fisica bem-sucedida. */
  readonly store: MediaStorePort;
  readonly rate: DraftRatePort;
  readonly hasher: DraftHasher;
  readonly clock: GalleryClockPort;
  /** Contador operacional de nome fixo; nunca recebe identificador. */
  readonly contador?: (nome: GaleriaContador) => void;
}

const JSON_HEADERS: Readonly<Record<string, string>> = DRAFT_HEADERS;

/** Cabecalhos exatos da leitura da imagem (98 §2.2): sem ETag, sem nome, sem chave de objeto. */
export const IMAGEM_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function json(status: number, corpo: unknown): GalleryOutcome {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(corpo) };
}

function erro(status: number, code: string): GalleryOutcome {
  return json(status, { code });
}

function indisponivel(): GalleryOutcome {
  return erro(503, 'indisponivel');
}

function resposta429(retryAfterS: number): GalleryOutcome {
  const r = rateLimited('pedido', retryAfterS);
  return { status: 429, headers: r.headers, body: r.body };
}

function conta(deps: GalleryDeps, nome: GaleriaContador): void {
  deps.contador?.(nome);
}

/** Maior Retry-After entre as politicas que barraram; null quando nenhuma barrou (mesmo molde de media-service). */
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

export interface GalleryInput {
  readonly secret: string;
  readonly ip: string;
}

/** GET /v1/media/photos (98 §2.1). Rascunho sem foto = 200 com lista vazia; rascunho ausente = 404 uniforme. */
export async function listPhotos(input: GalleryInput, deps: GalleryDeps): Promise<GalleryOutcome> {
  const now = deps.clock.nowMs();
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [
    [MEDIA_RATE_LEITURA_IP, deps.hasher.ipHmac(input.ip)],
  ];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const linhas = await deps.gallery.list(deps.hasher.secretHash(input.secret), now);
  if (linhas === null) return draftNotFound();
  await contar(deps.rate, pares, now);
  conta(deps, 'lista_ok');
  return json(200, visaoGaleria(linhas));
}

export interface ImageInput extends GalleryInput {
  readonly id: string;
}

/**
 * GET /v1/media/{id}/image (98 §2.2). So foto do dono, viva e pronta. Antes de servir, confere tamanho exato,
 * teto e assinatura JPEG; divergencia ou objeto ausente de foto pronta vira 503 e nunca e servido.
 */
export async function readPhotoImage(input: ImageInput, deps: GalleryDeps): Promise<GalleryOutcome> {
  const now = deps.clock.nowMs();
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [
    [MEDIA_RATE_IMAGEM_IP, deps.hasher.ipHmac(input.ip)],
  ];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const hash = deps.hasher.secretHash(input.secret);
  const declarado = await deps.gallery.readTarget(hash, input.id, now);
  if (declarado === null) {
    conta(deps, 'imagem_404');
    return draftNotFound();
  }
  const bytes = await deps.reader.readReduced(input.id);
  if (bytes === null || !fotoReduzidaValida(bytes, declarado)) {
    conta(deps, 'leitura_divergente');
    return indisponivel();
  }
  await contar(deps.rate, pares, now);
  conta(deps, 'imagem_ok');
  return { status: 200, headers: IMAGEM_HEADERS, body: bytes };
}

export interface DeleteInput extends GalleryInput {
  readonly id: string;
}

/**
 * DELETE /v1/media/{id} (98 §2.3). A marcacao e o ponto de confirmacao: 200 para 'deleted' e 'already'
 * (mesma resposta), 404 uniforme para 'not_found'. A remocao fisica roda depois, com orcamento de 2 s, e
 * nao muda a resposta; se falhar, o varredor de expurgo repete.
 */
export async function deletePhoto(input: DeleteInput, deps: GalleryDeps): Promise<GalleryOutcome> {
  const now = deps.clock.nowMs();
  const hash = deps.hasher.secretHash(input.secret);
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [[MEDIA_RATE_EXCLUI_RASCUNHO, hash]];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const code = await deps.gallery.remove(hash, input.id, now);
  if (code === 'not_found') return draftNotFound();
  await contar(deps.rate, pares, now);
  if (code === 'already') conta(deps, 'exclusao_repetida');
  else conta(deps, 'exclusao_ok');

  await removerFisico(input.id, deps);
  return json(200, { excluida: true });
}

/** Remove original e reduzida dentro do orcamento; a linha so vai para o expurgo quando as duas saem. */
async function removerFisico(id: string, deps: GalleryDeps): Promise<void> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<'tempo'>((resolve) => {
    relogio = setTimeout(() => resolve('tempo'), MEDIA_DELETE_PHYSICAL_BUDGET_MS);
  });
  const tarefa = (async (): Promise<'ok' | 'falhou'> => {
    try {
      await deps.storage.removeOriginal(id);
      await deps.storage.removeReduced(id);
      return 'ok';
    } catch {
      return 'falhou';
    }
  })();
  try {
    const r = await Promise.race([tarefa, prazo]);
    if (r === 'ok') {
      await deps.store.purgeDone([id]);
      return;
    }
    conta(deps, 'remocao_fisica_falhou');
  } catch {
    conta(deps, 'remocao_fisica_falhou');
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
}

export interface OrderInput extends GalleryInput {
  readonly atual: readonly string[];
  readonly nova: readonly string[];
}

/**
 * PUT /v1/media/photos/order (98 §2.4). 200 com a lista (gravou ou ja estava assim); 409 ordem_mudou com a lista
 * atual quando a sequencia viva mudou; 422 ordem_invalida; 404 uniforme para rascunho alheio.
 */
export async function reorderPhotos(input: OrderInput, deps: GalleryDeps): Promise<GalleryOutcome> {
  const now = deps.clock.nowMs();
  const hash = deps.hasher.secretHash(input.secret);
  const pares: readonly (readonly [DraftRatePolicy, string])[] = [[MEDIA_RATE_ORDEM_RASCUNHO, hash]];
  const espera = await barradoPor(deps.rate, pares, now);
  if (espera !== null) return resposta429(espera);

  const code = await deps.gallery.reorder(hash, input.atual, input.nova, now);
  if (code === 'not_found') return draftNotFound();
  if (code === 'invalid') return erro(422, 'ordem_invalida');

  const linhas = await deps.gallery.list(hash, now);
  if (linhas === null) return draftNotFound();
  await contar(deps.rate, pares, now);
  if (code === 'changed') {
    conta(deps, 'ordem_conflito');
    return json(409, { code: 'ordem_mudou', ...visaoGaleria(linhas) });
  }
  conta(deps, 'ordem_ok');
  return json(200, visaoGaleria(linhas));
}
