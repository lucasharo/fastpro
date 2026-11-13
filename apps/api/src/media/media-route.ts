// H-026 (Issue #39) | Rotas da quarentena (docs/factory/88-DESENHO-H026.md, §1; CA-06, CA-10, CA-13).
// POST /v1/media/uploads; POST /v1/media/{id}/finalize; GET /v1/media/{id}. O dono e sempre o rascunho do
// cookie __Host-fp_draft; o id da foto nunca decide posse. Sem CORS, sem log de corpo, URL ou cabecalho.
// H-029 (Issue #42) | Galeria (98-DESENHO-H029 §1): GET /v1/media/photos; GET /v1/media/{id}/image;
// DELETE /v1/media/{id}; PUT /v1/media/photos/order. So ativas quando a opcao `galeria` e informada.
// Ordem: Origin/Sec-Fetch-Site -> Content-Type (so POST de emissao e PUT de ordem) -> cookie (formato; sem cookie
// = 404, sem banco) -> id (uuid; senao 404, sem banco) -> corpo (2 KB ou 1 KB) -> servico (cotas e banco).
// Qualquer outra rota ou metodo cai no mesmo 404 uniforme.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DRAFT_HEADERS,
  MEDIA_BODY_LIMIT_BYTES,
  MEDIA_ITEM_PREFIX,
  MEDIA_ORDER_BODY_LIMIT_BYTES,
  MEDIA_ORDER_PATH,
  MEDIA_PATH,
  MEDIA_PHOTOS_PATH,
  checkDraftJson,
  checkDraftOrigin,
  draftSecretFromCookie,
  isMediaId,
  normalizeClientIp,
  parseMediaEmissaoBody,
  parseMediaOrderBody,
  siteOriginOf,
} from '@fastpro/domain';
import { draftNotFound, type DraftOutcome } from '../drafts/draft-service.js';
import {
  deletePhoto,
  listPhotos,
  readPhotoImage,
  reorderPhotos,
  type GalleryDeps,
  type GalleryOutcome,
} from './media-gallery-service.js';
import { finalizeMedia, getMedia, issueMedia, type MediaDeps } from './media-service.js';

export interface MediaRouteOptions {
  /** Portas e dependencias da quarentena. Montadas na composicao. */
  readonly deps: MediaDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
  /** Galeria do dono (H-029). Sem esta opcao, as rotas da galeria recebem o 404 uniforme. */
  readonly galeria?: GalleryDeps;
}

const ITEM_RE = /^\/v1\/media\/([^/]+)(\/finalize)?$/;
const IMAGEM_RE = /^\/v1\/media\/([^/]+)\/image$/;

/**
 * Prefixo inteiro de midia: qualquer metodo ou caminho sob /v1/media/ passa por aqui e recebe o mesmo 404
 * uniforme (88 §1, CA-10). Sem rota de leitura do arquivo.
 */
export function isMediaRoute(path: string): boolean {
  return path === MEDIA_PATH || path.startsWith(MEDIA_ITEM_PREFIX);
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (413 sem reset). */
function lerCorpo(
  req: IncomingMessage,
  limite: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let guardados = 0;
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (guardados <= limite) {
        partes.push(chunk);
        guardados += chunk.length;
      }
    });
    req.on('end', () => resolve({ text: Buffer.concat(partes).toString('utf8'), bytes: total }));
    req.on('error', reject);
  });
}

function enviar(res: ServerResponse, r: DraftOutcome | GalleryOutcome): void {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
}

function erro(status: 403 | 413 | 415 | 422, code: string): DraftOutcome {
  return { status, headers: DRAFT_HEADERS, body: JSON.stringify({ code }) };
}

export async function handleMediaRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: MediaRouteOptions,
): Promise<void> {
  try {
    const metodo = req.method ?? '';
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      metodo !== 'GET',
    );
    if (!origem.ok) return enviar(res, erro(403, 'origem_invalida'));

    const ip = normalizeClientIp(req.socket.remoteAddress).value;
    const segredo = draftSecretFromCookie(cabecalho(req.headers.cookie));
    const galeria = opts.galeria;

    if (path === MEDIA_PATH && metodo === 'POST') {
      const tipo = checkDraftJson(cabecalho(req.headers['content-type']));
      if (!tipo.ok) return enviar(res, erro(415, 'tipo_invalido'));
      // Cookie ausente, malformado ou repetido: 404 imediato, sem leitura do corpo e sem banco.
      if (segredo === null) return enviar(res, draftNotFound());
      const { text, bytes } = await lerCorpo(req, MEDIA_BODY_LIMIT_BYTES);
      const corpo = parseMediaEmissaoBody(text, bytes);
      if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
      return enviar(res, await issueMedia({ corpo: corpo.corpo, secret: segredo, ip }, opts.deps));
    }

    if (galeria !== undefined) {
      if (path === MEDIA_PHOTOS_PATH && metodo === 'GET') {
        if (segredo === null) return enviar(res, draftNotFound());
        return enviar(res, await listPhotos({ secret: segredo, ip }, galeria));
      }
      if (path === MEDIA_ORDER_PATH && metodo === 'PUT') {
        const tipo = checkDraftJson(cabecalho(req.headers['content-type']));
        if (!tipo.ok) return enviar(res, erro(415, 'tipo_invalido'));
        if (segredo === null) return enviar(res, draftNotFound());
        const { text, bytes } = await lerCorpo(req, MEDIA_ORDER_BODY_LIMIT_BYTES);
        const corpo = parseMediaOrderBody(text, bytes);
        if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
        return enviar(
          res,
          await reorderPhotos({ atual: corpo.atual, nova: corpo.nova, secret: segredo, ip }, galeria),
        );
      }
      const imagem = IMAGEM_RE.exec(path);
      if (imagem !== null && metodo === 'GET') {
        const id = imagem[1] ?? '';
        if (segredo === null || !isMediaId(id)) return enviar(res, draftNotFound());
        return enviar(res, await readPhotoImage({ id, secret: segredo, ip }, galeria));
      }
    }

    const item = ITEM_RE.exec(path);
    if (item !== null) {
      const id = item[1] ?? '';
      const finaliza = item[2] !== undefined;
      // Cookie e id antes de qualquer banco. Id que nao e uuid recebe o mesmo 404 de foto de outro rascunho.
      if (segredo === null || !isMediaId(id)) return enviar(res, draftNotFound());
      if (finaliza && metodo === 'POST') {
        return enviar(res, await finalizeMedia({ id, secret: segredo, ip }, opts.deps));
      }
      if (!finaliza && metodo === 'GET') {
        return enviar(res, await getMedia({ id, secret: segredo, ip }, opts.deps));
      }
      if (!finaliza && metodo === 'DELETE' && galeria !== undefined) {
        return enviar(res, await deletePhoto({ id, secret: segredo, ip }, galeria));
      }
    }

    return enviar(res, draftNotFound());
  } catch {
    // Sem detalhe de erro na resposta nem no registro: falha nossa vira 503 fixo.
    if (!res.headersSent) {
      enviar(res, { status: 503, headers: DRAFT_HEADERS, body: JSON.stringify({ code: 'indisponivel' }) });
    }
  }
}
