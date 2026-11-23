// Ciclo central | Rotas de interessados, selecao, conversas, mensagens e chat do Pacote E (nao lidas, arquivo,
// denuncia, bloqueio) com loja em memoria (sem rede e sem banco).
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
const lidas: string[] = [];
const arquivos: boolean[] = [];
const denuncias: { motivo: string; texto: string | null }[] = [];
let bloqueada = false;

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
        ? { conversationId: CONVERSA, requestId: PEDIDO, serviceName: 'Eletricista', papel: 'cliente', otherName: 'Ana', state: 'ativa', archived: false, blocked: bloqueada, messages: [] }
        : null,
    enviar: async (_c, _u, chave, texto) => {
      if (bloqueada) return { outcome: 'conversa_bloqueada' };
      if (texto.includes('@')) return { outcome: 'conteudo_nao_permitido' };
      if (enviados.some((e) => e.chave === chave)) return { outcome: 'repetida', messageId: 'm1', createdAt: null };
      enviados.push({ texto, chave });
      return texto.trim() === '' ? { outcome: 'texto_invalido' } : { outcome: 'enviada', messageId: 'm1', createdAt: null };
    },
    selecionar: async (_p, _u, aceite) =>
      aceite === ACEITE
        ? { outcome: 'selecionado', selectedAcceptanceId: ACEITE, selectedAt: '2026-11-23T12:00:00.000Z' }
        : { outcome: 'aceite_invalido', selectedAcceptanceId: null, selectedAt: null },
    naoLidas: async (usuario) => (usuario === CLIENTE ? 3 : 0),
    marcarLida: async (conversa) => {
      lidas.push(conversa);
      return true;
    },
    arquivar: async (conversa, _u, arquivar) => {
      if (conversa !== CONVERSA) return 'nao_encontrada';
      arquivos.push(arquivar);
      return arquivar ? 'arquivada' : 'desarquivada';
    },
    denunciar: async (conversa, _u, motivo, texto) => {
      if (conversa !== CONVERSA) return { outcome: 'nao_encontrada' };
      denuncias.push({ motivo, texto });
      return { outcome: 'registrada', reportId: '66666666-6666-4666-8666-666666666666' };
    },
    bloquear: async (conversa) => {
      if (conversa !== CONVERSA) return 'nao_encontrada';
      const jaBloqueada = bloqueada;
      bloqueada = true;
      return jaBloqueada ? 'sem_mudanca' : 'bloqueada';
    },
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
async function chamar(metodo: string, caminho: string, corpo?: unknown, origem: string | null = SITE, comSessao = true) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      ...(comSessao ? cookie : {}),
      ...(origem ? { Origin: origem } : {}),
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
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
    expect(isConversationRoute('GET', '/v1/conversations/unread')).toBe(true);
    expect(isConversationRoute('POST', `/v1/conversations/${CONVERSA}/messages`)).toBe(true);
    expect(isConversationRoute('POST', `/v1/conversations/${CONVERSA}/archive`)).toBe(true);
    expect(isConversationRoute('POST', `/v1/conversations/${CONVERSA}/report`)).toBe(true);
    expect(isConversationRoute('POST', `/v1/conversations/${CONVERSA}/block`)).toBe(true);
    expect(isConversationRoute('GET', `/v1/conversations/${CONVERSA}/archive`)).toBe(false);
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

  it('envio com e-mail ou telefone responde 422 conteudo_nao_permitido', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: '77777777-7777-4777-8777-777777777777', body: 'me chama em ana@exemplo.com' });
    expect(r.status).toBe(422);
    expect(r.corpo.code).toBe('conteudo_nao_permitido');
  });

  it('selecao valida responde 200; aceite de outro pedido responde 409', async () => {
    const ok = await chamar('POST', `/v1/requests/${PEDIDO}/selection`, { acceptance_id: ACEITE });
    expect(ok.status).toBe(200);
    expect(ok.corpo.status).toBe('selecionado');
    const ruim = await chamar('POST', `/v1/requests/${PEDIDO}/selection`, { acceptance_id: CHAVE });
    expect(ruim.status).toBe(409);
  });
});

