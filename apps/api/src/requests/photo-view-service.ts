// H-056 (Issue 69) | Servico das fotos elegiveis: lista e emissao do link de 60 s (docs/factory/167-DESENHO-H056.md, §4.3, A-11).
// Sem I/O proprio: acesso e leitura vem da porta do banco; o token e assinado pelo codec. Falha interna vira 503 fixo.
// Recusa de qualquer causa (id malformado, negado, foto ausente) vira o mesmo 404 uniforme.
import {
  PHOTO_VIEW_TTL_S,
  type PhotoTokenCodec,
  type PhotoTokenMode,
  type PhotoVariant,
  type PhotoViewStorePort,
} from '@fastpro/domain';

export const FOTO_NAO_ENCONTRADA_BODY = { code: 'foto_nao_encontrada' } as const;
export const FOTO_INDISPONIVEL_BODY = { code: 'indisponivel' } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhotoViewServiceDeps {
  readonly store: PhotoViewStorePort;
  readonly codec: PhotoTokenCodec;
  readonly clock: { nowMs(): number };
}

export type PhotoServiceResult =
  | { readonly status: 200; readonly body: unknown }
  | { readonly status: 404; readonly body: typeof FOTO_NAO_ENCONTRADA_BODY }
  | { readonly status: 503; readonly body: typeof FOTO_INDISPONIVEL_BODY };

const NEGADO: PhotoServiceResult = { status: 404, body: FOTO_NAO_ENCONTRADA_BODY };
const INDISPONIVEL: PhotoServiceResult = { status: 503, body: FOTO_INDISPONIVEL_BODY };

function ehUuid(valor: string): boolean {
  return UUID_RE.test(valor);
}

/** Lista de fotos prontas do pedido, com chaves fechadas (sem chave de bucket, bytes ou nome). */
export async function listarFotos(
  papel: PhotoTokenMode,
  usuarioId: string,
  requestId: string,
  deps: PhotoViewServiceDeps,
): Promise<PhotoServiceResult> {
  if (!ehUuid(usuarioId) || !ehUuid(requestId)) return NEGADO;
  try {
    const linhas =
      papel === 'professional'
        ? await deps.store.list(usuarioId, requestId, deps.clock.nowMs())
        : await deps.store.ownerList(usuarioId, requestId);
    if (linhas === null) return NEGADO;
    return {
      status: 200,
      body: {
        photos: linhas.map((foto) => ({ id: foto.id, sortOrder: foto.sortOrder, width: foto.width, height: foto.height })),
      },
    };
  } catch {
    return INDISPONIVEL;
  }
}

/** Emite o link de visualizacao (token HMAC de 60 s) depois de conferir que a foto e entregavel a quem pede. */
export async function emitirLink(
  papel: PhotoTokenMode,
  usuarioId: string,
  requestId: string,
  photoId: string,
  variante: PhotoVariant,
  deps: PhotoViewServiceDeps,
): Promise<PhotoServiceResult> {
  if (!ehUuid(usuarioId) || !ehUuid(requestId) || !ehUuid(photoId)) return NEGADO;
  try {
    const agora = deps.clock.nowMs();
    const alvo =
      papel === 'professional'
        ? await deps.store.target(usuarioId, requestId, photoId, agora)
        : await deps.store.ownerTarget(usuarioId, requestId, photoId);
    if (alvo === null) return NEGADO;
    const token = deps.codec.sign({ mode: papel, photoId, requestId, userId: usuarioId, variant: variante }, agora);
    return { status: 200, body: { view_url: `/v1/media/watermarked-photos/${token}`, expires_in: PHOTO_VIEW_TTL_S } };
  } catch {
    return INDISPONIVEL;
  }
}
