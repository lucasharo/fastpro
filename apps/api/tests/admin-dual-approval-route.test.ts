// H-105 (Issue 114) | Rotas /v1/admin/{refund|suspension}-approvals via HTTP (docs/factory/80-DESENHO-H105.md §3 e §6):
// T-H105-02 (solicitante e voto repetido), T-H105-03 (matriz papel x rota), T-H105-04 (suspensao em dois votos),
// T-H105-05 (vencimento), T-H105-09 (estorno aprovado sem efeito externo), T-H105-11 (negacoes identicas e
// motivo fora das respostas). Servidor de loopback, guarda e porta em memoria, fetch bloqueado. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-105');
};

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_SESSION_COOKIE,
  adminPermissionsOf,
  type AdminGuardRecord,
  type DualApprovalPort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { AdminDualApprovalRouteOptions } from '../src/admin-dual-approval-route.js';

const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;
const H24 = 24 * 60 * MIN;
const PEDIDO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOVO = '99999999-8888-4777-8666-555555555555';
const PAGAMENTO = '11111111-2222-4333-8444-555555555555';
const PROFISSIONAL = '66666666-7777-4888-8999-000000000000';
const SENTINELA = 'SENTINELA-MOTIVO-H105-HTTP-zq';
const MOTIVO = `${SENTINELA} motivo detalhado do pedido`;

const SEG_FIN_A = 'example-admin-secret-financeiro-a-h105-0000000';
const SEG_FIN_B = 'example-admin-secret-financeiro-b-h105-0000000';
const SEG_SUPORTE = 'example-admin-secret-suporte-h105-000000000000';
const SEG_MOD_A = 'example-admin-secret-moderador-a-h105-0000000';
const SEG_MOD_B = 'example-admin-secret-moderador-b-h105-0000000';
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-h105-000000';
const SEG_AUDITOR = 'example-admin-secret-auditor-h105-00000000000';
const SEG_TOTP_ANTIGO = 'example-admin-secret-totp-antigo-h105-00000';
const SEG_VENCIDA = 'example-admin-secret-vencida-h105-00000000000';

function linha(userId: string, roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions: [...adminPermissionsOf(roles)],
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * 60 * MIN,
    totpAtMs: T0,
    ...extra,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_FIN_A, linha('u-fin-a', ['financeiro'])],
  [SEG_FIN_B, linha('u-fin-b', ['financeiro'])],
  [SEG_SUPORTE, linha('u-suporte', ['suporte'])],
  [SEG_MOD_A, linha('u-mod-a', ['moderador'])],
  [SEG_MOD_B, linha('u-mod-b', ['moderador'])],
  [SEG_SUPERADMIN, linha('u-superadmin', ['superadmin'])],
  [SEG_AUDITOR, linha('u-auditor', ['auditor'])],
  [SEG_TOTP_ANTIGO, linha('u-totp', ['suporte'], { totpAtMs: T0 - 31 * MIN })],
  [SEG_VENCIDA, linha('u-vencida', ['financeiro'], { expiresAtMs: T0 - 1 })],
]);

interface Pedido {
  readonly id: string;
  readonly action: string;
  readonly requester: string;
  readonly subject: string;
  readonly amount: number | null;
  readonly required: number;
  readonly votos: Set<string>;
  status: string;
  readonly expiresAtMs: number;
}

/** Banco em memoria com as mesmas negacoes que a funcao do banco levanta (codigos e mensagens). */
const pedidos = new Map<string, Pedido>();
const negacoes: string[] = [];
const port: DualApprovalPort = {
  async open(input) {
    for (const p of pedidos.values()) {
      if (p.action === input.action && p.subject === input.subjectId && ['pendente', 'aprovada'].includes(p.status)) {
        throw Object.assign(new Error('pedido_ja_aberto'), { code: 'ADM23' });
      }
    }
    const required = input.action === 'estorno' ? ((input.amountCents ?? 0) > 20000 ? 2 : 1) : 2;
    pedidos.set(input.approvalId, {
      id: input.approvalId,
      action: input.action,
      requester: input.actorUserId,
      subject: input.subjectId,
      amount: input.amountCents,
      required,
      votos: new Set(),
      status: 'pendente',
      expiresAtMs: input.nowMs + H24,
    });
  },
  async vote(input) {
    const p = pedidos.get(input.approvalId);
    if (!p || p.action !== input.family) throw Object.assign(new Error('permissao_negada'), { code: '42501' });
    if (p.status !== 'pendente') throw Object.assign(new Error('aprovacao_nao_pendente'), { code: 'ADM27' });
    if (p.expiresAtMs <= input.nowMs) {
      p.status = 'expirada';
      return { status: 'expirada', votes: p.votos.size, required: p.required };
    }
    if (input.actorUserId === p.requester) throw Object.assign(new Error('aprovacao_propria'), { code: '42501' });
    if (p.votos.has(input.actorUserId)) throw Object.assign(new Error('voto_repetido'), { code: '23505' });
    p.votos.add(input.actorUserId);
    if (p.votos.size >= p.required) p.status = p.action === 'suspensao_permanente' ? 'consumida' : 'aprovada';
    return { status: p.status, votes: p.votos.size, required: p.required };
  },
  async cancel(input) {
    const p = pedidos.get(input.approvalId);
    if (!p || p.requester !== input.actorUserId) throw Object.assign(new Error('permissao_negada'), { code: '42501' });
    p.status = 'rejeitada';
  },
  async list(input) {
    return [...pedidos.values()]
      .filter((p) => p.action === input.family)
      .map((p) => ({
        id: p.id,
        tipo: p.action as 'estorno',
        estado: p.status,
        valor_centavos: p.amount,
        subject_ref: p.subject,
        votos: p.votos.size,
        required_approvals: p.required,
        expires_at: new Date(p.expiresAtMs).toISOString(),
        solicitado_por_mim: p.requester === input.actorUserId,
        reason: MOTIVO,
      } as never));
  },
  async recordDenied(input) {
    negacoes.push(input.reasonCode);
  },
};

