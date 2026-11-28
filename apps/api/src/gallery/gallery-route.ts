// Galeria de fotos do profissional (2026-11-27).
//   GET    /v1/professional/gallery                        dono: {items:[{id,width,height}], max}
//   POST   /v1/professional/gallery                        dono: corpo = a imagem (JPG, PNG ou WebP, ate 4 MB) -> 201 {id}
//   GET    /v1/professional/gallery/:id                    dono: a imagem
//   DELETE /v1/professional/gallery/:id                    dono: apaga
//   GET    /v1/public/professionals/:slug/gallery          sem sessao: {items} de profissional visivel
//   GET    /v1/public/professionals/:slug/gallery/:id      sem sessao: a imagem
// A imagem e sempre reencodada em JPEG (maior lado 1.600 px), o que descarta os metadados (inclusive localizacao).
// Ordem: rota -> Origin (mutacoes) -> ids -> sessao -> corpo -> banco e Storage. Recusa de posse = 404 uniforme.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, type PgProfessionalGalleryStore, type SupabaseGalleryStorage } from '@fastpro/db';

export const GALERIA_MAX = 30;
export const GALERIA_CORPO_MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

export interface ImagemPreparada {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface GalleryRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<PgProfessionalGalleryStore, 'adicionar' | 'doProfissional' | 'doPerfil' | 'excluir'>;
  readonly storage: Pick<SupabaseGalleryStorage, 'gravar' | 'ler' | 'apagar'>;
  /** Reencoda a imagem; null quando o conteudo nao e uma imagem aceita. */
  readonly preparar: (bytes: Uint8Array) => Promise<ImagemPreparada | null>;
  readonly clock: { nowMs(): number };
}

type Rota =
  | { readonly tipo: 'listar' }
  | { readonly tipo: 'enviar' }
  | { readonly tipo: 'imagem' | 'excluir'; readonly id: string }
  | { readonly tipo: 'publica'; readonly slug: string; readonly id: string | null };

export function galleryRoute(metodo: string, path: string): Rota | null {
  if (path === '/v1/professional/gallery') {
    return metodo === 'GET' ? { tipo: 'listar' } : metodo === 'POST' ? { tipo: 'enviar' } : null;
  }
  let m = /^\/v1\/professional\/gallery\/([^/]+)$/.exec(path);
  if (m) {
    const id = m[1] ?? '';
    return metodo === 'GET' ? { tipo: 'imagem', id } : metodo === 'DELETE' ? { tipo: 'excluir', id } : null;
  }
  m = /^\/v1\/public\/professionals\/([^/]+)\/gallery(?:\/([^/]+))?$/.exec(path);
  return m && metodo === 'GET' ? { tipo: 'publica', slug: m[1] ?? '', id: m[2] ?? null } : null;
}

export function isGalleryRoute(metodo: string, path: string): boolean {
  return galleryRoute(metodo, path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

function enviarImagem(res: ServerResponse, bytes: Uint8Array, cache: string): void {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': String(bytes.length),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cache,
  });
  res.end(Buffer.from(bytes));
}

/** Corpo binario ate o limite; null quando passa dele (o restante so e descartado). */
function lerCorpo(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= GALERIA_CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => resolve(total > GALERIA_CORPO_MAX_BYTES ? null : Buffer.concat(partes)));
    req.on('error', reject);
  });
}

export async function handleGalleryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: GalleryRouteOptions,
): Promise<void> {
  try {
    const rota = galleryRoute(req.method ?? '', path);
    if (rota === null) return enviar(res, 404, NAO_ENCONTRADO);

    if (rota.tipo === 'publica') {
      if (!SLUG_RE.test(rota.slug)) return enviar(res, 404, NAO_ENCONTRADO);
      const fotos = await opts.store.doPerfil(rota.slug);
      if (rota.id === null) return enviar(res, 200, { items: fotos });
      if (!fotos.some((f) => f.id === rota.id)) return enviar(res, 404, NAO_ENCONTRADO);
      const bytes = await opts.storage.ler(rota.id);
      return bytes === null ? enviar(res, 404, NAO_ENCONTRADO) : enviarImagem(res, bytes, 'public, max-age=300');
    }

    if (rota.tipo === 'enviar' || rota.tipo === 'excluir') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    }
    if ('id' in rota && !UUID_RE.test(rota.id)) return enviar(res, 404, NAO_ENCONTRADO);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    if (rota.tipo === 'listar') {
      return enviar(res, 200, { items: await opts.store.doProfissional(sessao.userId), max: GALERIA_MAX });
    }
    if (rota.tipo === 'enviar') {
      if (!TIPOS.includes(cabecalho(req.headers['content-type']) ?? '')) return enviar(res, 415, { code: 'tipo_nao_aceito' });
      const corpo = await lerCorpo(req);
      if (corpo === null) return enviar(res, 413, { code: 'arquivo_grande' });
      if ((await opts.store.doProfissional(sessao.userId)).length >= GALERIA_MAX) return enviar(res, 422, { code: 'limite_fotos' });
      const imagem = await opts.preparar(corpo);
      if (imagem === null) return enviar(res, 422, { code: 'imagem_invalida' });
      const id = randomUUID();
      await opts.storage.gravar(id, imagem.bytes);
      let resultado: string;
      try {
        resultado = await opts.store.adicionar(sessao.userId, id, imagem.width, imagem.height, imagem.bytes.length, new Date(agora));
      } catch (erro) {
        await opts.storage.apagar(id).catch(() => undefined);
        throw erro;
      }
      if (resultado === 'ok') return enviar(res, 201, { id });
      await opts.storage.apagar(id).catch(() => undefined);
      if (resultado === 'limite') return enviar(res, 422, { code: 'limite_fotos' });
      return enviar(res, 403, { code: resultado });
    }

    const minhas = await opts.store.doProfissional(sessao.userId);
    if (!minhas.some((f) => f.id === rota.id)) return enviar(res, 404, NAO_ENCONTRADO);
    if (rota.tipo === 'imagem') {
      const bytes = await opts.storage.ler(rota.id);
      return bytes === null ? enviar(res, 404, NAO_ENCONTRADO) : enviarImagem(res, bytes, 'private, max-age=300');
    }
    // Primeiro o arquivo: se o Storage falhar, a foto continua na lista e o dono tenta de novo.
    await opts.storage.apagar(rota.id);
    await opts.store.excluir(sessao.userId, rota.id);
    return enviar(res, 200, { status: 'excluida' });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
