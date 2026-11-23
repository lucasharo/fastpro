// Ciclo central | Rotas de interessados, selecao, conversas e mensagens com loja em memoria (sem rede e sem banco).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleConversationRoute, isConversationRoute, type ConversationRouteOptions } from '../src/conversations/conversation-route.js';

const SITE = 'https://fastpro.example';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ACEITE = '33333333-3333-4333-8333-333333333333';
const CONVERSA = '44444444-4444-4444-8444-444444444444';
const CHAVE = '55555555-5555-4555-8555-555555555555';

const enviados: { texto: string; chave: string }[] = [];
const opts: ConversationRouteOptions = {
  siteUrl: SITE,
  sessions: { authenticate: async () => ({ userId: CLIENTE }) },
  clock: { nowMs: () => Date.UTC(2026, 10, 23, 12) },
  store: {
    interessados: async (pedido, usuario) =>
      pedido === PEDIDO && usuario === CLIENTE
        ? [{ acceptanceId: ACEITE, professionalName: 'Ana', professionalSlug: 'ana', slotNo: 1, status: 'ativo', acceptedAt: null, conversationId: CONVERSA, conversationState: 'ativa', selected: false }]
        : [],
    conversas: async () => [],
    conversa: async (id) =>
      id === CONVERSA
        ? { conversationId: CONVERSA, requestId: PEDIDO, serviceName: 'Eletricista', papel: 'cliente', otherName: 'Ana', state: 'ativa', messages: [] }
        : null,
    enviar: async (_c, _u, chave, texto) => {
      if (enviados.some((e) => e.chave === chave)) return { outcome: 'repetida', messageId: 'm1', createdAt: null };
      enviados.push({ texto, chave });
      return texto.trim() === '' ? { outcome: 'texto_invalido' } : { outcome: 'enviada', messageId: 'm1', createdAt: null };
    },
    selecionar: async (_p, _u, aceite) =>
      aceite === ACEITE
        ? { outcome: 'selecionado', selectedAcceptanceId: ACEITE, selectedAt: '2026-11-23T12:00:00.000Z' }
        : { outcome: 'aceite_invalido', selectedAcceptanceId: null, selectedAt: null },
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => void handleConversationRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, opts));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cookie = { Cookie: '__Host-fp_sess=segredo' };
async function chamar(metodo: string, caminho: string, corpo?: unknown, origem: string | null = SITE) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { ...cookie, ...(origem ? { Origin: origem } : {}), ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

describe('roteamento', () => {
  it('reconhece so os caminhos e metodos do ciclo central', () => {
    expect(isConversationRoute('GET', `/v1/requests/${PEDIDO}/acceptances`)).toBe(true);
    expect(isConversationRoute('POST', `/v1/requests/${PEDIDO}/acceptances`)).toBe(false);
    expect(isConversationRoute('POST', `/v1/requests/${PEDIDO}/selection`)).toBe(true);
    expect(isConversationRoute('GET', '/v1/conversations')).toBe(true);
    expect(isConversationRoute('POST', `/v1/conversations/${CONVERSA}/messages`)).toBe(true);
    expect(isConversationRoute('DELETE', `/v1/conversations/${CONVERSA}`)).toBe(false);
  });
});

describe('rotas (sessao do cliente)', () => {
  it('lista os interessados do pedido', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/acceptances`);
    expect(r.status).toBe(200);
    expect((r.corpo.items as unknown[]).length).toBe(1);
  });

  it('conversa de quem nao participa responde 404', async () => {
    const r = await chamar('GET', `/v1/conversations/${PEDIDO}`);
    expect(r.status).toBe(404);
  });

  it('envio sem Origin da propria aplicacao e recusado com 403', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: CHAVE, body: 'oi' }, 'https://outro.example');
    expect(r.status).toBe(403);
  });

  it('envio com chave extra (ex.: anexo) e recusado com 400', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: CHAVE, body: 'oi', anexo: 'x' });
    expect(r.status).toBe(400);
  });

  it('envio e idempotente pela client_message_id', async () => {
    const a = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: CHAVE, body: 'Olá' });
    const b = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: CHAVE, body: 'Olá' });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(enviados).toHaveLength(1);
  });

  it('selecao valida responde 200; aceite de outro pedido responde 409', async () => {
    const ok = await chamar('POST', `/v1/requests/${PEDIDO}/selection`, { acceptance_id: ACEITE });
    expect(ok.status).toBe(200);
    expect(ok.corpo.status).toBe('selecionado');
    const ruim = await chamar('POST', `/v1/requests/${PEDIDO}/selection`, { acceptance_id: CHAVE });
    expect(ruim.status).toBe(409);
  });
});
