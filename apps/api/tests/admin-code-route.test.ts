// Entrada do admin por codigo | 202 igual para qualquer e-mail, cookie so com o codigo certo, bloqueio e logout.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAdminCodeRoute, type AdminCodeRouteOptions } from '../src/admin-login/admin-code-route.js';

const ADMIN = 'https://admin.fastpro.example';
const EQUIPE = 'equipe@fastpro.example';
const enviados: { email: string; code: string }[] = [];
const revogados: string[] = [];
let resultado: 'ok' | 'invalido' | 'bloqueado' = 'ok';

const opts: AdminCodeRouteOptions = {
  adminUrl: ADMIN,
  clock: { nowMs: () => Date.UTC(2026, 10, 24, 12) },
  emitir: async (email) => email === EQUIPE,
  enviar: async (email, code) => {
    enviados.push({ email, code });
  },
  conferir: async () => resultado,
  revogar: async (hash) => {
    revogados.push(hash);
  },
  novoCodigo: () => '482913',
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleAdminCodeRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function post(caminho: string, corpo?: unknown, origem = ADMIN, cookie?: string) {
  const r = await fetch(base + caminho, {
    method: 'POST',
    headers: { Origin: origem, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return { status: r.status, cookie: r.headers.get('set-cookie') };
}

describe('entrada do admin por codigo', () => {
  it('fora da origem do admin: 403', async () => {
    expect((await post('/v1/admin/auth/code', { email: EQUIPE }, 'https://outro.example')).status).toBe(403);
  });

  it('pedido de codigo responde 202 para qualquer e-mail, mas so envia para a equipe', async () => {
    enviados.length = 0;
    expect((await post('/v1/admin/auth/code', { email: 'qualquer@exemplo.com' })).status).toBe(202);
    expect((await post('/v1/admin/auth/code', { email: EQUIPE })).status).toBe(202);
    expect(enviados).toEqual([{ email: EQUIPE, code: '482913' }]);
  });

  it('codigo certo abre a sessao com o cookie do admin (HttpOnly, SameSite=Strict, 8 h)', async () => {
    resultado = 'ok';
    const r = await post('/v1/admin/auth/verify', { email: EQUIPE, code: '482913' });
    expect(r.status).toBe(204);
    expect(r.cookie).toContain('__Host-fp_admin=');
    expect(r.cookie).toContain('HttpOnly');
    expect(r.cookie).toContain('SameSite=Strict');
  });

  it('codigo errado: 401 sem cookie; excesso de tentativas: 429', async () => {
    resultado = 'invalido';
    const errado = await post('/v1/admin/auth/verify', { email: EQUIPE, code: '000000' });
    expect(errado.status).toBe(401);
    expect(errado.cookie).toBeNull();
    resultado = 'bloqueado';
    expect((await post('/v1/admin/auth/verify', { email: EQUIPE, code: '000000' })).status).toBe(429);
    expect((await post('/v1/admin/auth/verify', { email: EQUIPE, code: '12' })).status).toBe(401);
  });

  it('sair revoga a sessao e apaga o cookie', async () => {
    const r = await post('/v1/admin/auth/logout', undefined, ADMIN, `__Host-fp_admin=${'a'.repeat(43)}`);
    expect(r.status).toBe(204);
    expect(r.cookie).toContain('Max-Age=0');
    expect(revogados).toHaveLength(1);
  });
});
