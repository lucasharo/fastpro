// Issue 56 (H-043) | Testes da rota publica do perfil (docs/factory/143-DESENHO-H043.md, §5 e §8; T43-01, T43-06, T43-08, T43-16, T43-20).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { LinhaPerfilPublico, PublicProfilePort } from '@fastpro/domain';
import {
  criarLimiteMemoria,
  handlePublicProfileGet,
  PUBLIC_PROFILE_CACHE_200,
  PUBLIC_PROFILE_ROBOTS_DIRECTIVE,
} from './public-profile-route.js';

interface Resposta {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

function fakeRes(): { res: ServerResponse; resposta: Resposta; escritas: number } {
  const resposta: Resposta = { status: 0, headers: {}, corpo: '' };
  const contador = { escritas: 0 };
  const res = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      resposta.status = status;
      resposta.headers = { ...headers };
    },
    end(corpo: string) {
      resposta.corpo = corpo;
      contador.escritas += 1;
    },
  } as unknown as ServerResponse;
  return {
    res,
    resposta,
    get escritas() {
      return contador.escritas;
    },
  };
}

function fakeReq(url: string, ip = '10.0.0.1', cookie?: string): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: cookie === undefined ? {} : { cookie },
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

const linhaValida: LinhaPerfilPublico = {
  publicName: 'Ana Teste',
  slug: 'ana-teste',
  verified: true,
  services: [{ groupName: 'Limpeza', items: [{ name: 'Faxina', modalities: ['online', 'presencial'] }] }],
  rating: { average: null, count: 0 },
  phone: '5511999990000',
  user_id: 'uuid-interno',
};

function portaComMapa(mapa: Record<string, LinhaPerfilPublico>, chamadas = { n: 0 }): PublicProfilePort {
  return {
    async lerPorSlug(slug: string) {
      chamadas.n += 1;
      return mapa[slug] ?? null;
    },
  };
}

const limiteLivre = () => criarLimiteMemoria(1000, 60_000);

async function executar(
  url: string,
  porta: PublicProfilePort,
  opcoes: { ip?: string; cookie?: string; limite?: ReturnType<typeof criarLimiteMemoria>; agoraMs?: number } = {},
): Promise<Resposta> {
  const { res, resposta } = fakeRes();
  await handlePublicProfileGet(fakeReq(url, opcoes.ip, opcoes.cookie), res, {
    port: porta,
    limite: opcoes.limite ?? limiteLivre(),
    agoraMs: () => opcoes.agoraMs ?? 1_000,
  });
  return resposta;
}

describe('T43-01 perfil aprovado sem sessao', () => {
  it('200 com o corpo da lista fechada, cache publico e sem Set-Cookie', async () => {
    const r = await executar('/v1/public/professionals/ana-teste', portaComMapa({ 'ana-teste': linhaValida }));
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe(PUBLIC_PROFILE_CACHE_200);
    expect(PUBLIC_PROFILE_CACHE_200).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    expect(r.headers['Set-Cookie']).toBeUndefined();
    const corpo = JSON.parse(r.corpo) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(
      ['publicName', 'rating', 'recentReviews', 'services', 'slug', 'verificationBadge', 'verified'].sort(),
    );
    expect(r.corpo.includes('5511999990000')).toBe(false);
    expect(r.corpo.includes('uuid-interno')).toBe(false);
  });

  it('aceita o caminho com o prefixo /api (como chega na Vercel e no Next)', async () => {
    const r = await executar('/api/v1/public/professionals/ana-teste', portaComMapa({ 'ana-teste': linhaValida }), { ip: '10.0.0.9' });
    expect(r.status).toBe(200);
  });

  it('a presenca de cookie de sessao nao muda a resposta nem cria Set-Cookie', async () => {
    const porta = portaComMapa({ 'ana-teste': linhaValida });
    const sem = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.0.0.2' });
    const com = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.0.0.3', cookie: 'fp_sessao=abc' });
    expect(com.corpo).toBe(sem.corpo);
    expect(com.status).toBe(sem.status);
    expect(com.headers['Set-Cookie']).toBeUndefined();
  });
});