const OPTS: AdminDualApprovalRouteOptions = {
  guard: async (secret) => LINHAS.get(secret) ?? null,
  deps: { port, newId: () => NOVO },
  baseUrl: BASE,
  clock: { nowMs: () => T0 },
};

interface Resposta {
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown> | null;
  readonly contentType: string | undefined;
}

function pedir(
  base: string,
  metodo: string,
  caminho: string,
  opts: { readonly segredo?: string; readonly corpo?: unknown; readonly origin?: string } = {},
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const data = opts.corpo === undefined ? '' : JSON.stringify(opts.corpo);
    const headers: Record<string, string> = {};
    if (opts.segredo !== undefined) headers.cookie = `${ADMIN_SESSION_COOKIE}=${opts.segredo}`;
    if (metodo !== 'GET') {
      headers['content-type'] = 'application/json';
      headers.origin = opts.origin ?? BASE;
      headers['sec-fetch-site'] = 'same-origin';
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
        resolve({ status: res.statusCode ?? 0, text, json, contentType: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    if (data !== '') req.write(data);
    req.end();
  });
}

const CAMINHO_ESTORNO = '/v1/admin/refund-approvals';
const CAMINHO_SUSPENSAO = '/v1/admin/suspension-approvals';
const CORPO_ESTORNO = { payment_id: PAGAMENTO, amount_cents: 20001, reason: MOTIVO };
const CORPO_SUSPENSAO = { professional_id: PROFISSIONAL, reason: MOTIVO };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, dualApproval: OPTS });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  pedidos.clear();
  negacoes.length = 0;
});

