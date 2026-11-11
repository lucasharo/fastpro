// H-019 | Rota POST /v1/catalog/service-search com portas simuladas (docs/factory/64-DESENHO-H019.md,
// §3.1, §3.2, §5.1 T-H019-03, T-H019-04). Servidor de loopback e cliente node:http; fetch global bloqueado.
// Dados sinteticos (@example.test). Canario: o termo digitado nao pode aparecer em nenhuma resposta.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-019');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CATALOG_SEARCH_PATH } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import type { CatalogRouteOptions } from '../src/catalog/catalog-route.js';
import {
  unwiredCatalogRate,
  unwiredCatalogSearch,
  type CatalogRateCheck,
  type CatalogRateLimitPort,
  type CatalogSearchPort,
  type CatalogSearchPortResult,
} from '../src/catalog/ports.js';

const SITE = 'https://fastpro.example.test';
const CANARIO = 'empreiteiro-canario-h019';
const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 2,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Construcao sintetica',
  modality: 'presencial',
  regulated: false,
  term: CANARIO,
};

class SearchFake implements CatalogSearchPort {
  calls: string[] = [];
  constructor(private readonly result: CatalogSearchPortResult | 'lanca') {}
  async search(q: string): Promise<CatalogSearchPortResult> {
    this.calls.push(q);
    if (this.result === 'lanca') throw new Error(`falha interna com ${CANARIO}`);
    return this.result;
  }
}

class RateFake implements CatalogRateLimitPort {
  hits = 0;
  constructor(private readonly verdict: CatalogRateCheck) {}
  async check(): Promise<CatalogRateCheck> {
    return this.verdict;
  }
  async hit(): Promise<void> {
    this.hits += 1;
  }
}

const OK_RATE: CatalogRateCheck = { ok: true };

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

