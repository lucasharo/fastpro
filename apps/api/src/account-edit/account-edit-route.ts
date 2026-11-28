// Dados editaveis do profissional (2026-11-27).
//   GET    /v1/professional/account                      dono: {publicName, bio, hasPhoto, email}
//   PUT    /v1/professional/account                      dono: {publicName, bio} -> 200
//   GET    /v1/professional/account/photo                dono: a foto
//   POST   /v1/professional/account/photo                dono: corpo = a imagem (JPG, PNG ou WebP, ate 4 MB) -> 201
//   DELETE /v1/professional/account/photo                dono: remove
//   GET    /v1/public/professionals/:slug/about          sem sessao: {bio, hasPhoto} de profissional visivel
//   GET    /v1/public/professionals/:slug/photo          sem sessao: a foto
// A senha continua nas rotas proprias. A foto e reencodada em JPEG (sem metadados), como na galeria.
// Ordem: rota -> Origin (mutacoes) -> sessao -> corpo -> banco e Storage.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftJson, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, type PgProfessionalAccountEditStore, type SupabaseGalleryStorage } from '@fastpro/db';
import { lerCorpoLimitado } from '../corpo-limitado.js';
import type { ImagemPreparada } from '../gallery/gallery-route.js';

export const CONTA_PATH = '/v1/professional/account';
export const CONTA_FOTO_PATH = '/v1/professional/account/photo';
export const NOME_MAX = 80;
export const BIO_MAX = 500;
const FOTO_MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PUBLICA_RE = /^\/v1\/public\/professionals\/([a-z0-9][a-z0-9-]{0,99})\/(about|photo)$/;
const NAO_ENCONTRADO = { code: 'nao_encontrado' } as const;

export interface AccountEditRouteOptions {
  readonly siteUrl: string;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<PgProfessionalAccountEditStore, 'ler' | 'salvar' | 'trocarFoto' | 'publico'>;
  readonly storage: Pick<SupabaseGalleryStorage, 'gravar' | 'ler' | 'apagar'>;
  readonly preparar: (bytes: Uint8Array) => Promise<ImagemPreparada | null>;
  readonly clock: { nowMs(): number };
}

export function isAccountEditRoute(metodo: string, path: string): boolean {
  if (path === CONTA_PATH) return metodo === 'GET' || metodo === 'PUT';
  if (path === CONTA_FOTO_PATH) return metodo === 'GET' || metodo === 'POST' || metodo === 'DELETE';
  return metodo === 'GET' && PUBLICA_RE.test(path);
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

/** Corpo binario ate o limite; null quando passa dele. */
function lerImagem(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= FOTO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => resolve(total > FOTO_MAX_BYTES ? null : Buffer.concat(partes)));
    req.on('error', reject);
  });
}

export async function handleAccountEditRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AccountEditRouteOptions,
): Promise<void> {
  try {
    const metodo = req.method ?? '';
    const publica = PUBLICA_RE.exec(path);
    if (publica) {
      const dados = await opts.store.publico(publica[1] ?? '');
      if (dados === null) return enviar(res, 404, NAO_ENCONTRADO);
      if (publica[2] === 'about') return enviar(res, 200, { bio: dados.bio, hasPhoto: dados.photoId !== null });
      const bytes = dados.photoId === null ? null : await opts.storage.ler(dados.photoId);
      return bytes === null ? enviar(res, 404, NAO_ENCONTRADO) : enviarImagem(res, bytes, 'public, max-age=300');
    }

    if (metodo !== 'GET') {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    }
    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    if (path === CONTA_PATH) {
      if (metodo === 'GET') {
        const d = await opts.store.ler(sessao.userId);
        if (d === null) return enviar(res, 403, { code: 'sem_perfil' });
        return enviar(res, 200, { publicName: d.publicName, bio: d.bio, hasPhoto: d.photoId !== null, email: d.email });
      }
      if (!checkDraftJson(cabecalho(req.headers['content-type'])).ok) return enviar(res, 415, { code: 'tipo_nao_aceito' });
      const { text, excedeu } = await lerCorpoLimitado(req, 8192);
      let corpo: { publicName?: unknown; bio?: unknown } = {};
      if (!excedeu) {
        try {
          corpo = (JSON.parse(text) ?? {}) as typeof corpo;
        } catch {
          return enviar(res, 400, { code: 'corpo_invalido' });
        }
      }
      const { publicName, bio } = corpo;
      if (typeof publicName !== 'string' || typeof bio !== 'string') return enviar(res, 422, { code: 'invalido' });
      const nome = publicName.trim();
      if (nome !== '' && ([...nome].length < 2 || [...nome].length > NOME_MAX)) return enviar(res, 422, { code: 'invalido', campo: 'publicName' });
      if ([...bio.trim()].length > BIO_MAX) return enviar(res, 422, { code: 'invalido', campo: 'bio' });
      const r = await opts.store.salvar(sessao.userId, nome, bio, new Date(agora));
      if (r === 'ok') return enviar(res, 200, { status: 'salvo' });
      return enviar(res, r === 'sem_perfil' || r === 'suspenso' ? 403 : 422, { code: r });
    }

    if (metodo === 'GET') {
      const id = (await opts.store.ler(sessao.userId))?.photoId;
      const bytes = id ? await opts.storage.ler(id) : null;
      return bytes === null ? enviar(res, 404, NAO_ENCONTRADO) : enviarImagem(res, bytes, 'no-store');
    }
    if (metodo === 'DELETE') {
      const r = await opts.store.trocarFoto(sessao.userId, null, new Date(agora));
      if (r.code !== 'ok') return enviar(res, 403, { code: r.code });
      if (r.anterior) await opts.storage.apagar(r.anterior).catch(() => undefined);
      return enviar(res, 200, { status: 'removida' });
    }
    if (!TIPOS.includes(cabecalho(req.headers['content-type']) ?? '')) return enviar(res, 415, { code: 'tipo_nao_aceito' });
    const corpo = await lerImagem(req);
    if (corpo === null) return enviar(res, 413, { code: 'arquivo_grande' });
    const imagem = await opts.preparar(corpo);
    if (imagem === null) return enviar(res, 422, { code: 'imagem_invalida' });
    const id = randomUUID();
    await opts.storage.gravar(id, imagem.bytes);
    let troca: Awaited<ReturnType<typeof opts.store.trocarFoto>>;
    try {
      troca = await opts.store.trocarFoto(sessao.userId, id, new Date(agora));
    } catch (erro) {
      await opts.storage.apagar(id).catch(() => undefined);
      throw erro;
    }
    if (troca.code !== 'ok') {
      await opts.storage.apagar(id).catch(() => undefined);
      return enviar(res, 403, { code: troca.code });
    }
    if (troca.anterior) await opts.storage.apagar(troca.anterior).catch(() => undefined);
    return enviar(res, 201, { status: 'enviada' });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