describe('T43-06, T43-08 404 uniforme byte a byte', () => {
  const porta = portaComMapa({ 'ana-teste': linhaValida });
  const negados = [
    '/v1/public/professionals/inexistente',
    '/v1/public/professionals/Maiuscula',
    '/v1/public/professionals/com%20espaco',
    '/v1/public/professionals/' + 'a'.repeat(101),
    '/v1/public/professionals/-inicio',
    '/v1/public/professionals/%E0%A4%A',
    '/v1/public/professionals/',
  ];

  it('todos os casos negados devolvem o mesmo corpo e os mesmos cabecalhos', async () => {
    const respostas = await Promise.all(negados.map((u) => executar(u, porta, { ip: `10.1.${negados.indexOf(u)}.1` })));
    const base = respostas[0] as Resposta;
    expect(base.status).toBe(404);
    expect(base.corpo).toBe('{"code":"professional_not_found"}');
    for (const r of respostas) {
      expect(r.status).toBe(404);
      expect(r.corpo).toBe(base.corpo);
      expect(r.headers).toEqual(base.headers);
    }
    expect(base.headers['Cache-Control']).toBe('no-store');
    expect(base.headers['X-Robots-Tag']).toBe(PUBLIC_PROFILE_ROBOTS_DIRECTIVE);
    expect(base.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('perfil nao visivel (porta devolve null) tem a mesma resposta do slug inexistente', async () => {
    const naoVisivel = await executar('/v1/public/professionals/retido', portaComMapa({}), { ip: '10.2.0.1' });
    const inexistente = await executar('/v1/public/professionals/nada', portaComMapa({}), { ip: '10.2.0.2' });
    expect(naoVisivel.status).toBe(404);
    expect(naoVisivel.corpo).toBe(inexistente.corpo);
    expect(naoVisivel.headers).toEqual(inexistente.headers);
  });

  it('slug mal formado nao consulta o banco', async () => {
    const chamadas = { n: 0 };
    await executar('/v1/public/professionals/Maiuscula', portaComMapa({}, chamadas), { ip: '10.3.0.1' });
    expect(chamadas.n).toBe(0);
  });
});

describe('T43-16 limite de taxa por IP antes do banco', () => {
  it('a 61a requisicao no minuto devolve 429 com Retry-After e nao consulta o banco', async () => {
    const chamadas = { n: 0 };
    const porta = portaComMapa({ 'ana-teste': linhaValida }, chamadas);
    const limite = criarLimiteMemoria(60, 60_000);
    for (let i = 0; i < 60; i += 1) {
      const r = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.4.0.1', limite, agoraMs: 5_000 });
      expect(r.status).toBe(200);
    }
    const bloqueada = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.4.0.1', limite, agoraMs: 5_000 });
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.corpo).toBe('{"code":"muitas_requisicoes"}');
    expect(Number(bloqueada.headers['Retry-After'])).toBeGreaterThan(0);
    expect(bloqueada.headers['Cache-Control']).toBe('no-store');
    expect(bloqueada.headers['X-Robots-Tag']).toBe(PUBLIC_PROFILE_ROBOTS_DIRECTIVE);
    expect(chamadas.n).toBe(60);
  });
});

describe('T43-20 noindex em todas as respostas do DEV', () => {
  it('X-Robots-Tag presente em 200, 404 e 429', async () => {
    const limite = criarLimiteMemoria(1, 60_000);
    const porta = portaComMapa({ 'ana-teste': linhaValida });
    const ok = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.5.0.1', limite, agoraMs: 1 });
    const nao = await executar('/v1/public/professionals/nada', porta, { ip: '10.5.0.1', limite, agoraMs: 1 });
    const lim = await executar('/v1/public/professionals/nada', porta, { ip: '10.5.0.1', limite, agoraMs: 1 });
    for (const r of [ok, nao, lim]) expect(r.headers['X-Robots-Tag']).toBe('noindex, nofollow');
  });
});

describe('falhas internas viram 500 generico', () => {
  it('erro do banco nao vaza a mensagem', async () => {
    const porta: PublicProfilePort = {
      async lerPorSlug() {
        throw new Error('senha-vazada-no-erro');
      },
    };
    const r = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.6.0.1' });
    expect(r.status).toBe(500);
    expect(r.corpo).toBe('{"code":"erro_interno"}');
    expect(r.corpo.includes('senha')).toBe(false);
  });

  it('forma inesperada do dominio vira 500, nunca dado parcial', async () => {
    const porta = portaComMapa({ 'ana-teste': { publicName: 'A', slug: 'ana-teste', services: 'nao-lista' } });
    const r = await executar('/v1/public/professionals/ana-teste', porta, { ip: '10.7.0.1' });
    expect(r.status).toBe(500);
    expect(r.corpo).toBe('{"code":"erro_interno"}');
  });
});
