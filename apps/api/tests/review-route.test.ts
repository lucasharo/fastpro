// Pacote B | Rotas de avaliacao, resposta e perfil publico de avaliacoes com loja em memoria (sem rede e sem banco).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarLimiteMemoria } from '../src/public-profile-route.js';
import { handleReviewRoute, isReviewRoute, reviewRoute, type ReviewRouteOptions } from '../src/reviews/review-route.js';

const SITE = 'https://fastpro.example';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PROFISSIONAL = '66666666-6666-4666-8666-666666666666';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const AVALIACAO = '77777777-7777-4777-8777-777777777777';
const CHAVE = '55555555-5555-4555-8555-555555555555';
const SLUG = 'ana-eletricista';

type Sessao = { userId: string } | null;
let sessaoAtual: Sessao = { userId: CLIENTE };
let prazoEncerrado = false;

const opts: ReviewRouteOptions = {
  siteUrl: SITE,
  sessions: { authenticate: async () => sessaoAtual },
  clock: { nowMs: () => Date.UTC(2026, 10, 23, 12) },
  limitePublico: criarLimiteMemoria(),
  store: {
    doPedido: async (pedido, usuario) =>
      pedido === PEDIDO && usuario === CLIENTE
        ? { requestStatus: 'concluido', selected: true, review: null }
        : null,
    criar: async (pedido, usuario, nota, comentario) => {
      if (pedido === AVALIACAO) return { outcome: 'pedido_nao_concluido' };
      if (pedido !== PEDIDO || usuario !== CLIENTE) return { outcome: 'nao_encontrado' };
      if (nota < 1 || nota > 5) return { outcome: 'nota_invalida' };
      if (comentario?.includes('@')) return { outcome: 'conteudo_nao_permitido' };
      return { outcome: 'criada', reviewId: AVALIACAO, publishedAt: '2026-11-23T12:00:00.000Z' };
    },
    editar: async () =>
      prazoEncerrado
        ? { outcome: 'prazo_encerrado' }
        : { outcome: 'atualizada', reviewId: AVALIACAO, editedAt: '2026-11-24T12:00:00.000Z' },
    responder: async (avaliacao, profissional, texto) => {
      if (avaliacao !== AVALIACAO || profissional !== PROFISSIONAL) return { outcome: 'nao_encontrada' };
      if (texto.trim() === '') return { outcome: 'texto_invalido' };
      if (texto === 'ja') return { outcome: 'ja_respondida' };
      return { outcome: 'respondida', repliedAt: '2026-11-23T13:00:00.000Z' };
    },
    resumoPorSlug: async (slug) => (slug === SLUG ? { average: 4.3, count: 3 } : null),
    avaliacoesPorSlug: async () => [
      {
        rating: 5,
        comment: 'Pontual e cuidadoso',
        publishedAt: '2026-11-23T12:00:00.000Z',
        replyText: null,
        repliedAt: null,
      },
    ],
    doProfissional: async (profissional) =>
      profissional === PROFISSIONAL
        ? [
            { reviewId: AVALIACAO, rating: 4, comment: null, publishedAt: null, replyText: null, repliedAt: null },
            { reviewId: CHAVE, rating: 5, comment: 'Ótimo', publishedAt: null, replyText: null, repliedAt: null },
          ]
        : [],
  },
};

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    const caminho = new URL(req.url ?? '/', 'http://x').pathname;
    void handleReviewRoute(req, res, caminho, opts);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cookie = { Cookie: '__Host-fp_sess=segredo' };
async function chamar(metodo: string, caminho: string, corpo?: unknown, origem: string | null = SITE, comCookie = true) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      ...(comCookie ? cookie : {}),
      ...(origem ? { Origin: origem } : {}),
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return { status: r.status, cabecalhos: r.headers, corpo: (await r.json()) as Record<string, unknown> };
}

describe('roteamento', () => {
  it('reconhece so os caminhos e metodos das avaliacoes', () => {
    expect(isReviewRoute('GET', `/v1/requests/${PEDIDO}/review`)).toBe(true);
    expect(isReviewRoute('POST', `/v1/requests/${PEDIDO}/review`)).toBe(true);
    expect(isReviewRoute('PATCH', `/v1/requests/${PEDIDO}/review`)).toBe(true);
    expect(isReviewRoute('DELETE', `/v1/requests/${PEDIDO}/review`)).toBe(false);
    expect(isReviewRoute('POST', `/v1/reviews/${AVALIACAO}/reply`)).toBe(true);
    expect(isReviewRoute('GET', '/v1/professional/reviews')).toBe(true);
    expect(isReviewRoute('GET', `/v1/public/professionals/${SLUG}/reviews`)).toBe(true);
    expect(isReviewRoute('POST', `/v1/public/professionals/${SLUG}/reviews`)).toBe(false);
    expect(isReviewRoute('GET', `/v1/public/professionals/${SLUG}`)).toBe(false);
    expect(reviewRoute('GET', `/v1/public/professionals/${SLUG}/reviews`)).toEqual({ tipo: 'publica', slug: SLUG });
  });
});

