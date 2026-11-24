// GET /v1/auth/me | Papel da sessao e renovacao do cookie (sessao que se renova), sem banco e sem rede.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMeRoute, type MeRouteOptions } from '../src/conversations/me-route.js';

const SEGREDO = 'a'.repeat(43);
const AGORA = Date.UTC(2026, 10, 23, 12);
const SETE_DIAS_MS = 7 * 24 * 3600 * 1000;

function opcoes(papel: 'cliente' | 'profissional' | null, renovada = false): MeRouteOptions {
  return {
    sessions: { authenticate: async () => (papel === null ? null : { userId: 'u1' }) },
    profissional: { existe: async () => papel === 'profissional' },
    clock: { nowMs: () => AGORA },
    renovar: async () => ({ renovada, fimMs: renovada ? AGORA + SETE_DIAS_MS : null }),
  };
}

let atual: MeRouteOptions = opcoes('cliente');
let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleMeRoute(req, res, atual));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function chamar(comCookie = true) {
  const r = await fetch(`${base}/v1/auth/me`, { headers: comCookie ? { Cookie: `__Host-fp_sess=${SEGREDO}` } : {} });
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown>, cookie: r.headers.get('set-cookie') };
}

describe('GET /v1/auth/me', () => {
  it('sem cookie ou com sessao invalida responde 401', async () => {
    atual = opcoes('cliente');
    expect((await chamar(false)).status).toBe(401);
    atual = opcoes(null);
    expect((await chamar()).status).toBe(401);
  });

  it('informa o papel (cliente ou profissional) e nada alem dele', async () => {
    atual = opcoes('cliente');
    expect((await chamar()).corpo).toEqual({ papel: 'cliente' });
    atual = opcoes('profissional');
    expect((await chamar()).corpo).toEqual({ papel: 'profissional' });
  });

  it('profissional que ainda nao confirmou o e-mail aparece como profissional_pendente', async () => {
    atual = { ...opcoes('cliente'), pendente: async () => true };
    expect((await chamar()).corpo).toEqual({ papel: 'profissional_pendente' });
  });

  it('quando a sessao e renovada, reenvia o cookie com 7 dias; sem renovacao, nao mexe no cookie', async () => {
    atual = opcoes('cliente', true);
    const renovada = await chamar();
    expect(renovada.cookie).toContain('__Host-fp_sess=');
    expect(renovada.cookie).toContain('Max-Age=604800');
    expect(renovada.cookie).toContain('HttpOnly');
    atual = opcoes('cliente', false);
    expect((await chamar()).cookie).toBeNull();
  });
});
