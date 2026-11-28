// Issue 68 (H-055) | Rota da descoberta em HTTP (docs/factory/153-DESENHO-H055.md, §7: T-01 a T-11, T-28 a T-30).
// Servidor HTTP real com a rota isolada; portas em memoria que seguem o contrato. Sem banco, sem rede externa.
// Segredos de teste montados por concatenacao (check:secrets). Relogio injetado; nenhum log e capturado no codigo da rota.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_CURSOR_TTL_MS,
  SESSION_COOKIE_NAME,
  createDiscoveryCursorCodec,
  type DiscoveryCursor,
  type RateWindowDecision,
} from '@fastpro/domain';
import { hashSessionSecret, type ProfessionalRequestRow } from '@fastpro/db';
import { handleDiscoveryRoute, isDiscoveryRoute, type DiscoveryRouteOptions } from '../src/requests/discovery-route.js';
import type { DiscoveryServiceDeps } from '../src/requests/discovery-service.js';

const PRO = '44444444-4444-4444-8444-444444444444';
const OUTRO_PRO = '55555555-5555-4555-8555-555555555555';
const SEM_PERFIL = '66666666-6666-4666-8666-666666666666';
const AGORA = Date.UTC(2026, 10, 19, 12, 0, 0);
const CHAVE = ['chave', 'descoberta', 'rota', 'h055'].join('-') + '-0123456789abcdef0123';
const SEG_PRO = ['sessao', 'pro', 'h055', '0000000000000000000000000000'].join('-');
const SEG_SEM = ['sessao', 'sem', 'h055', '0000000000000000000000000000'].join('-');
const SEG_OUTRO = ['sessao', 'outro', 'h055', '0000000000000000000000000000'].join('-');
const SEG_INVALIDO = ['sessao', 'inexistente', 'h055', '0000000000000000000000000000'].join('-');
const CABECALHOS_ESPERADOS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'content-type': 'application/json; charset=utf-8',
};

const id = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cursorCodec = createDiscoveryCursorCodec(CHAVE);

function linha(n: number): ProfessionalRequestRow {
  return {
    id: id(n),
    serviceId: '88888888-8888-4888-8888-888888888888',
    serviceName: 'Eletricista',
    urgency: 'imediato',
    description: `Pedido ${n}`,
    publicLabel: 'Campinas - SP',
    distanceKm: 0.5,
    modality: 'presencial',
    publishedAt: '2026-11-19T11:00:00.000Z',
    acceptanceDeadlineAt: '2026-11-26T11:00:00.000Z',
  };
}

interface Mundo {
  agora: number;
  descobertos: DiscoveryCursor[];
  projetadas: ProfessionalRequestRow[];
  falhaBanco: boolean;
  chamadasStore: number;
  cotaUsada: number;
  cotaLimite: number;
  cotaRetry: number;
}

function montar(mundo: Mundo): DiscoveryRouteOptions {
  const service: DiscoveryServiceDeps = {
    cursor: cursorCodec,
    clock: { nowMs: () => mundo.agora },
    store: {
      discover: async (entrada) => {
        mundo.chamadasStore += 1;
        if (mundo.falhaBanco) throw new Error('detalhe do driver que nao pode sair');
        return mundo.descobertos.slice(0, entrada.limit);
      },
    },
    projection: {
      project: async (_prof, ids) => {
        const porId = new Map(mundo.projetadas.map((l) => [l.id, l]));
        return ids.map((i) => porId.get(i)).filter((l): l is ProfessionalRequestRow => l !== undefined);
      },
    },
    photos: { withPhotos: async () => new Set<string>() },
  };
  return {
    sessions: {
      authenticate: async (hash) => {
        if (hash === hashSessionSecret(SEG_PRO)) return { userId: PRO };
        if (hash === hashSessionSecret(SEG_SEM)) return { userId: SEM_PERFIL };
        if (hash === hashSessionSecret(SEG_OUTRO)) return { userId: OUTRO_PRO };
        return null;
      },
    },
    profissional: { existe: async (userId) => userId !== SEM_PERFIL },
    limite: {
      check: async (): Promise<RateWindowDecision> => {
        if (mundo.cotaUsada >= mundo.cotaLimite) return { decision: 'barrado', retryAfterSeconds: mundo.cotaRetry };
        return { decision: 'permitido' };
      },
      record: async () => {
        mundo.cotaUsada += 1;
      },
    },
    service,
  };
}