describe('avaliacao do dono', () => {
  it('sem cookie de sessao responde 401', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/review`, undefined, null, false);
    expect(r.status).toBe(401);
  });

  it('mutacao sem Origin da propria aplicacao responde 403', async () => {
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 5 }, 'https://outro.example');
    expect(r.status).toBe(403);
  });

  it('pedido de quem nao e dono responde 404', async () => {
    sessaoAtual = { userId: PROFISSIONAL };
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/review`);
    sessaoAtual = { userId: CLIENTE };
    expect(r.status).toBe(404);
  });

  it('le o pedido concluido com selecao e sem avaliacao', async () => {
    const r = await chamar('GET', `/v1/requests/${PEDIDO}/review`);
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ requestStatus: 'concluido', selected: true, review: null });
  });

  it('cria a avaliacao (201) e repetir responde 409 com o codigo do banco', async () => {
    const ok = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 5, comment: 'Muito bom' });
    expect(ok.status).toBe(201);
    const pedidoNaoConcluido = await chamar('POST', `/v1/requests/${AVALIACAO}/review`, { rating: 4 });
    expect(pedidoNaoConcluido.status).toBe(409);
    expect(pedidoNaoConcluido.corpo.code).toBe('pedido_nao_concluido');
  });

  it('nota fora de 1 a 5 responde 422 e corpo com chave extra responde 400', async () => {
    const nota = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 7 });
    expect(nota.status).toBe(422);
    expect(nota.corpo.code).toBe('nota_invalida');
    const extra = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 5, anexo: 'x' });
    expect(extra.status).toBe(400);
  });

  it('comentario acima de 1000 caracteres responde 422 antes do banco', async () => {
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 4, comment: 'a'.repeat(1001) });
    expect(r.status).toBe(422);
    expect(r.corpo.code).toBe('comentario_invalido');
  });

  it('comentario com e-mail (conteudo_nao_permitido) responde 422', async () => {
    const r = await chamar('POST', `/v1/requests/${PEDIDO}/review`, { rating: 3, comment: 'fale: ana@exemplo.com' });
    expect(r.status).toBe(422);
    expect(r.corpo.code).toBe('conteudo_nao_permitido');
  });

  it('edicao dentro do prazo responde 200 e apos 7 dias responde 409 prazo_encerrado', async () => {
    prazoEncerrado = false;
    const ok = await chamar('PATCH', `/v1/requests/${PEDIDO}/review`, { rating: 4 });
    expect(ok.status).toBe(200);
    prazoEncerrado = true;
    const tarde = await chamar('PATCH', `/v1/requests/${PEDIDO}/review`, { rating: 4 });
    prazoEncerrado = false;
    expect(tarde.status).toBe(409);
    expect(tarde.corpo.code).toBe('prazo_encerrado');
  });
});

describe('resposta do profissional', () => {
  it('responde uma vez (201); segunda resposta responde 409', async () => {
    sessaoAtual = { userId: PROFISSIONAL };
    const ok = await chamar('POST', `/v1/reviews/${AVALIACAO}/reply`, { body: 'Obrigado!' });
    const repetida = await chamar('POST', `/v1/reviews/${AVALIACAO}/reply`, { body: 'ja' });
    sessaoAtual = { userId: CLIENTE };
    expect(ok.status).toBe(201);
    expect(repetida.status).toBe(409);
  });

  it('avaliacao de outro profissional responde 404 e texto vazio responde 422', async () => {
    sessaoAtual = { userId: CLIENTE };
    const outro = await chamar('POST', `/v1/reviews/${AVALIACAO}/reply`, { body: 'oi' });
    expect(outro.status).toBe(404);
    sessaoAtual = { userId: PROFISSIONAL };
    const vazio = await chamar('POST', `/v1/reviews/${AVALIACAO}/reply`, { body: '   ' });
    sessaoAtual = { userId: CLIENTE };
    expect(vazio.status).toBe(422);
  });

  it('lista as avaliacoes recebidas com a media do profissional', async () => {
    sessaoAtual = { userId: PROFISSIONAL };
    const r = await chamar('GET', '/v1/professional/reviews', undefined, null);
    sessaoAtual = { userId: CLIENTE };
    expect(r.status).toBe(200);
    expect(r.corpo.summary).toEqual({ average: 4.5, count: 2 });
    expect((r.corpo.items as unknown[]).length).toBe(2);
  });
});

describe('perfil publico de avaliacoes', () => {
  it('sem sessao, devolve media com 1 casa, itens com autor fixo e sem Set-Cookie', async () => {
    sessaoAtual = null;
    const r = await chamar('GET', `/v1/public/professionals/${SLUG}/reviews`, undefined, null, false);
    sessaoAtual = { userId: CLIENTE };
    expect(r.status).toBe(200);
    expect(r.corpo.summary).toEqual({ average: 4.3, count: 3 });
    const itens = r.corpo.items as Record<string, unknown>[];
    expect(itens[0]?.author).toBe('Cliente do FastPro');
    expect(itens[0]).not.toHaveProperty('customerUserId');
    expect(itens[0]).not.toHaveProperty('email');
    expect(r.cabecalhos.get('set-cookie')).toBeNull();
    expect(r.cabecalhos.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('perfil nao visivel e slug mal formado respondem 404 uniforme', async () => {
    const inexistente = await chamar('GET', '/v1/public/professionals/nao-existe/reviews', undefined, null, false);
    const mal = await chamar('GET', '/v1/public/professionals/Slug_Ruim/reviews', undefined, null, false);
    expect(inexistente.status).toBe(404);
    expect(inexistente.corpo).toEqual({ code: 'professional_not_found' });
    expect(mal.status).toBe(404);
  });

  it('passa do limite por IP responde 429 com Retry-After', async () => {
    const apertado: ReviewRouteOptions = { ...opts, limitePublico: criarLimiteMemoria(1, 60_000) };
    const s = createServer((req, res) => void handleReviewRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, apertado));
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/v1/public/professionals/${SLUG}/reviews`;
    try {
      const primeira = await fetch(url);
      const segunda = await fetch(url);
      expect(primeira.status).toBe(200);
      expect(segunda.status).toBe(429);
      expect(segunda.headers.get('retry-after')).not.toBeNull();
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});
