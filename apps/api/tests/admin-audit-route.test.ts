// H-104 (Issue 113) | Rota POST /v1/admin/audit/queries via HTTP (docs/factory/63-DESENHO-H104.md §3, §5):
// T-H104-02 (200, 404, 403, 422, 429, 503 e negacoes que nao consomem vaga), T-H104-03 (matriz de rotas:
// PUT/PATCH/DELETE em /v1/admin/audit/* sao 404; aprovar estorno do Auditor e 403) e T-H104-05 (sentinelas).
// Servidor de loopback; fetch bloqueado; repositorio, consulta e limite em memoria. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-104');
};

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_AUDIT_QUERY_PATH,
  ADMIN_ROUTES,
  ADMIN_SESSION_COOKIE,
  AUDIT_QUERY_RATE_LIMIT,
  AUDIT_QUERY_RATE_WINDOW_MS,
  guardAdminRequest,
  type AdminGuardRecord,
  type AdminRepository,
  type AdminRouteSpec,
  type AuditQueryInput,
  type AuditQueryPort,
  type AuditQueryRateLimit,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminAuditRouteOptions } from '../src/admin-audit-route.js';

const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const UUID = '6f1c2b7a-9d4e-4a3b-8c2d-1e0f9a8b7c6d';
const SENTINELA = 'SENTINELA-H104-EMAIL-ztq@example.test';
const SEG_AUDITOR = 'example-admin-secret-auditor-000000000000';
const SEG_FINANCEIRO = 'example-admin-secret-financeiro-00000000000';
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-0000000000';
const SEG_REVOGADO = 'example-admin-secret-revogado-00000000000';

const CORPO_OK = JSON.stringify({ from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z' });

function linha(userId: string, roles: string[], permissions: string[]): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions,
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * HORA,
    totpAtMs: T0,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_AUDITOR, linha('u-auditor', ['auditor'], ['audit.read'])],
  [SEG_FINANCEIRO, linha('u-financeiro', ['financeiro'], ['finance.refund.request', 'finance.refund.approve'])],
  [SEG_SUPERADMIN, linha('u-superadmin', ['superadmin'], ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'])],
]);

/** Evento com campos extras (prev_hash, row_hash, e-mail): a projecao da rota nao pode devolve-los. */
const EVENTO = {
  seq: 1,
  id: UUID,
  at: '2099-01-01T00:00:00.000000Z',
  actor_ref: 'admin:u-auditor',
  actor_role: 'auditor',
  action: 'consent.changed',
  object_type: 'contact_consent',
  object_id: UUID,
  before_state: {},
  after_state: { granted: 'sim' },
  reason_code: null,
  correlation_id: null,
  prev_hash: 'hash-anterior-sintetico',
  row_hash: 'hash-linha-sintetico',
  email: SENTINELA,
};

interface Mundo {
  readonly opts: AdminAuditRouteOptions;
  readonly guard: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly take: ReturnType<typeof vi.fn>;
}

/** Limite em memoria com o contrato da porta (janela de 5 min, 30 vagas por admin). */
function limiteFake(): { limits: AuditQueryRateLimit; take: ReturnType<typeof vi.fn> } {
  const usados: { admin: string; at: number }[] = [];
  const take = vi.fn(async (admin: string, now: number) => {
    const n = usados.filter((u) => u.admin === admin && u.at >= now - AUDIT_QUERY_RATE_WINDOW_MS).length;
    if (n >= AUDIT_QUERY_RATE_LIMIT) return false;
    usados.push({ admin, at: now });
    return true;
  });
  return { limits: { take } as AuditQueryRateLimit, take };
}

function mundo(over: { query?: AuditQueryPort['query'] } = {}): Mundo {
  const guard = vi.fn(async (secret: string) => LINHAS.get(secret) ?? null);
  const query = vi.fn(
    over.query ??
      (async () => ({ consulta_id: UUID, eventos: [EVENTO], tem_mais: false, proximo_cursor: 1 })),
  );
  const { limits, take } = limiteFake();
  const opts: AdminAuditRouteOptions = {
    guard,
    deps: { query: { query } as unknown as AuditQueryPort, limits },
    baseUrl: BASE,
    clock: { nowMs: () => T0 },
  };
  return { opts, guard, query, take };
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface Envio {
  readonly metodo?: string;
  readonly caminho?: string;
  readonly cookie?: string | null;
  readonly origin?: string;
  readonly site?: string;
  readonly contentType?: string;
  readonly corpo?: string;
}

function enviar(porta: number, e: Envio = {}): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {
    origin: e.origin ?? BASE,
    'sec-fetch-site': e.site ?? 'same-origin',
    'content-type': e.contentType ?? 'application/json',
  };
  const cookie = e.cookie === undefined ? `${ADMIN_SESSION_COOKIE}=${SEG_AUDITOR}` : e.cookie;
  if (cookie !== null) cabecalhos.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        path: e.caminho ?? ADMIN_AUDIT_QUERY_PATH,
        method: e.metodo ?? 'POST',
        headers: cabecalhos,
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(e.corpo ?? CORPO_OK);
  });
}

