// Pacote A | Rotas de concluir, desfazer, cancelar e retirar aceite com loja em memoria (sem rede e sem banco).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleLifecycleRoute, isLifecycleRoute, type LifecycleRouteOptions } from '../src/lifecycle/lifecycle-route.js';

const SITE = 'https://fastpro.example';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PROFISSIONAL = '66666666-6666-4666-8666-666666666666';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ACEITE = '33333333-3333-4333-8333-333333333333';

const chamadas: string[] = [];
let usuarioSessao = CLIENTE;
// A regra das 24 h mora no banco (private.request_uncomplete); aqui a loja simula o desfecho.
let prazoEncerrado = false;
const SEM_DATA = { status: null, completedAt: null, cancelledAt: null };
const NAO_ACHADO = { outcome: 'nao_encontrado' as const, ...SEM_DATA };

const opts: LifecycleRouteOptions = {
  siteUrl: SITE,
  sessions: { authenticate: async () => ({ userId: usuarioSessao }) },
  clock: { nowMs: () => Date.UTC(2026, 10, 23, 12) },
  store: {
    concluir: async (pedido, cliente) => {
      chamadas.push(`concluir:${pedido}:${cliente}`);
      if (pedido !== PEDIDO || cliente !== CLIENTE) return NAO_ACHADO;
      return { outcome: 'concluido', status: 'concluido', completedAt: '2026-11-23T12:00:00.000Z', cancelledAt: null };
    },
    desfazerConclusao: async (pedido, cliente, agora) => {
      chamadas.push(`desfazer:${pedido}:${cliente}:${agora.toISOString()}`);
      if (pedido !== PEDIDO || cliente !== CLIENTE) return NAO_ACHADO;
      return prazoEncerrado
        ? { outcome: 'prazo_encerrado', status: 'concluido', completedAt: '2026-11-22T12:00:00.000Z', cancelledAt: null }
        : { outcome: 'desfeito', status: 'selecionado', completedAt: null, cancelledAt: null };
    },
    cancelar: async (pedido, cliente) => {
      chamadas.push(`cancelar:${pedido}:${cliente}`);
      if (pedido !== PEDIDO || cliente !== CLIENTE) return NAO_ACHADO;
      return { outcome: 'cancelado', status: 'cancelado', completedAt: null, cancelledAt: '2026-11-23T12:00:00.000Z' };
    },
    retirarAceite: async (aceite, profissional) => {
      chamadas.push(`retirar:${aceite}:${profissional}`);
      if (aceite !== ACEITE || profissional !== PROFISSIONAL) {
        return { outcome: 'nao_encontrado', acceptanceId: null, requestId: null, withdrawnAt: null };
      }
      return { outcome: 'desistiu', acceptanceId: ACEITE, requestId: PEDIDO, withdrawnAt: '2026-11-23T12:00:00.000Z' };
    },
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleLifecycleRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cookie = { Cookie: '__Host-fp_sess=segredo' };
async function chamar(caminho: string, corpo: unknown = {}, origem: string | null = SITE) {
  const r = await fetch(base + caminho, {
    method: 'POST',
    headers: { ...cookie, ...(origem ? { Origin: origem } : {}), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

describe('roteamento', () => {
  it('reconhece so os quatro caminhos POST do ciclo', () => {
    expect(isLifecycleRoute('POST', `/v1/requests/${PEDIDO}/complete`)).toBe(true);
    expect(isLifecycleRoute('POST', `/v1/requests/${PEDIDO}/uncomplete`)).toBe(true);
    expect(isLifecycleRoute('POST', `/v1/requests/${PEDIDO}/cancel`)).toBe(true);
    expect(isLifecycleRoute('POST', `/v1/acceptances/${ACEITE}/withdraw`)).toBe(true);
    expect(isLifecycleRoute('GET', `/v1/requests/${PEDIDO}/complete`)).toBe(false);
    expect(isLifecycleRoute('POST', `/v1/requests/${PEDIDO}/selection`)).toBe(false);
  });
});

describe('seguranca da entrada', () => {
  it('mutacao sem Origin da propria aplicacao e recusada com 403', async () => {
    const r = await chamar(`/v1/requests/${PEDIDO}/complete`, {}, 'https://outro.example');
    expect(r.status).toBe(403);
  });

  it('id que nao e UUID responde 404 sem tocar no banco', async () => {
    const antes = chamadas.length;
    const r = await chamar('/v1/requests/nao-e-uuid/complete');
    expect(r.status).toBe(404);
    expect(chamadas.length).toBe(antes);
  });

  it('corpo com chave extra e recusado com 400', async () => {
    const r = await chamar(`/v1/acceptances/${ACEITE}/withdraw`, { motivo: 'x' });
    expect(r.status).toBe(400);
  });

  it('sem sessao responde 401', async () => {
    const r = await fetch(`${base}/v1/requests/${PEDIDO}/cancel`, {
      method: 'POST',
      headers: { Origin: SITE, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(401);
  });
});

describe('rotas (sessao do cliente e do profissional)', () => {
  it('concluir devolve 200 com o status e a data', async () => {
    usuarioSessao = CLIENTE;
    const r = await chamar(`/v1/requests/${PEDIDO}/complete`);
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ status: 'concluido', pedidoStatus: 'concluido', completedAt: '2026-11-23T12:00:00.000Z' });
  });

  it('quem nao e dono recebe o mesmo 404 do pedido inexistente', async () => {
    usuarioSessao = PROFISSIONAL;
    const r = await chamar(`/v1/requests/${PEDIDO}/cancel`);
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ code: 'nao_encontrado' });
  });

  it('desfazer dentro do prazo devolve 200; prazo encerrado devolve 409 prazo_encerrado', async () => {
    usuarioSessao = CLIENTE;
    const dentro = await chamar(`/v1/requests/${PEDIDO}/uncomplete`);
    expect(dentro.status).toBe(200);
    expect(dentro.corpo.pedidoStatus).toBe('selecionado');
    prazoEncerrado = true;
    const fora = await chamar(`/v1/requests/${PEDIDO}/uncomplete`);
    prazoEncerrado = false;
    expect(fora.status).toBe(409);
    expect(fora.corpo).toEqual({ code: 'prazo_encerrado' });
  });

  it('cancelar do dono devolve 200 com cancelledAt', async () => {
    usuarioSessao = CLIENTE;
    const r = await chamar(`/v1/requests/${PEDIDO}/cancel`);
    expect(r.status).toBe(200);
    expect(r.corpo.status).toBe('cancelado');
    expect(r.corpo.cancelledAt).toBe('2026-11-23T12:00:00.000Z');
  });

  it('profissional retira o proprio aceite (desistencia) com 200', async () => {
    usuarioSessao = PROFISSIONAL;
    const r = await chamar(`/v1/acceptances/${ACEITE}/withdraw`, {});
    expect(r.status).toBe(200);
    expect(r.corpo.status).toBe('desistiu');
    expect(r.corpo.requestId).toBe(PEDIDO);
  });

  it('aceite de outro profissional responde 404', async () => {
    usuarioSessao = CLIENTE;
    const r = await chamar(`/v1/acceptances/${ACEITE}/withdraw`, {});
    expect(r.status).toBe(404);
  });
});
