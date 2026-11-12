// H-107 (Issue 116) | Rotas /v1/admin/catalog via HTTP em memoria (docs/factory/81-DESENHO-H107.md §4, §6; 77 CA-01/02).
// 404 identico sem cookie, sem aal2 ou sem catalog.manage (sem tocar a porta); 403 de Origin antes da porta;
// 413 acima de 8 KB; 422 por campo; 409 de versao, sinonimo duplicado e grupo sem servico; 503 sem detalhe.
// Servidor de loopback; guarda e porta falsas. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-107');
};

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_SESSION_COOKIE,
  adminPermissionsOf,
  type AdminGuardRecord,
  type CatalogAdminPort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminCatalogRouteOptions } from '../src/admin-catalog-route.js';
import { montarCatalogoAdmin } from '../src/admin-composicao.js';

const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const BASE = 'https://admin.example.test';
const ID = '11111111-1111-4111-8111-111111111111';
const SEG_SUPER = 'example-admin-secret-superadmin-cat-000000';
const SEG_AUDITOR = 'example-admin-secret-auditor-cat-0000000';
const SEG_SEM_AAL2 = 'example-admin-secret-sem-aal2-cat-0000000';
const SEG_VENCIDO = 'example-admin-secret-vencido-cat-0000000';

function linha(userId: string, roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions: [...adminPermissionsOf(roles)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * HORA,
    totpAtMs: T0,
    ...extra,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_SUPER, linha('u-super', ['superadmin'])],
  [SEG_AUDITOR, linha('u-auditor', ['auditor'])],
  [SEG_SEM_AAL2, linha('u-sem-aal2', ['superadmin'], { aal2: false })],
  [SEG_VENCIDO, linha('u-vencido', ['superadmin'], { expiresAtMs: T0 - 1 })],
]);

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface Pedido {
  readonly metodo?: string;
  readonly caminho: string;
  readonly segredo?: string | null;
  readonly corpo?: unknown;
  readonly textoBruto?: string;
  readonly origem?: string | null;
  readonly semMutacao?: boolean;
}

function pedir(porta: number, p: Pedido): Promise<Resposta> {
  const metodo = p.metodo ?? 'GET';
  const cabecalhos: Record<string, string> = {};
  if (p.segredo !== null) cabecalhos.cookie = `${ADMIN_SESSION_COOKIE}=${p.segredo ?? SEG_SUPER}`;
  let payload: string | undefined;
  if (metodo !== 'GET') {
    payload = p.textoBruto ?? (p.corpo === undefined ? undefined : JSON.stringify(p.corpo));
    cabecalhos['content-type'] = 'application/json';
    cabecalhos['sec-fetch-site'] = 'same-origin';
    if (p.origem !== null) cabecalhos.origin = p.origem ?? BASE;
    if (payload !== undefined) cabecalhos['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: p.caminho, method: metodo, headers: cabecalhos },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function fakePorta(sobrescritas: Partial<CatalogAdminPort> = {}): CatalogAdminPort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    listar: vi.fn(async () => ({ groups: [], services: [], synonyms: [] })),
    salvar: vi.fn(async () => ID),
    revisoes: vi.fn(async () => []),
    ...sobrescritas,
  } as never;
}

async function servidor(opts: AdminCatalogRouteOptions | undefined): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, ...(opts ? { adminCatalog: opts } : {}) });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

const ROTA = '/v1/admin/catalog';

