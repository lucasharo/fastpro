// Entrada do admin por e-mail e senha | cookie so no acerto, recusa uniforme, limite, origem, logout e fim do codigo.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  handleAdminPasswordRoute,
  isAdminPasswordRoute,
  type AdminPasswordRouteOptions,
} from '../src/admin-login/admin-password-route.js';

const ADMIN = 'https://admin.fastpro.example';
const EQUIPE = 'equipe@fastpro.example';
const SENHA = 'senha-sintetica-2099';
const ERRADA = ['senha', 'errada', '2099'].join('-');
const revogados: string[] = [];
let vaga = true;

const opts: AdminPasswordRouteOptions = {
  adminUrl: ADMIN,
  clock: { nowMs: () => Date.UTC(2026, 10, 27, 12) },
  accounts: {
    verify: async (email, password) => (email === EQUIPE && password === SENHA ? { userId: 'adm-1' } : null),
    openSession: async () => ({ secret: 'b'.repeat(43) }),
  },
  limits: { reserve: async () => vaga, release: async () => undefined },
  log: () => undefined,
  revogar: async (hash) => {
    revogados.push(hash);
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer(
    (req, res) => void handleAdminPasswordRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts),
  );
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

describe('entrada do admin por senha', () => {
  it('fora da origem do admin: 403', async () => {
    const r = await post('/v1/admin/auth/login', { email: EQUIPE, password: SENHA }, 'https://outro.example');
    expect(r.status).toBe(403);
    expect(r.cookie).toBeNull();
  });

  it('senha certa abre a sessao com o cookie do admin (HttpOnly, SameSite=Strict, 8 h)', async () => {
    const r = await post('/v1/admin/auth/login', { email: EQUIPE, password: SENHA });
    expect(r.status).toBe(200);
    expect(r.cookie).toContain('__Host-fp_admin=');
    expect(r.cookie).toContain('HttpOnly');
    expect(r.cookie).toContain('SameSite=Strict');
    expect(r.cookie).toContain('Max-Age=28800');
  });

  it('senha errada, e-mail desconhecido ou corpo vazio: 401 sem cookie; limite: 429', async () => {
    for (const corpo of [
      { email: EQUIPE, password: ERRADA },
      { email: 'ninguem@fastpro.example', password: SENHA },
      {},
    ]) {
      const r = await post('/v1/admin/auth/login', corpo);
      expect(r.status).toBe(401);
      expect(r.cookie).toBeNull();
    }
    vaga = false;
    expect((await post('/v1/admin/auth/login', { email: EQUIPE, password: SENHA })).status).toBe(429);
    vaga = true;
  });

  it('corpo grande demais: 400', async () => {
    expect((await post('/v1/admin/auth/login', { email: EQUIPE, password: 'x'.repeat(4000) })).status).toBe(400);
  });

  it('sair revoga a sessao e apaga o cookie', async () => {
    const r = await post('/v1/admin/auth/logout', undefined, ADMIN, `__Host-fp_admin=${'a'.repeat(43)}`);
    expect(r.status).toBe(204);
    expect(r.cookie).toContain('Max-Age=0');
    expect(revogados).toHaveLength(1);
  });

  it('as rotas de codigo por e-mail deixaram de existir', () => {
    expect(isAdminPasswordRoute('POST', '/v1/admin/auth/code')).toBe(false);
    expect(isAdminPasswordRoute('POST', '/v1/admin/auth/verify')).toBe(false);
  });
});
