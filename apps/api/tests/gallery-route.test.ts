// Galeria do profissional: posse, limite, origem e leitura publica. Portas falsas; sem banco nem Storage.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { GALERIA_MAX, handleGalleryRoute, type GalleryRouteOptions } from '../src/gallery/gallery-route.js';
import { prepararImagemDaGaleria } from '../src/modules/media/gallery-composicao.js';

const ORIGEM = 'http://site.test';
const FOTO = '11111111-1111-4111-8111-111111111111';
let fotos: { id: string; width: number; height: number }[] = [];
const apagadas: string[] = [];

const opts: GalleryRouteOptions = {
  siteUrl: ORIGEM,
  sessions: { authenticate: async () => ({ userId: 'pro' }) },
  store: {
    adicionar: async (_u, id) => {
      fotos.push({ id, width: 10, height: 10 });
      return 'ok';
    },
    doProfissional: async () => fotos,
    doPerfil: async (slug) => (slug === 'visivel' ? fotos : []),
    excluir: async () => true,
  },
  storage: {
    gravar: async () => undefined,
    ler: async () => new Uint8Array([1, 2, 3]),
    apagar: async (id) => {
      apagadas.push(id);
    },
  },
  preparar: async () => ({ bytes: new Uint8Array([9]), width: 10, height: 10 }),
  clock: { nowMs: () => 0 },
};

let servidor: Server;
let base = '';
beforeAll(async () => {
  servidor = createServer((req, res) => void handleGalleryRoute(req, res, req.url ?? '', opts));
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => void servidor.close(() => r())));
beforeEach(() => {
  fotos = [{ id: FOTO, width: 10, height: 10 }];
  apagadas.length = 0;
});

const logado = { cookie: `${SESSION_COOKIE_NAME}=segredo`, origin: ORIGEM, 'sec-fetch-site': 'same-origin' };
const enviarFoto = (headers: Record<string, string>) =>
  fetch(`${base}/v1/professional/gallery`, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...headers }, body: new Uint8Array([1]) });

describe('galeria do profissional', () => {
  it('envio: 201 com sessao e origem; 401 sem sessao; 403 de outra origem; 415 para outro tipo', async () => {
    expect((await enviarFoto(logado)).status).toBe(201);
    expect((await enviarFoto({ origin: ORIGEM, 'sec-fetch-site': 'same-origin' })).status).toBe(401);
    expect((await enviarFoto({ ...logado, origin: 'http://outro.test' })).status).toBe(403);
    expect((await enviarFoto({ ...logado, 'content-type': 'application/pdf' })).status).toBe(415);
  });

  it(`para em ${GALERIA_MAX} fotos`, async () => {
    fotos = Array.from({ length: GALERIA_MAX }, (_, i) => ({ id: `${i}`, width: 1, height: 1 }));
    const r = await enviarFoto(logado);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ code: 'limite_fotos' });
  });

  it('so apaga foto propria', async () => {
    const outra = await fetch(`${base}/v1/professional/gallery/22222222-2222-4222-8222-222222222222`, { method: 'DELETE', headers: logado });
    expect(outra.status).toBe(404);
    expect((await fetch(`${base}/v1/professional/gallery/${FOTO}`, { method: 'DELETE', headers: logado })).status).toBe(200);
    expect(apagadas).toEqual([FOTO]);
  });

  it('perfil publico: lista e imagem so de profissional visivel', async () => {
    expect((await fetch(`${base}/v1/public/professionals/visivel/gallery`)).status).toBe(200);
    expect((await fetch(`${base}/v1/public/professionals/visivel/gallery/${FOTO}`)).headers.get('content-type')).toBe('image/jpeg');
    expect((await fetch(`${base}/v1/public/professionals/oculto/gallery/${FOTO}`)).status).toBe(404);
  });

  it('conteudo que nao e imagem e recusado', async () => {
    expect(await prepararImagemDaGaleria(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