describe('T-H107-API rotas /v1/admin/catalog (CA-01, CA-02; 81 §4)', () => {
  let srv: Server;
  let porta: number;
  let guard: ReturnType<typeof vi.fn>;
  let port: ReturnType<typeof fakePorta>;

  beforeAll(async () => {
    guard = vi.fn(async (secret: string) => LINHAS.get(secret) ?? null);
    port = fakePorta();
    ({ srv, porta } = await servidor({ guard, port, baseUrl: BASE, clock: { nowMs: () => T0 } }));
  });
  afterAll(() => {
    srv.close();
  });
  beforeEach(() => {
    port.listar.mockClear();
    port.salvar.mockClear();
    port.revisoes.mockClear();
    port.salvar.mockImplementation(async () => ID);
  });

  it('sem cookie: 404 identico sem consultar a guarda nem a porta', async () => {
    const r = await pedir(porta, { caminho: ROTA, segredo: null });
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
    expect(guard).not.toHaveBeenCalled();
    expect(port.listar).not.toHaveBeenCalled();
  });

  it('papel sem catalog.manage (auditor): 404 identico e nada chega ao banco', async () => {
    const r = await pedir(porta, { caminho: ROTA, segredo: SEG_AUDITOR });
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
    expect(port.listar).not.toHaveBeenCalled();
  });

  it('sessao sem aal2 e sessao vencida: 404 identico, sem banco de catalogo', async () => {
    for (const segredo of [SEG_SEM_AAL2, SEG_VENCIDO]) {
      const r = await pedir(porta, { caminho: ROTA, segredo });
      expect(r.status).toBe(404);
      expect(r.body).toBe('');
    }
    expect(port.listar).not.toHaveBeenCalled();
  });

  it('superadmin com aal2: GET devolve a leitura e passa a conta ao banco (aal2 verdadeiro)', async () => {
    const r = await pedir(porta, { caminho: ROTA });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.body)).toEqual({ grupos: [], servicos: [], sinonimos: [] });
    expect(port.listar).toHaveBeenCalledWith({
      userId: 'u-super',
      permissions: expect.arrayContaining(['catalog.manage']),
      aal2: true,
    });
  });

  it('criar grupo valido: 201 com o id; alterar com expectedVersion: 200', async () => {
    const criado = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/groups`,
      corpo: { patch: { name: 'Saude', position: 1 } },
    });
    expect(criado.status).toBe(201);
    expect(JSON.parse(criado.body)).toEqual({ id: ID });
    const alterado = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/groups/${ID}`,
      corpo: { expectedVersion: 2, patch: { active: false } },
    });
    expect(alterado.status).toBe(200);
    expect(port.salvar).toHaveBeenLastCalledWith(expect.any(Object), 'group', ID, 2, { active: false });
  });

  it('desativar servico e POST com active false; sinonimo criado com service_id', async () => {
    const d = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/services/${ID}`,
      corpo: { expectedVersion: 1, patch: { active: false } },
    });
    expect(d.status).toBe(200);
    const s = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/synonyms`,
      corpo: { patch: { service_id: ID, term: 'obra' } },
    });
    expect(s.status).toBe(201);
  });

  it('422 por campo: criar grupo sem nome nem posicao; a porta nao e chamada', async () => {
    const r = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups`, corpo: { patch: {} } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({
      code: 'dados_invalidos',
      campos: { name: 'obrigatorio', position: 'obrigatorio' },
    });
    expect(port.salvar).not.toHaveBeenCalled();
  });

  it('422 por campo: corpo nao JSON e modalidade invalida', async () => {
    const naoJson = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups`, textoBruto: '{nao-json' });
    expect(naoJson.status).toBe(422);
    const modalidade = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/services/${ID}`,
      corpo: { expectedVersion: 1, patch: { modality: 'remoto' } },
    });
    expect(JSON.parse(modalidade.body)).toEqual({ code: 'dados_invalidos', campos: { modality: 'invalido' } });
  });

  it('Origin diferente: 403 origem_invalida antes da porta', async () => {
    const r = await pedir(porta, {
      metodo: 'POST',
      caminho: `${ROTA}/groups`,
      corpo: { patch: { name: 'A', position: 1 } },
      origem: 'https://evil.example.test',
    });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ code: 'origem_invalida' });
    expect(port.salvar).not.toHaveBeenCalled();
  });

  it('corpo acima de 8 KB: 413 sem chamar a porta', async () => {
    const grande = { patch: { name: 'x'.repeat(9000), position: 1 } };
    const r = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups`, corpo: grande });
    expect(r.status).toBe(413);
    expect(port.salvar).not.toHaveBeenCalled();
  });

  it('409 de versao em conflito (CT003) e 409 de sinonimo duplicado (23505) com sugestao de reativar', async () => {
    port.salvar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code: 'CT003' });
    });
    const v = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups/${ID}`, corpo: { expectedVersion: 1, patch: { name: 'B' } } });
    expect(v.status).toBe(409);
    expect(JSON.parse(v.body)).toEqual({ code: 'versao_em_conflito' });

    port.salvar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code: '23505' });
    });
    const d = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/synonyms`, corpo: { patch: { service_id: ID, term: 'Obra' } } });
    expect(d.status).toBe(409);
    expect(JSON.parse(d.body)).toEqual({
      code: 'sinonimo_duplicado',
      campos: { term: 'ja_existe' },
      sugestao: 'reativar',
    });
  });

  it('409 de grupo sem servico ativo (CT002)', async () => {
    port.salvar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code: 'CT002' });
    });
    const r = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups/${ID}`, corpo: { expectedVersion: 1, patch: { active: true } } });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toMatchObject({ code: 'grupo_sem_servico_ativo', sugestao: 'ativar_servico_antes' });
  });

  it('erro fora do catalogo: 503 sem detalhe do banco', async () => {
    port.salvar.mockImplementationOnce(async () => {
      throw Object.assign(new Error('senha=segredo no texto'), { code: 'XX000' });
    });
    const r = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/groups`, corpo: { patch: { name: 'A', position: 1 } } });
    expect(r.status).toBe(503);
    expect(r.body).not.toContain('segredo');
    expect(JSON.parse(r.body)).toEqual({ code: 'catalogo_indisponivel' });
  });

  it('revisoes do item: 200 com a lista; entidade desconhecida 404; DELETE nao existe', async () => {
    port.revisoes.mockImplementationOnce(async () => []);
    const ok = await pedir(porta, { caminho: `${ROTA}/groups/${ID}/revisions` });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ revisoes: [] });
    const desconhecida = await pedir(porta, { caminho: `${ROTA}/outros/${ID}/revisions` });
    expect(desconhecida.status).toBe(404);
    const apagar = await pedir(porta, { metodo: 'DELETE', caminho: `${ROTA}/groups/${ID}` });
    expect(apagar.status).toBe(404);
  });

  it('caminho de criacao com id de entidade desconhecida: 404', async () => {
    const r = await pedir(porta, { metodo: 'POST', caminho: `${ROTA}/planos`, corpo: { patch: {} } });
    expect(r.status).toBe(404);
  });
});

