// H-073 (Issue 83) | Rotas /v1/admin/access-cases via HTTP (docs/factory/60-DESENHO-H073.md §1, §5):
// T-H073-04 (negacoes identicas e 404 identico ao de rota inexistente), T-H073-05 (matriz de rotas e
// rota fora do registro), T-H073-06 (sem justificativa nem texto nas respostas). Servidor de loopback;
// fetch bloqueado; guarda e porta do caso em memoria. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-073');
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_SESSION_COOKIE,
  type AccessCaseListItem,
  type AccessCasePort,
  type AdminGuardRecord,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminAccessCaseRouteOptions } from '../src/admin-access-case-route.js';

const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;
const CONV = '11111111-2222-4333-8444-555555555555';
const CASO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOVO = '99999999-8888-4777-8666-555555555555';
const SENTINELA = 'SENTINELA-JUST-H073-HTTP-zq';
const JUST = `${SENTINELA} motivo juridico detalhado`;

const SEG_SUPORTE = 'example-admin-secret-suporte-h073-000000000';
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-h073-00000';
const SEG_AUDITOR = 'example-admin-secret-auditor-h073-00000000';
const SEG_TOTP_ANTIGO = 'example-admin-secret-totp-antigo-h073-0000';
const SEG_VENCIDA = 'example-admin-secret-vencida-h073-0000000';

function linha(userId: string, roles: string[], permissions: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions,
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * 60 * MIN,
    totpAtMs: T0,
    ...extra,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_SUPORTE, linha('u-suporte', ['suporte'], ['support.completion.correct', 'case.open_sensitive'])],
  [SEG_SUPERADMIN, linha('u-superadmin', ['superadmin'], ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'])],
  [SEG_AUDITOR, linha('u-auditor', ['auditor'], ['audit.read'])],
  [SEG_TOTP_ANTIGO, linha('u-suporte-antigo', ['suporte'], ['case.open_sensitive'], { totpAtMs: T0 - 30 * MIN })],
  [SEG_VENCIDA, linha('u-vencida', ['suporte'], ['case.open_sensitive'], { expiresAtMs: T0 - 1 })],
]);

const chamadas: string[] = [];

/** Porta em memoria. A lista devolve um campo fora da projecao (participantes) para provar que nao sai. */
const port: AccessCasePort = {
  open: async (input) => {
    chamadas.push(`open:${input.actorUserId}`);
  },
  approve: async (input) => {
    chamadas.push(`approve:${input.actorUserId}`);
    return { expiresAtMs: input.nowMs + 30 * MIN };
  },
  close: async (input) => {
    chamadas.push(`close:${input.actorUserId}`);
  },
  list: async (input) => {
    chamadas.push(`list:${input.canAuthorize}`);
    const sujo = {
      id: CASO,
      estado: 'pendente',
      scope_id: CONV,
      justificativa: JUST,
      expires_at: null,
      participantes: ['pessoa-sintetica'],
    };
    const item: AccessCaseListItem = sujo;
    return [item];
  },
};

const OPTS: AdminAccessCaseRouteOptions = {
  guard: async (secret) => LINHAS.get(secret) ?? null,
  deps: { cases: port, newCaseId: () => NOVO },
  baseUrl: BASE,
  clock: { nowMs: () => T0 },
};

interface Resposta {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown> | null;
}

/** Chamada HTTP de loopback. Mutacoes levam JSON e Origin/Sec-Fetch-Site da mesma origem, salvo se indicado. */
function pedir(
  base: string,
  metodo: string,
  caminho: string,
  opts: { readonly segredo?: string; readonly corpo?: unknown; readonly origin?: string; readonly sec?: string } = {},
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const data = opts.corpo === undefined ? '' : JSON.stringify(opts.corpo);
    const headers: Record<string, string> = {};
    if (opts.segredo !== undefined) headers.cookie = `${ADMIN_SESSION_COOKIE}=${opts.segredo}`;
    if (metodo !== 'GET') {
      headers['content-type'] = 'application/json';
      headers.origin = opts.origin ?? BASE;
      headers['sec-fetch-site'] = opts.sec ?? 'same-origin';
      headers['content-length'] = String(Buffer.byteLength(data));
    }
    const req = request(`${base}${caminho}`, { method: metodo, headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        const text = Buffer.concat(partes).toString('utf8');
        let json: Record<string, unknown> | null = null;
        try {
          json = text === '' ? null : (JSON.parse(text) as Record<string, unknown>);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, text, json });
      });
    });
    req.on('error', reject);
    if (data !== '') req.write(data);
    req.end();
  });
}