describe('nao lidas (H-101)', () => {
  it('total sem sessao responde 401', async () => {
    const r = await chamar('GET', '/v1/conversations/unread', undefined, null, false);
    expect(r.status).toBe(401);
  });

  it('total com sessao responde { total }', async () => {
    const r = await chamar('GET', '/v1/conversations/unread', undefined, null);
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ total: 3 });
  });

  it('abrir a conversa marca como lida', async () => {
    const r = await chamar('GET', `/v1/conversations/${CONVERSA}`, undefined, null);
    expect(r.status).toBe(200);
    expect(lidas).toContain(CONVERSA);
  });
});

describe('arquivar (H-069)', () => {
  it('arquiva e desarquiva com {archived: boolean}', async () => {
    const a = await chamar('POST', `/v1/conversations/${CONVERSA}/archive`, { archived: true });
    expect(a.status).toBe(200);
    expect(a.corpo).toEqual({ status: 'arquivada', archived: true });
    const d = await chamar('POST', `/v1/conversations/${CONVERSA}/archive`, { archived: false });
    expect(d.corpo).toEqual({ status: 'desarquivada', archived: false });
    expect(arquivos).toEqual([true, false]);
  });

  it('corpo com tipo errado ou chave extra responde 400', async () => {
    expect((await chamar('POST', `/v1/conversations/${CONVERSA}/archive`, { archived: 'sim' })).status).toBe(400);
    expect((await chamar('POST', `/v1/conversations/${CONVERSA}/archive`, { archived: true, x: 1 })).status).toBe(400);
  });

  it('arquivar sem Origin da propria aplicacao responde 403', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/archive`, { archived: true }, 'https://outro.example');
    expect(r.status).toBe(403);
  });

  it('conversa de quem nao participa responde 404', async () => {
    const r = await chamar('POST', `/v1/conversations/${PEDIDO}/archive`, { archived: true });
    expect(r.status).toBe(404);
  });
});

describe('denunciar (H-071)', () => {
  it('motivo fora da lista fechada responde 400', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/report`, { reason: 'outro_motivo' });
    expect(r.status).toBe(400);
  });

  it('denuncia valida responde 201 e apara o texto vazio para nulo', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/report`, { reason: 'golpe', text: '   ' });
    expect(r.status).toBe(201);
    expect(denuncias.at(-1)).toEqual({ motivo: 'golpe', texto: null });
  });

  it('texto com 500 caracteres passa e com 501 responde 422', async () => {
    const no = await chamar('POST', `/v1/conversations/${CONVERSA}/report`, { reason: 'spam', text: 'a'.repeat(500) });
    expect(no.status).toBe(201);
    const acima = await chamar('POST', `/v1/conversations/${CONVERSA}/report`, { reason: 'spam', text: 'a'.repeat(501) });
    expect(acima.status).toBe(422);
    expect(acima.corpo.code).toBe('texto_invalido');
  });

  it('campo extra no corpo responde 400', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/report`, { reason: 'ofensa', anexo: 'x' });
    expect(r.status).toBe(400);
  });
});

describe('bloquear (H-071)', () => {
  it('bloqueia; depois o envio responde 409 conversa_bloqueada e a conversa segue legivel', async () => {
    const b = await chamar('POST', `/v1/conversations/${CONVERSA}/block`);
    expect(b.status).toBe(200);
    expect(b.corpo.status).toBe('bloqueada');
    const envio = await chamar('POST', `/v1/conversations/${CONVERSA}/messages`, { client_message_id: '88888888-8888-4888-8888-888888888888', body: 'oi' });
    expect(envio.status).toBe(409);
    expect(envio.corpo.code).toBe('conversa_bloqueada');
    const leitura = await chamar('GET', `/v1/conversations/${CONVERSA}`, undefined, null);
    expect(leitura.status).toBe(200);
    expect(leitura.corpo.blocked).toBe(true);
  });

  it('bloquear de novo e idempotente', async () => {
    const r = await chamar('POST', `/v1/conversations/${CONVERSA}/block`);
    expect(r.corpo.status).toBe('sem_mudanca');
  });
});
