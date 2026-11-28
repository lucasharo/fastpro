// Dados editaveis do profissional: sessao, origem, limites, foto e leitura publica. Portas falsas.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { BIO_MAX, handleAccountEditRoute, type AccountEditRouteOptions } from '../src/account-edit/account-edit-route.js';

const ORIGEM = 'http://site.test';
const ANTIGA = '11111111-1111-4111-8111-111111111111';
const salvos: [string, string][] = [];
const apagadas: string[] = [];

const opts: AccountEditRouteOptions = {
  siteUrl: ORIGEM,
  sessions: { authenticate: async () => ({ userId: 'pro' }) },
  store: {
    ler: async () => ({ publicName: 'Seu Zé', bio: null, photoId: ANTIGA, email: 'a@b.test' }),
    salvar: async (_u, nome, bio) => {
      salvos.push([nome, bio]);
      return 'ok';
    },
    trocarFoto: async () => ({ code: 'ok', anterior: ANTIGA }),
    publico: async (slug) => (slug === 'visivel' ? { bio: 'Oi', photoId: null } : null),
  },
  storage: {
    gravar: async () => undefined,
    ler: async () => new Uint8Array([1]),
    apagar: async (id) => void apagadas.push(id),
  },
  preparar: async () => ({ bytes: new Uint8Array([9]), width: 10, height: 10 }),
  clock: { nowMs: () => 0 },
};

let servidor: Server;
let base = '';
beforeAll(async () => {
  servidor = createServer((req, res) => void handleAccountEditRoute(req, res, req.url ?? '', opts));
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => void servidor.close(() => r())));
beforeEach(() => {
  salvos.length = 0;
  apagadas.length = 0;
});

const logado = { cookie: `${SESSION_COOKIE_NAME}=segredo`, origin: ORIGEM, 'content-type': 'application/json' };
const salvar = (corpo: unknown, headers: Record<string, string> = logado) =>
  fetch(`${base}/v1/professional/account`, { method: 'PUT', headers, body: JSON.stringify(corpo) });

describe('dados do profissional', () => {
  it('salva com sessao e origem, dentro dos limites', async () => {
    expect((await salvar({ publicName: ' Seu Zé Pedreiro ', bio: 'Faço de tudo' })).status).toBe(200);
    expect(salvos).toEqual([['Seu Zé Pedreiro', 'Faço de tudo']]);
    expect((await salvar({ publicName: 'A', bio: '' })).status).toBe(422);
    expect((await salvar({ publicName: 'Zé', bio: 'x'.repeat(BIO_MAX + 1) })).status).toBe(422);
    expect((await salvar({ publicName: 'Zé', bio: '' }, { ...logado, origin: 'http://outro.test' })).status).toBe(403);
    expect((await salvar({ publicName: 'Zé', bio: '' }, { origin: ORIGEM, 'content-type': 'application/json' })).status).toBe(401);
  });

  it('foto nova apaga a anterior; tipo errado e recusado', async () => {
    const enviar = (tipo: string) =>
      fetch(`${base}/v1/professional/account/photo`, { method: 'POST', headers: { ...logado, 'content-type': tipo }, body: new Uint8Array([1]) });
    expect((await enviar('application/pdf')).status).toBe(415);
    expect((await enviar('image/jpeg')).status).toBe(201);
    expect(apagadas).toEqual([ANTIGA]);
  });

  it('publico so mostra profissional visivel', async () => {
    expect(await (await fetch(`${base}/v1/public/professionals/visivel/about`)).json()).toEqual({ bio: 'Oi', hasPhoto: false });
    expect((await fetch(`${base}/v1/public/professionals/oculto/about`)).status).toBe(404);
    expect((await fetch(`${base}/v1/public/professionals/visivel/photo`)).status).toBe(404);
  });
});