async function subir(catalog: CatalogRouteOptions | undefined): Promise<number> {
  const server = createServer((req, res) =>
    handleRequest(req, res, { tickSecret: undefined, catalog }).catch(() => {
      res.statusCode = 500;
      res.end();
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
}

function enviar(
  porta: number,
  corpo: string,
  cabecalhos: Record<string, string> = {},
  metodo = 'POST',
  caminho = CATALOG_SEARCH_PATH,
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        path: caminho,
        method: metodo,
        headers: {
          Origin: SITE,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
          ...cabecalhos,
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(partes).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

const buscar = (porta: number, q: string) => enviar(porta, JSON.stringify({ q }));

function montar(search: CatalogSearchPort, rate: CatalogRateLimitPort): CatalogRouteOptions {
  return { search, rate, siteUrl: SITE };
}

describe('rota POST /v1/catalog/service-search (desenho §3.1)', () => {
  it('sem a opcao catalog a rota nao existe (404)', async () => {
    const porta = await subir(undefined);
    const r = await buscar(porta, 'pedr');
    expect(r.status).toBe(404);
  });

  it('so POST: GET no caminho responde 404 e nao chama a busca', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const porta = await subir(montar(search, new RateFake(OK_RATE)));
    const r = await enviar(porta, '', {}, 'GET');
    expect(r.status).toBe(404);
    expect(search.calls).toEqual([]);
  });

  it('ok: 200 com itens de 7 campos, sem termo e com no-store', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const rate = new RateFake(OK_RATE);
    const porta = await subir(montar(search, rate));
    const r = await buscar(porta, 'empreit');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.text)).toEqual({
      status: 'ok',
      items: [
        {
          group_id: LINHA.group_id,
          group_name: LINHA.group_name,
          group_position: LINHA.group_position,
          service_id: LINHA.service_id,
          service_name: LINHA.service_name,
          modality: LINHA.modality,
          regulated: LINHA.regulated,
        },
      ],
    });
    expect(r.text).not.toContain(CANARIO);
    expect(search.calls).toEqual(['empreit']);
    expect(rate.hits).toBe(1);
  });

  it('vazio: 200 com sem_resultado (CA-06)', async () => {
    const porta = await subir(montar(new SearchFake({ ok: true, rows: [] }), new RateFake(OK_RATE)));
    const r = await buscar(porta, 'xyzw');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ status: 'vazio', code: 'sem_resultado', items: [] });
  });

  it('entrada invalida: 400 antes da busca, sem eco do termo', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const porta = await subir(montar(search, new RateFake(OK_RATE)));
    const casos = [
      JSON.stringify({ q: '' }),
      JSON.stringify({ q: 'a' }),
      JSON.stringify({ q: '  a  ' }),
      JSON.stringify({ q: '%%' }),
      JSON.stringify({ q: 'a'.repeat(81) }),
      JSON.stringify({ q: 'pedr', extra: 1 }),
      JSON.stringify({ q: 12 }),
      '{"q":',
      JSON.stringify({ q: `${CANARIO}${'x'.repeat(1100)}` }),
    ];
    for (const corpo of casos) {
      const r = await enviar(porta, corpo);
      expect(r.status).toBe(400);
      expect(JSON.parse(r.text)).toEqual({ status: 'erro', code: 'entrada_invalida' });
      expect(r.text).not.toContain(CANARIO);
    }
    expect(search.calls).toEqual([]);
  });

  it('Origin errada: 403 sem consulta; Content-Type errado: 415 sem consulta', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const porta = await subir(montar(search, new RateFake(OK_RATE)));
    const corpo = JSON.stringify({ q: 'pedr' });
    const origem = await enviar(porta, corpo, { Origin: 'https://evil.example.test' });
    expect(origem.status).toBe(403);
    const tipo = await enviar(porta, corpo, { 'Content-Type': 'text/plain' });
    expect(tipo.status).toBe(415);
    expect(search.calls).toEqual([]);
  });

  it('limite: 429 com Retry-After, sem chamar a busca nem contar (T-H019-03)', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const rate = new RateFake({ ok: false, retryAfterS: 60 });
    const porta = await subir(montar(search, rate));
    const r = await buscar(porta, 'pedr');
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('60');
    expect(JSON.parse(r.text)).toEqual({ status: 'erro', code: 'limite' });
    expect(search.calls).toEqual([]);
    expect(rate.hits).toBe(0);
  });

  it('falha da porta ou excecao: 503 falha fixo, sem mensagem e sem "nenhum resultado"', async () => {
    const porta1 = await subir(montar(new SearchFake({ ok: false, code: 'db_error' }), new RateFake(OK_RATE)));
    const a = await buscar(porta1, 'pedr');
    expect(a.status).toBe(503);
    expect(JSON.parse(a.text)).toEqual({ status: 'erro', code: 'falha' });

    const porta2 = await subir(montar(new SearchFake('lanca'), new RateFake(OK_RATE)));
    const b = await buscar(porta2, 'pedr');
    expect(b.status).toBe(503);
    expect(JSON.parse(b.text)).toEqual({ status: 'erro', code: 'falha' });
    expect(b.text).not.toContain(CANARIO);
  });

  it('porta nao ligada: 503 falha (desenho §3.3)', async () => {
    const porta = await subir(montar(unwiredCatalogSearch, unwiredCatalogRate));
    const r = await buscar(porta, 'pedr');
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text)).toEqual({ status: 'erro', code: 'falha' });
  });

  it('canario fora das respostas nos fluxos de sucesso, vazio, erro e limite (T-H019-04)', async () => {
    const fluxos: CatalogRouteOptions[] = [
      montar(new SearchFake({ ok: true, rows: [LINHA] }), new RateFake(OK_RATE)),
      montar(new SearchFake({ ok: true, rows: [] }), new RateFake(OK_RATE)),
      montar(new SearchFake({ ok: false, code: 'db_timeout' }), new RateFake(OK_RATE)),
      montar(new SearchFake({ ok: true, rows: [] }), new RateFake({ ok: false, retryAfterS: 60 })),
    ];
    for (const opts of fluxos) {
      const porta = await subir(opts);
      const r = await buscar(porta, CANARIO);
      expect(r.text).not.toContain(CANARIO);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});