let servidor: Server;
let base: string;
const mundo: Mundo = {
  agora: AGORA,
  descobertos: [],
  projetadas: [],
  falhaBanco: false,
  chamadasStore: 0,
  cotaUsada: 0,
  cotaLimite: 60,
  cotaRetry: 7,
};
const opts = montar(mundo);

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleDiscoveryRoute(req, res, opts);
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

interface Resposta {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  json: unknown;
}

function chamar(caminho: string, opcoesReq: { cookie?: string | null; metodo?: string } = {}): Promise<Resposta> {
  const url = new URL(caminho, base);
  const headers: Record<string, string> = {};
  if (opcoesReq.cookie) headers.cookie = opcoesReq.cookie;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: opcoesReq.metodo ?? 'GET', headers }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (raw += c));
      res.on('end', () => {
        let json: unknown;
        try {
          json = raw === '' ? null : JSON.parse(raw);
        } catch {
          json = raw;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const cookie = (segredo: string): string => `${SESSION_COOKIE_NAME}=${segredo}`;
const CAMINHO = '/v1/professional/discovery/requests';

function reiniciar(): void {
  mundo.agora = AGORA;
  mundo.descobertos = [];
  mundo.projetadas = [];
  mundo.falhaBanco = false;
  mundo.chamadasStore = 0;
  mundo.cotaUsada = 0;
  mundo.cotaLimite = 60;
  mundo.cotaRetry = 7;
}

function cabecalhosDe(r: Resposta): Record<string, unknown> {
  return {
    'cache-control': r.headers['cache-control'],
    'referrer-policy': r.headers['referrer-policy'],
    'content-type': r.headers['content-type'],
  };
}

describe('acesso: sessao, perfil e metodo (T-01, T-02, T-03)', () => {
  it('T-01: sem cookie, ou com sessao inexistente, responde 401 sessao_necessaria com cabecalhos de seguranca', async () => {
    reiniciar();
    const semCookie = await chamar(CAMINHO);
    expect(semCookie.status).toBe(401);
    expect(semCookie.json).toEqual({ code: 'sessao_necessaria' });
    const invalida = await chamar(CAMINHO, { cookie: cookie(SEG_INVALIDO) });
    expect(invalida).toMatchObject({ status: 401, json: { code: 'sessao_necessaria' } });
    expect(cabecalhosDe(invalida)).toEqual(CABECALHOS_ESPERADOS);
  });

  it('T-02: conta sem perfil profissional responde 403 perfil_profissional_obrigatorio', async () => {
    reiniciar();
    const r = await chamar(CAMINHO, { cookie: cookie(SEG_SEM) });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'perfil_profissional_obrigatorio' });
    expect(mundo.chamadasStore).toBe(0);
  });

  it('T-03: metodo diferente de GET responde 404 uniforme; caminho com sufixo nao casa a rota', async () => {
    reiniciar();
    for (const metodo of ['POST', 'HEAD', 'PUT']) {
      const r = await chamar(CAMINHO, { cookie: cookie(SEG_PRO), metodo });
      expect(r.status).toBe(404);
    }
    expect(isDiscoveryRoute(`${CAMINHO}/extra`)).toBe(false);
    expect(isDiscoveryRoute(`${CAMINHO}/`)).toBe(false);
    expect(isDiscoveryRoute(CAMINHO)).toBe(true);
  });
});

describe('query estrita e limite de taxa (T-04, T-05, T-10)', () => {
  it.each([
    ['limit=0'],
    ['limit=201'],
    ['limit=abc'],
    ['limit=1.5'],
    ['limit='],
    ['limit=5&limit=6'],
    ['sort=asc'],
    ['limit=5&filter=x'],
  ])('T-04/T-05: %s responde 400 parametro_invalido sem consultar o banco', async (query) => {
    reiniciar();
    const r = await chamar(`${CAMINHO}?${query}`, { cookie: cookie(SEG_PRO) });
    expect(r).toMatchObject({ status: 400, json: { code: 'parametro_invalido' } });
    expect(mundo.chamadasStore).toBe(0);
  });

  it('T-10: a 61.a requisicao no minuto responde 429 com Retry-After inteiro; a janela seguinte volta a 200', async () => {
    reiniciar();
    for (let i = 0; i < 60; i += 1) {
      const ok = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
      expect(ok.status).toBe(200);
    }
    const barrada = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
    expect(barrada.status).toBe(429);
    expect(barrada.json).toEqual({ code: 'muitas_requisicoes' });
    expect(barrada.headers['retry-after']).toBe('7');
    expect(cabecalhosDe(barrada)).toEqual(CABECALHOS_ESPERADOS);
    mundo.cotaUsada = 0; // a janela de 60 s virou
    const depois = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
    expect(depois.status).toBe(200);
  });
});

describe('pagina, cursor e instante (T-06, T-07, T-08, T-09)', () => {
  it('T-06: limit 1, padrao e 200 chegam ao banco; a pagina respeita o limite pedido', async () => {
    reiniciar();
    mundo.descobertos = Array.from({ length: 250 }, (_v, i) => ({ group: 0 as const, key: i, requestId: id(i + 1) }));
    mundo.projetadas = mundo.descobertos.map((d) => linha(Number(d.requestId.slice(-12))));
    const um = await chamar(`${CAMINHO}?limit=1`, { cookie: cookie(SEG_PRO) });
    expect(um.status).toBe(200);
    expect((um.json as { items: unknown[] }).items).toHaveLength(1);
    expect((um.json as { has_more: boolean }).has_more).toBe(true);
    const padrao = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
    expect((padrao.json as { items: unknown[] }).items).toHaveLength(50);
    const maximo = await chamar(`${CAMINHO}?limit=200`, { cookie: cookie(SEG_PRO) });
    expect((maximo.json as { items: unknown[] }).items).toHaveLength(200);
  });

  it.each([
    ['trocado', 'AAAA'],
    ['vazio', ''],
    ['lixo', 'lixo!'],
    ['maior que 512', 'A'.repeat(513)],
  ])('T-07: cursor %s responde 400 cursor_invalido sem consultar o banco', async (_nome, valor) => {
    reiniciar();
    mundo.descobertos = [{ group: 0, key: 1, requestId: id(1) }];
    const r = await chamar(`${CAMINHO}?cursor=${encodeURIComponent(valor)}`, { cookie: cookie(SEG_PRO) });
    expect(r).toMatchObject({ status: 400, json: { code: 'cursor_invalido' } });
    expect(mundo.chamadasStore).toBe(0);
  });

  it('T-08: cursor emitido ao profissional A usado pelo B responde 400 cursor_invalido', async () => {
    reiniciar();
    mundo.descobertos = [descobertoN(1), descobertoN(2)];
    mundo.projetadas = [linha(1), linha(2)];
    const primeira = await chamar(`${CAMINHO}?limit=2`, { cookie: cookie(SEG_PRO) });
    const token = (primeira.json as { next_cursor: string }).next_cursor;
    expect(typeof token).toBe('string');
    const deOutro = await chamar(`${CAMINHO}?limit=2&cursor=${token}`, { cookie: cookie(SEG_OUTRO) });
    expect(deOutro).toMatchObject({ status: 400, json: { code: 'cursor_invalido' } });
  });

  it('T-09: cursor com 24 h exatas e aceito; com 24 h mais 1 s e recusado', async () => {
    reiniciar();
    mundo.descobertos = [descobertoN(1), descobertoN(2)];
    mundo.projetadas = [linha(1), linha(2)];
    const primeira = await chamar(`${CAMINHO}?limit=2`, { cookie: cookie(SEG_PRO) });
    const token = (primeira.json as { next_cursor: string }).next_cursor;
    mundo.agora = AGORA + DISCOVERY_CURSOR_TTL_MS;
    const exato = await chamar(`${CAMINHO}?limit=2&cursor=${token}`, { cookie: cookie(SEG_PRO) });
    expect(exato.status).toBe(200);
    mundo.agora = AGORA + DISCOVERY_CURSOR_TTL_MS + 1000;
    const vencido = await chamar(`${CAMINHO}?limit=2&cursor=${token}`, { cookie: cookie(SEG_PRO) });
    expect(vencido).toMatchObject({ status: 400, json: { code: 'cursor_invalido' } });
  });
});

function descobertoN(n: number): DiscoveryCursor {
  return { group: 0, key: n * 100, requestId: id(n) };
}

describe('inelegivel e falha (T-11, T-28)', () => {
  it('T-11: inelegivel e elegivel sem pedidos devolvem o mesmo corpo, byte a byte, com os mesmos cabecalhos', async () => {
    reiniciar();
    mundo.descobertos = [];
    const elegivelSemPedidos = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
    const inelegivelSimulado = await chamar(CAMINHO, { cookie: cookie(SEG_OUTRO) });
    expect(elegivelSemPedidos.status).toBe(200);
    expect(inelegivelSimulado.status).toBe(200);
    expect(inelegivelSimulado.raw).toBe(elegivelSemPedidos.raw);
    expect(cabecalhosDe(inelegivelSimulado)).toEqual(cabecalhosDe(elegivelSemPedidos));
    expect(elegivelSemPedidos.json).toEqual({ items: [], next_cursor: null, has_more: false });
  });

  it('T-28: falha do banco responde 503 descoberta_indisponivel com corpo constante, sem texto do driver', async () => {
    reiniciar();
    mundo.descobertos = [descobertoN(1)];
    mundo.falhaBanco = true;
    const r = await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
    expect(r.status).toBe(503);
    expect(r.raw).toBe(JSON.stringify({ code: 'descoberta_indisponivel' }));
    expect(r.raw).not.toContain('driver');
    expect(cabecalhosDe(r)).toEqual(CABECALHOS_ESPERADOS);
  });
});

describe('cabecalhos e registro (T-29, T-30)', () => {
  it('T-29: 200, 400, 401, 403, 429 e 503 saem com no-store, no-referrer e JSON UTF-8', async () => {
    reiniciar();
    mundo.descobertos = [descobertoN(1)];
    mundo.projetadas = [linha(1)];
    const respostas = [
      await chamar(CAMINHO, { cookie: cookie(SEG_PRO) }),
      await chamar(`${CAMINHO}?limit=0`, { cookie: cookie(SEG_PRO) }),
      await chamar(CAMINHO),
      await chamar(CAMINHO, { cookie: cookie(SEG_SEM) }),
    ];
    mundo.cotaUsada = 60;
    respostas.push(await chamar(CAMINHO, { cookie: cookie(SEG_PRO) }));
    mundo.cotaUsada = 0;
    mundo.falhaBanco = true;
    respostas.push(await chamar(CAMINHO, { cookie: cookie(SEG_PRO) }));
    expect(respostas.map((r) => r.status)).toEqual([200, 400, 401, 403, 429, 503]);
    for (const r of respostas) expect(cabecalhosDe(r)).toEqual(CABECALHOS_ESPERADOS);
  });

  it('T-30: durante as requisicoes nada e escrito no console (sem cookie, cursor ou id)', async () => {
    reiniciar();
    mundo.descobertos = [descobertoN(1), descobertoN(2)];
    mundo.projetadas = [linha(1), linha(2)];
    const espiaLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const espiaErro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const espiaAviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const primeira = await chamar(`${CAMINHO}?limit=2`, { cookie: cookie(SEG_PRO) });
      const token = (primeira.json as { next_cursor: string }).next_cursor;
      await chamar(`${CAMINHO}?limit=2&cursor=${token}`, { cookie: cookie(SEG_PRO) });
      await chamar(`${CAMINHO}?cursor=lixo`, { cookie: cookie(SEG_PRO) });
      mundo.falhaBanco = true;
      await chamar(CAMINHO, { cookie: cookie(SEG_PRO) });
      expect(espiaLog).not.toHaveBeenCalled();
      expect(espiaErro).not.toHaveBeenCalled();
      expect(espiaAviso).not.toHaveBeenCalled();
    } finally {
      espiaLog.mockRestore();
      espiaErro.mockRestore();
      espiaAviso.mockRestore();
    }
  });
});