async function servidor(opts: AdminAuditRouteOptions): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, admin: opts });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

describe('T-H104-02 rota POST /v1/admin/audit/queries via HTTP', () => {
  let srv: Server;
  let porta: number;
  let m: Mundo;

  beforeAll(async () => {
    m = mundo();
    ({ srv, porta } = await servidor(m.opts));
  });
  afterAll(() => {
    srv.close();
  });

  it('Auditor com sessao e corpo valido recebe 200 com a lista fechada de campos', async () => {
    const r = await enviar(porta);
    expect(r.status).toBe(200);
    const json = JSON.parse(r.body) as { consulta_id: string; eventos: Record<string, unknown>[]; tem_mais: boolean };
    expect(json.consulta_id).toBe(UUID);
    expect(json.eventos).toHaveLength(1);
    expect(Object.keys(json.eventos[0] ?? {}).sort()).toEqual(
      ['action', 'actor_ref', 'actor_role', 'after_state', 'before_state', 'correlation_id', 'id', 'at',
        'object_id', 'object_type', 'reason_code', 'seq'].sort(),
    );
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a porta de consulta recebe o admin da guarda e o segredo do cookie (o hash e feito no adaptador do banco)', async () => {
    m.query.mockClear();
    await enviar(porta);
    const entrada = m.query.mock.calls[0]?.[0] as AuditQueryInput | undefined;
    expect(entrada?.actorUserId).toBe('u-auditor');
    expect(entrada?.secret).toBe(SEG_AUDITOR);
    expect(entrada?.limit).toBe(50);
  });

  it('sem cookie: 404 identico ao de rota inexistente, sem consultar o banco', async () => {
    m.guard.mockClear();
    const semCookie = await enviar(porta, { cookie: null });
    const inexistente = await enviar(porta, { caminho: '/v1/admin/inexistente' });
    expect(semCookie.status).toBe(404);
    expect(semCookie.body).toBe(inexistente.body);
    expect(semCookie.headers['cache-control']).toBe(inexistente.headers['cache-control']);
    expect(semCookie.headers['content-type']).toBeUndefined();
    expect(m.guard).not.toHaveBeenCalled();
  });

  it('sessao revogada, vencida ou sem papel ativo: 404 identico, sem entrada e sem consulta', async () => {
    m.query.mockClear();
    const r = await enviar(porta, { cookie: `${ADMIN_SESSION_COOKIE}=${SEG_REVOGADO}` });
    const inexistente = await enviar(porta, { caminho: '/v1/admin/inexistente' });
    expect(r.status).toBe(404);
    expect(r.body).toBe(inexistente.body);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('Financeiro e Superadmin: 403 permission_denied, sem consulta', async () => {
    m.query.mockClear();
    for (const seg of [SEG_FINANCEIRO, SEG_SUPERADMIN]) {
      const r = await enviar(porta, { cookie: `${ADMIN_SESSION_COOKIE}=${seg}` });
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ code: 'permission_denied' });
    }
    expect(m.query).not.toHaveBeenCalled();
  });

  it('Origin de outro site ou corpo que nao e JSON: 403 origem_invalida, sem consulta', async () => {
    m.query.mockClear();
    const origem = await enviar(porta, { origin: 'https://outro.example.test' });
    const tipo = await enviar(porta, { contentType: 'text/plain' });
    expect(origem.status).toBe(403);
    expect(JSON.parse(origem.body)).toEqual({ code: 'origem_invalida' });
    expect(tipo.status).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('validacao: 422 com codigo e nome do campo, sem eco do valor recebido', async () => {
    const casos: [string, string][] = [
      ['periodo invertido', JSON.stringify({ from: '2099-01-02T00:00:00Z', to: '2099-01-01T00:00:00Z' })],
      ['sem periodo', JSON.stringify({})],
      ['acima de 90 dias', JSON.stringify({ from: '2098-01-01T00:00:00Z', to: '2099-01-01T00:00:00Z' })],
      ['limit 0', JSON.stringify({ from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z', limit: 0 })],
      ['campo desconhecido', JSON.stringify({ from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z', x: SENTINELA })],
      ['filtro com valor livre', JSON.stringify({ from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z', action: SENTINELA })],
      ['corpo nao JSON', `{${SENTINELA}`],
    ];
    for (const [nome, corpo] of casos) {
      const r = await enviar(porta, { corpo });
      expect(r.status, nome).toBe(422);
      expect(r.body, nome).not.toContain(SENTINELA);
      expect(JSON.parse(r.body), nome).toHaveProperty('code');
    }
  });
});

describe('T-H104-02 limite de 429 e negacoes que nao consomem vaga', () => {
  it('a 31a consulta na janela recebe 429 muitas_consultas; 403, 404 e 422 nao gastam vaga', async () => {
    const m = mundo();
    const { srv, porta } = await servidor(m.opts);
    try {
      // Negacoes e 422 antes das 30 aceitas: nenhuma delas pode consumir vaga.
      await enviar(porta, { cookie: `${ADMIN_SESSION_COOKIE}=${SEG_FINANCEIRO}` });
      await enviar(porta, { cookie: null });
      await enviar(porta, { corpo: '{}' });
      expect(m.take).not.toHaveBeenCalled();

      for (let i = 0; i < AUDIT_QUERY_RATE_LIMIT; i++) {
        expect((await enviar(porta)).status).toBe(200);
      }
      const bloqueada = await enviar(porta);
      expect(bloqueada.status).toBe(429);
      expect(JSON.parse(bloqueada.body)).toEqual({ code: 'muitas_consultas' });
      expect(m.query).toHaveBeenCalledTimes(AUDIT_QUERY_RATE_LIMIT);
    } finally {
      srv.close();
    }
  });
});

describe('T-H104-02 falha do banco: 503 sem dado; 404 quando a sessao cai na hora da consulta', () => {
  it('erro generico da consulta vira 503 auditoria_indisponivel, sem linha de evento', async () => {
    const m = mundo({
      query: async () => {
        throw new Error('falha de conexao sintetica');
      },
    });
    const { srv, porta } = await servidor(m.opts);
    try {
      const r = await enviar(porta);
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ code: 'auditoria_indisponivel' });
      expect(r.body).not.toContain(SENTINELA);
    } finally {
      srv.close();
    }
  });

  it('ADM30 do banco (sessao revogada entre a guarda e a consulta) vira 404 identico', async () => {
    const erro = Object.assign(new Error('sessao_invalida'), { code: 'ADM30' });
    const m = mundo({
      query: async () => {
        throw erro;
      },
    });
    const { srv, porta } = await servidor(m.opts);
    try {
      const r = await enviar(porta);
      const inexistente = await enviar(porta, { caminho: '/v1/admin/inexistente' });
      expect(r.status).toBe(404);
      expect(r.body).toBe(inexistente.body);
    } finally {
      srv.close();
    }
  });
});

describe('T-H104-03 matriz de rotas: PUT, PATCH e DELETE em /v1/admin/audit/* sao 404; aprovar estorno e 403', () => {
  it('HTTP: verbos fora do registro respondem 404 identico ao de rota inexistente, sem chamar a guarda', async () => {
    const m = mundo();
    const { srv, porta } = await servidor(m.opts);
    try {
      const inexistente = await enviar(porta, { caminho: '/v1/admin/inexistente' });
      const casos: [string, string][] = [
        ['PUT', ADMIN_AUDIT_QUERY_PATH],
        ['PATCH', ADMIN_AUDIT_QUERY_PATH],
        ['DELETE', ADMIN_AUDIT_QUERY_PATH],
        ['PUT', '/v1/admin/audit/events/6f1c2b7a-9d4e-4a3b-8c2d-1e0f9a8b7c6d'],
        ['DELETE', '/v1/admin/audit/events/6f1c2b7a-9d4e-4a3b-8c2d-1e0f9a8b7c6d'],
      ];
      for (const [metodo, caminho] of casos) {
        const r = await enviar(porta, { metodo, caminho, corpo: '' });
        expect(r.status, `${metodo} ${caminho}`).toBe(404);
        expect(r.body, `${metodo} ${caminho}`).toBe(inexistente.body);
      }
      expect(m.guard).not.toHaveBeenCalled();
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      srv.close();
    }
  });

  it('registro: so POST em /v1/admin/audit/queries; nenhuma rota de alteracao ou exclusao em /v1/admin/audit/*', () => {
    const auditoria = ADMIN_ROUTES.filter((r) => r.pattern.startsWith('/v1/admin/audit'));
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ method: 'POST', pattern: ADMIN_AUDIT_QUERY_PATH, permission: 'audit.read' });
  });

  it('Auditor tentando aprovar estorno recebe 403 permission_denied pela guarda, sem alteracao', async () => {
    const estorno: AdminRouteSpec = {
      method: 'POST',
      pattern: '/v1/admin/refunds/:id/approve',
      permission: 'finance.refund.approve',
    };
    const repo = { guard: vi.fn(async (secret: string) => LINHAS.get(secret) ?? null) };
    const resultado = await guardAdminRequest(
      {
        method: 'POST',
        path: '/v1/admin/refunds/123/approve',
        secret: SEG_AUDITOR,
        headers: { contentType: 'application/json', origin: BASE, secFetchSite: 'same-origin' },
      },
      { repo: repo as unknown as AdminRepository, registry: [...ADMIN_ROUTES, estorno], baseUrl: BASE },
      T0,
    );
    expect(resultado.kind).toBe('recusada');
    if (resultado.kind === 'recusada') {
      expect(resultado.response.status).toBe(403);
      expect(resultado.response.body).toEqual({ code: 'permission_denied' });
    }
  });
});