describe('T-H107-COMP composicao: sem variavel, sem rota (81 §1, 404)', () => {
  it('sem DATABASE_URL_APP_SYSTEM ou ADMIN_BASE_URL, ou sem a fabrica: undefined', () => {
    const abrir = () => {
      throw new Error('nao deve abrir');
    };
    expect(montarCatalogoAdmin({}, { abrirCliente: abrir })).toBeUndefined();
    expect(montarCatalogoAdmin({ DATABASE_URL_APP_SYSTEM: 'postgres://x' }, { abrirCliente: abrir })).toBeUndefined();
    expect(montarCatalogoAdmin({ ADMIN_BASE_URL: BASE }, { abrirCliente: abrir })).toBeUndefined();
    expect(montarCatalogoAdmin({ DATABASE_URL_APP_SYSTEM: 'postgres://x', ADMIN_BASE_URL: BASE })).toBeUndefined();
  });

  it('com as variaveis e a fabrica: opcoes montadas sem abrir conexao ao criar', () => {
    const abrir = vi.fn(() => ({ query: async () => ({ rows: [] }) }));
    const opts = montarCatalogoAdmin({ DATABASE_URL_APP_SYSTEM: 'postgres://x', ADMIN_BASE_URL: BASE }, { abrirCliente: abrir });
    expect(opts).toBeDefined();
    expect(opts?.baseUrl).toBe(BASE);
  });

  it('sem a opcao adminCatalog no app, as rotas do catalogo sao 404 (sem corpo)', async () => {
    const { srv, porta } = await servidor(undefined);
    try {
      const r = await pedir(porta, { caminho: ROTA, segredo: SEG_SUPER });
      expect(r.status).toBe(404);
      expect(r.body).toBe('');
    } finally {
      srv.close();
    }
  });
});
