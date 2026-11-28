// Console admin | Guarda por sessao e permissao (404 vazio sem acesso), Origin nas decisoes e respostas das listas.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAdminModerationRoute, type AdminModerationRouteOptions } from '../src/admin-login/admin-moderation-route.js';

const ADMIN = 'https://admin.fastpro.example';
const DENUNCIA = '11111111-1111-4111-8111-111111111111';
let permissoes: string[] = ['moderation.decide'];
const consultas: string[] = [];
let ultimaPagina: unknown[] | undefined;
let ultimoCadastro: unknown[] | undefined;
let resultadoCadastro = 'ok';

const opts: AdminModerationRouteOptions = {
  adminUrl: ADMIN,
  clock: { nowMs: () => Date.UTC(2026, 10, 24, 12) },
  client: {
    query: async (sql: string, params?: unknown[]) => {
      consultas.push(sql);
      if (sql.includes('admin_guard')) return { rows: permissoes.length ? [{ out_user_id: 'adm-1', out_permissions: permissoes }] : [] };
      if (sql.includes('admin_reports_list')) return { rows: [{ out_id: DENUNCIA, out_reason: 'spam', out_status: 'aberto', out_service_name: 'Pintor' }] };
      if (sql.includes('admin_report_decide')) return { rows: [{ r: 'ok' }] };
      if (sql.includes('catalog_admin_page')) {
        ultimaPagina = params;
        return { rows: [{ r: { total: 1253, items: [{ id: 'y1' }] } }] };
      }
      if (sql.includes('admin_staff_create')) {
        ultimoCadastro = params;
        return { rows: [{ r: resultadoCadastro }] };
      }
      return { rows: [] };
    },
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleAdminModerationRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const COOKIE = { Cookie: `__Host-fp_admin=${'a'.repeat(43)}` };

describe('console admin: moderacao', () => {
  it('sem cookie: 404 vazio, sem consultar o banco', async () => {
    consultas.length = 0;
    const r = await fetch(`${base}/v1/admin/moderation/reports`);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('');
    expect(consultas).toEqual([]);
  });

  it('sessao sem a permissao: 404 vazio (igual a rota inexistente)', async () => {
    permissoes = ['catalog.manage'];
    const r = await fetch(`${base}/v1/admin/moderation/reports`, { headers: COOKIE });
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('');
  });

  it('moderador lista as denuncias', async () => {
    permissoes = ['moderation.decide'];
    const r = await fetch(`${base}/v1/admin/moderation/reports?status=aberto`, { headers: COOKIE });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { items: { id: string }[] };
    expect(corpo.items[0]?.id).toBe(DENUNCIA);
  });

  it('decisao exige Origin do admin e decisao valida', async () => {
    const semOrigem = await fetch(`${base}/v1/admin/moderation/reports/${DENUNCIA}/decision`, {
      method: 'POST',
      headers: { ...COOKIE, Origin: 'https://outro.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisao: 'resolvido' }),
    });
    expect(semOrigem.status).toBe(403);
    const invalida = await fetch(`${base}/v1/admin/moderation/reports/${DENUNCIA}/decision`, {
      method: 'POST',
      headers: { ...COOKIE, Origin: ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisao: 'apagar' }),
    });
    expect(invalida.status).toBe(400);
    const ok = await fetch(`${base}/v1/admin/moderation/reports/${DENUNCIA}/decision`, {
      method: 'POST',
      headers: { ...COOKIE, Origin: ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisao: 'resolvido' }),
    });
    expect(ok.status).toBe(200);
  });

  it('auditoria exige audit.read', async () => {
    permissoes = ['moderation.decide'];
    expect((await fetch(`${base}/v1/admin/audit/recent`, { headers: COOKIE })).status).toBe(404);
    permissoes = ['audit.read'];
    expect((await fetch(`${base}/v1/admin/audit/recent`, { headers: COOKIE })).status).toBe(200);
  });

  it('catalogo: exige catalog.manage e pagina no banco de 50 em 50 com os filtros', async () => {
    permissoes = ['moderation.decide'];
    expect((await fetch(`${base}/v1/admin/listas/catalogo?aba=sinonimos`, { headers: COOKIE })).status).toBe(404);
    permissoes = ['catalog.manage'];
    const r = await fetch(`${base}/v1/admin/listas/catalogo?aba=sinonimos&pagina=3&q=pia&situacao=ativos&grupo=nao-uuid`, { headers: COOKIE });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { total: number; pagina: number; porPagina: number };
    expect(corpo).toMatchObject({ total: 1253, pagina: 3, porPagina: 50 });
    expect(ultimaPagina).toEqual(['synonym', 'pia', true, null, null, 100, 50]);
    expect((await fetch(`${base}/v1/admin/listas/catalogo?aba=outra`, { headers: COOKIE })).status).toBe(400);
  });
});

describe('console admin: cadastro de admin pela Equipe', () => {
  const senha = ['senha', 'sintetica', '2099'].join('-');
  const novo = { email: 'Nova@Fastpro.example', password: senha, roles: ['verificacao'] };
  const cadastrar = (corpo: unknown, headers: Record<string, string> = { ...COOKIE, Origin: ADMIN }) =>
    fetch(`${base}/v1/admin/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(corpo),
    });

  it('sem sessao ou sem admin.role.manage: 404 vazio e nada gravado', async () => {
    ultimoCadastro = undefined;
    permissoes = ['admin.role.manage'];
    expect((await cadastrar(novo, { Origin: ADMIN })).status).toBe(404);
    permissoes = ['catalog.manage'];
    expect((await cadastrar(novo)).status).toBe(404);
    expect(ultimoCadastro).toBeUndefined();
  });

  it('fora da origem do admin: 403', async () => {
    permissoes = ['admin.role.manage'];
    expect((await cadastrar(novo, { ...COOKIE, Origin: 'https://outro.example' })).status).toBe(403);
  });

  it('recusa e-mail, senha curta, papel vazio, desconhecido ou superadmin', async () => {
    permissoes = ['admin.role.manage'];
    ultimoCadastro = undefined;
    const curta = senha.slice(0, 5);
    for (const [corpo, campo] of [
      [{ ...novo, email: 'x' }, 'email'],
      [{ ...novo, password: curta }, 'password'],
      [{ ...novo, roles: [] }, 'roles'],
      [{ ...novo, roles: ['dono'] }, 'roles'],
      [{ ...novo, roles: ['superadmin'] }, 'roles'],
    ] as const) {
      const r = await cadastrar(corpo);
      expect(r.status).toBe(422);
      expect(((await r.json()) as { campo: string }).campo).toBe(campo);
    }
    expect(ultimoCadastro).toBeUndefined();
  });

  it('cadastra com o hash (nunca a senha) e o e-mail normalizado: 201', async () => {
    permissoes = ['admin.role.manage'];
    resultadoCadastro = 'ok';
    expect((await cadastrar(novo)).status).toBe(201);
    expect(ultimoCadastro?.[0]).toBe('adm-1');
    expect(ultimoCadastro?.[1]).toBe('nova@fastpro.example');
    expect(String(ultimoCadastro?.[2])).toMatch(/^scrypt\$/);
    expect(JSON.stringify(ultimoCadastro)).not.toContain(novo.password);
    expect(ultimoCadastro?.[3]).toEqual(['verificacao']);
  });

  it('e-mail que ja tem conta: 409', async () => {
    permissoes = ['admin.role.manage'];
    resultadoCadastro = 'email_indisponivel';
    expect((await cadastrar(novo)).status).toBe(409);
  });
});
