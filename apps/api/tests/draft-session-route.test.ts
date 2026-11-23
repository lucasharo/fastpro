// /v1/auth/me/draft-identity | Pedido de quem ja esta logado: e-mail da sessao, nome do ultimo pedido, sem codigo.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDraftSessionRoute, type DraftSessionRouteOptions } from '../src/conversations/draft-session-route.js';

const SITE = 'https://fastpro.example';
const gravados: { firstName: string; email: string }[] = [];
let nomeAnterior: string | null = 'Lucas';
let sessaoValida = true;

const opts: DraftSessionRouteOptions = {
  siteUrl: SITE,
  clock: { nowMs: () => Date.UTC(2026, 10, 23, 12) },
  identidade: async () => (sessaoValida ? { email: 'Cliente@Exemplo.com', firstName: nomeAnterior } : null),
  gravar: async (i) => {
    gravados.push({ firstName: i.firstName, email: i.email });
    return 'ok';
  },
  emailHmac: (email) => `hmac:${email}`,
  draftHash: (secret) => `hash:${secret}`,
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleDraftSessionRoute(req, res, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const COOKIES = `__Host-fp_sess=${'s'.repeat(43)}; __Host-fp_draft=${'d'.repeat(43)}`;

async function post(corpo: unknown, cookies = COOKIES, origem = SITE) {
  const r = await fetch(`${base}/v1/auth/me/draft-identity`, {
    method: 'POST',
    headers: { Cookie: cookies, Origin: origem, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

describe('POST /v1/auth/me/draft-identity', () => {
  it('sem Origin da aplicacao: 403; sem sessao: 401', async () => {
    expect((await post({}, COOKIES, 'https://outro.example')).status).toBe(403);
    sessaoValida = false;
    expect((await post({})).status).toBe(401);
    sessaoValida = true;
  });

  it('usa o nome do ultimo pedido e o e-mail da sessao (normalizado), nunca do corpo', async () => {
    nomeAnterior = 'Lucas';
    const r = await post({});
    expect(r.status).toBe(200);
    expect(gravados.at(-1)).toEqual({ firstName: 'Lucas', email: 'cliente@exemplo.com' });
    expect((await post({ email: 'outro@exemplo.com' })).status).toBe(400);
  });

  it('sem pedido anterior e sem nome no corpo: 422 nome_necessario; com nome: grava', async () => {
    nomeAnterior = null;
    const sem = await post({});
    expect(sem.status).toBe(422);
    expect(sem.corpo.code).toBe('nome_necessario');
    expect((await post({ first_name: 'Ana' })).status).toBe(200);
    expect(gravados.at(-1)?.firstName).toBe('Ana');
  });

  it('sem cookie do rascunho: 404', async () => {
    nomeAnterior = 'Lucas';
    expect((await post({}, `__Host-fp_sess=${'s'.repeat(43)}`)).status).toBe(404);
  });
});