const CORPO_OK = { conversation_id: CONV, justification: JUST };
const CAMINHO = '/v1/admin/access-cases';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, accessCase: OPTS });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('T-H073-04 e T-H073-05 rotas via HTTP', () => {
  it('sem cookie, sessao vencida ou rota inexistente: 404 com corpo vazio, sem chamada ao caso', async () => {
    chamadas.length = 0;
    const semCookie = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK });
    const vencida = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_VENCIDA });
    const inexistente = await pedir(base, 'DELETE', `${CAMINHO}/${CASO}`, { segredo: SEG_SUPORTE });
    for (const r of [semCookie, vencida, inexistente]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
    }
    expect(chamadas).toEqual([]);
  });

  it('papel sem a permissao da rota (auditor abrindo caso): 403 permission_denied, sem banco', async () => {
    chamadas.length = 0;
    const r = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_AUDITOR });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'permission_denied' });
    expect(chamadas).toEqual([]);
  });

  it('mutacao com Origin de outro site: 403 origem_invalida antes de qualquer decisao de caso', async () => {
    chamadas.length = 0;
    const r = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_SUPORTE, origin: 'https://evil.example.test' });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'origem_invalida' });
    expect(chamadas).toEqual([]);
  });

  it('abrir caso valido: 201 pendente, justificativa so no banco, nada liberado', async () => {
    chamadas.length = 0;
    const r = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_SUPORTE });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: NOVO, status: 'pendente' });
    expect(chamadas).toEqual(['open:u-suporte']);
    expect(r.text).not.toContain(SENTINELA);
  });

  it('justificativa curta ou TOTP antigo: 422 e 403 step_up_required, sem banco', async () => {
    chamadas.length = 0;
    const curta = await pedir(base, 'POST', CAMINHO, { corpo: { conversation_id: CONV, justification: 'curta' }, segredo: SEG_SUPORTE });
    expect(curta.status).toBe(422);
    expect(curta.json).toEqual({ code: 'justificativa_invalida' });
    const antigo = await pedir(base, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_TOTP_ANTIGO });
    expect(antigo.status).toBe(403);
    expect(antigo.json).toEqual({ code: 'step_up_required' });
    expect(chamadas).toEqual([]);
  });

  it('aprovar: so o autorizador (200 ativo com vencimento); suporte e id invalido: 403 permission_denied', async () => {
    chamadas.length = 0;
    const ok = await pedir(base, 'POST', `${CAMINHO}/${CASO}/approve`, { segredo: SEG_SUPERADMIN });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ status: 'ativo', expires_at: new Date(T0 + 30 * MIN).toISOString() });
    const suporte = await pedir(base, 'POST', `${CAMINHO}/${CASO}/approve`, { segredo: SEG_SUPORTE });
    const invalido = await pedir(base, 'POST', `${CAMINHO}/nao-uuid/approve`, { segredo: SEG_SUPERADMIN });
    expect(suporte.json).toEqual({ code: 'permission_denied' });
    expect(invalido.json).toEqual({ code: 'permission_denied' });
    expect(chamadas).toEqual(['approve:u-superadmin']);
  });

  it('listar: canAuthorize segue a permissao; campos fora da projecao nunca saem', async () => {
    chamadas.length = 0;
    const suporte = await pedir(base, 'GET', CAMINHO, { segredo: SEG_SUPORTE });
    const superadmin = await pedir(base, 'GET', CAMINHO, { segredo: SEG_SUPERADMIN });
    expect(suporte.status).toBe(200);
    expect(superadmin.status).toBe(200);
    expect(chamadas).toEqual(['list:false', 'list:true']);
    expect(suporte.text).not.toContain('participantes');
    expect(suporte.text).not.toContain('pessoa-sintetica');
  });

  it('fechar caso: 200 fechado; leitura sem leitor de conversa: 501, e cursor invalido: 422 antes disso', async () => {
    chamadas.length = 0;
    const fechar = await pedir(base, 'POST', `${CAMINHO}/${CASO}/close`, { segredo: SEG_SUPORTE });
    expect(fechar.status).toBe(200);
    expect(fechar.json).toEqual({ status: 'fechado' });
    const leitura = await pedir(base, 'POST', `${CAMINHO}/${CASO}/conversation/read`, { corpo: {}, segredo: SEG_SUPORTE });
    expect(leitura.status).toBe(501);
    expect(leitura.json).toEqual({ code: 'leitura_indisponivel' });
    const cursor = await pedir(base, 'POST', `${CAMINHO}/${CASO}/conversation/read`, { corpo: { cursor: -1 }, segredo: SEG_SUPORTE });
    expect(cursor.status).toBe(422);
    expect(cursor.json).toEqual({ code: 'paginacao_invalida' });
  });

  it('negacoes de caso saem com o mesmo corpo de 403 permission_denied (T-H073-04)', async () => {
    const auditor = await pedir(base, 'POST', `${CAMINHO}/${CASO}/approve`, { segredo: SEG_AUDITOR });
    const invalido = await pedir(base, 'POST', `${CAMINHO}/nao-uuid/close`, { segredo: SEG_SUPORTE });
    expect(auditor.text).toBe(invalido.text);
    expect(auditor.text).toBe(JSON.stringify({ code: 'permission_denied' }));
  });

  it('sem a opcao accessCase montada, as rotas nao existem (404 do app)', async () => {
    const semRota = createServer((req, res) => {
      void handleRequest(req, res, { tickSecret: undefined });
    });
    await new Promise<void>((resolve) => semRota.listen(0, '127.0.0.1', () => resolve()));
    const endereco = `http://127.0.0.1:${(semRota.address() as AddressInfo).port}`;
    try {
      const r = await pedir(endereco, 'POST', CAMINHO, { corpo: CORPO_OK, segredo: SEG_SUPORTE });
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
    } finally {
      await new Promise<void>((resolve) => semRota.close(() => resolve()));
    }
  });
});