describe('T-H105-03 guarda e 404 identico', () => {
  it('sem cookie, sessao vencida ou rota fora do registro: 404 com corpo vazio, sem banco', async () => {
    const semCookie = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO });
    const vencida = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_VENCIDA });
    const inexistente = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${PEDIDO}/approve`, { segredo: SEG_FIN_A });
    for (const r of [semCookie, vencida, inexistente]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
    }
    expect(pedidos.size).toBe(0);
  });

  it('Financeiro nao pede suspensao e Superadmin nao pede nem vota nada: 403 permission_denied', async () => {
    const financeiroSuspende = await pedir(base, 'POST', CAMINHO_SUSPENSAO, { corpo: CORPO_SUSPENSAO, segredo: SEG_FIN_A });
    const superPede = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_SUPERADMIN });
    const superVota = await pedir(base, 'POST', `${CAMINHO_SUSPENSAO}/${PEDIDO}/vote`, { segredo: SEG_SUPERADMIN });
    for (const r of [financeiroSuspende, superPede, superVota]) {
      expect(r.status).toBe(403);
      expect(r.json).toEqual({ code: 'permission_denied' });
    }
    expect(pedidos.size).toBe(0);
  });

  it('Origin de outro site em mutacao: 403 origem_invalida, sem banco', async () => {
    const r = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A, origin: 'https://evil.example.test' });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'origem_invalida' });
    expect(pedidos.size).toBe(0);
  });
});

describe('T-H105-01 e T-H105-02 pedido e voto via HTTP', () => {
  it('estorno de R$ 200,01 abre pendente com 2 exigidas e o motivo nao volta na resposta', async () => {
    const r = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A });
    expect(r.status).toBe(201);
    expect(r.json).toEqual(expect.objectContaining({ id: NOVO, status: 'pendente', required_approvals: 2 }));
    expect(r.text).not.toContain(SENTINELA);
    expect(pedidos.get(NOVO)?.amount).toBe(20001);
  });

  it('valor zero e motivo curto sao 422 sem banco', async () => {
    const valor = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: { ...CORPO_ESTORNO, amount_cents: 0 }, segredo: SEG_FIN_A });
    const motivo = await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: { ...CORPO_ESTORNO, reason: 'curto' }, segredo: SEG_FIN_A });
    expect(valor.json).toEqual({ code: 'valor_invalido' });
    expect(motivo.json).toEqual({ code: 'motivo_invalido' });
    expect(pedidos.size).toBe(0);
  });

  it('solicitante votando no proprio pedido e o mesmo aprovador duas vezes: 403 identico, com negacao registrada', async () => {
    await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A });
    const auto = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/vote`, { segredo: SEG_FIN_A });
    const sem = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/vote`, { segredo: SEG_SUPORTE });
    await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/vote`, { segredo: SEG_FIN_B });
    const repetido = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/vote`, { segredo: SEG_FIN_B });
    expect(auto.status).toBe(403);
    expect(repetido.status).toBe(403);
    expect(auto.text).toBe(sem.text);
    expect(repetido.text).toBe(sem.text);
    expect(auto.contentType).toBe(sem.contentType);
    expect(negacoes).toEqual(expect.arrayContaining(['autoaprovacao', 'voto_repetido']));
  });

  it('suspensao: o primeiro Moderador deixa pendente; o segundo consome e suspende', async () => {
    await pedir(base, 'POST', CAMINHO_SUSPENSAO, { corpo: CORPO_SUSPENSAO, segredo: SEG_SUPORTE });
    const um = await pedir(base, 'POST', `${CAMINHO_SUSPENSAO}/${NOVO}/vote`, { segredo: SEG_MOD_A });
    const dois = await pedir(base, 'POST', `${CAMINHO_SUSPENSAO}/${NOVO}/vote`, { segredo: SEG_MOD_B });
    expect(um.json).toEqual({ status: 'pendente', votes: 1, required_approvals: 2 });
    expect(dois.json).toEqual({ status: 'consumida', votes: 2, required_approvals: 2 });
  });

  it('suspensao com a prova de TOTP antiga (31 min): 403 step_up_required', async () => {
    const r = await pedir(base, 'POST', CAMINHO_SUSPENSAO, { corpo: CORPO_SUSPENSAO, segredo: SEG_TOTP_ANTIGO });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'step_up_required' });
  });
});

describe('T-H105-05 vencimento e T-H105-11 listagem e cancelamento', () => {
  it('voto depois de 24 h: 409 aprovacao_expirada', async () => {
    pedidos.set(PEDIDO, {
      id: PEDIDO,
      action: 'estorno',
      requester: 'u-fin-a',
      subject: PAGAMENTO,
      amount: 20001,
      required: 2,
      votos: new Set(),
      status: 'pendente',
      expiresAtMs: T0 - 1,
    });
    const r = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${PEDIDO}/vote`, { segredo: SEG_FIN_B });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ code: 'aprovacao_expirada' });
  });

  it('listagem nao devolve o motivo de nenhum pedido', async () => {
    await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A });
    const r = await pedir(base, 'GET', CAMINHO_ESTORNO, { segredo: SEG_FIN_A });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(SENTINELA);
    expect(r.text).not.toContain('"reason"');
  });

  it('cancelamento por quem nao pediu: 403; pelo solicitante: 200 rejeitada', async () => {
    await pedir(base, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A });
    const outro = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/cancel`, { segredo: SEG_FIN_B });
    const dono = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${NOVO}/cancel`, { segredo: SEG_FIN_A });
    expect(outro.status).toBe(403);
    expect(outro.json).toEqual({ code: 'permission_denied' });
    expect(dono.json).toEqual({ status: 'rejeitada' });
  });

  it('estorno aprovado nao aciona nada fora da porta: a resposta e aprovada, sem execucao', async () => {
    pedidos.set(PEDIDO, {
      id: PEDIDO,
      action: 'estorno',
      requester: 'u-fin-a',
      subject: PAGAMENTO,
      amount: 15000,
      required: 1,
      votos: new Set(),
      status: 'pendente',
      expiresAtMs: T0 + H24,
    });
    const r = await pedir(base, 'POST', `${CAMINHO_ESTORNO}/${PEDIDO}/vote`, { segredo: SEG_FIN_B });
    expect(r.json).toEqual({ status: 'aprovada', votes: 1, required_approvals: 1 });
    expect(r.text).not.toMatch(/consumida|pago|refund/i);
  });
});

describe('sem a opcao dualApproval, as rotas nao existem', () => {
  it('404 vazio mesmo com sessao valida', async () => {
    const semOpcao = createServer((req, res) => {
      void handleRequest(req, res, { tickSecret: undefined });
    });
    await new Promise<void>((resolve) => semOpcao.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(semOpcao.address() as AddressInfo).port}`;
    try {
      const r = await pedir(url, 'POST', CAMINHO_ESTORNO, { corpo: CORPO_ESTORNO, segredo: SEG_FIN_A });
      expect(r.status).toBe(404);
      expect(r.text).toBe('');
    } finally {
      await new Promise<void>((resolve) => semOpcao.close(() => resolve()));
    }
  });
});
