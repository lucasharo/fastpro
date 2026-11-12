// H-019 | Montagem da busca de servico na composicao, em memoria (docs/factory/64-DESENHO-H019.md, §3.1).
// Sem banco, sem rede, sem variavel real: os valores abaixo sao sinteticos. Cobre a montagem sem
// variavel (404) e com variaveis presentes usando uma fabrica falsa.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-019');
};

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CATALOG_SEARCH_PATH } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import {
  CATALOG_DATABASE_URL_ENV,
  CATALOG_RATE_KEY_ENV,
  montarCatalogo,
  type CatalogEnv,
  type CatalogPortsFactory,
} from '../src/catalog/compose.js';
import type { CatalogRouteOptions } from '../src/catalog/catalog-route.js';
import type { CatalogRateLimitPort, CatalogSearchPort } from '../src/catalog/ports.js';

const SITE = 'https://fastpro.example.test';
const URL_SINTETICA = 'postgres://app_api_sintetico@db.example.test:5432/fastpro_sintetico';
const CHAVE = 'c'.repeat(40);
const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 1,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Servico sintetico',
  modality: 'presencial',
  regulated: false,
};

const COMPLETO: CatalogEnv = {
  [CATALOG_DATABASE_URL_ENV]: URL_SINTETICA,
  [CATALOG_RATE_KEY_ENV]: CHAVE,
  SITE_URL: SITE,
};

function fabricaFalsa() {
  const search: CatalogSearchPort = {
    search: vi.fn(async () => ({ ok: true as const, rows: [LINHA] })),
  };
  const rate: CatalogRateLimitPort = {
    check: vi.fn(async () => ({ ok: true as const })),
    hit: vi.fn(async () => undefined),
  };
  const criar = vi.fn(() => ({ search, rate }));
  const fabrica: CatalogPortsFactory = { criar };
  return { fabrica, criar, search, rate };
}

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

function postBusca(porta: number, q: string): Promise<{ status: number; text: string }> {
  const corpo = JSON.stringify({ q });
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        path: CATALOG_SEARCH_PATH,
        method: 'POST',
        headers: {
          Origin: SITE,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

describe('montarCatalogo sem variavel (rota inexistente)', () => {
  it('ambiente vazio: nao monta e nao chama a fabrica', () => {
    const f = fabricaFalsa();
    expect(montarCatalogo({}, f.fabrica)).toBeUndefined();
    expect(f.criar).not.toHaveBeenCalled();
  });

  it('falta de qualquer uma das tres variaveis: nao monta', () => {
    const semUrl: Record<string, string | undefined> = { ...COMPLETO };
    delete semUrl[CATALOG_DATABASE_URL_ENV];
    const semChave: Record<string, string | undefined> = { ...COMPLETO };
    delete semChave[CATALOG_RATE_KEY_ENV];
    const semSite: Record<string, string | undefined> = { ...COMPLETO };
    delete semSite['SITE_URL'];
    const f = fabricaFalsa();
    expect(montarCatalogo(semUrl, f.fabrica)).toBeUndefined();
    expect(montarCatalogo(semChave, f.fabrica)).toBeUndefined();
    expect(montarCatalogo(semSite, f.fabrica)).toBeUndefined();
    expect(f.criar).not.toHaveBeenCalled();
  });

  it('valor vazio conta como ausente', () => {
    const f = fabricaFalsa();
    expect(montarCatalogo({ ...COMPLETO, [CATALOG_DATABASE_URL_ENV]: '' }, f.fabrica)).toBeUndefined();
    expect(montarCatalogo({ ...COMPLETO, [CATALOG_RATE_KEY_ENV]: '' }, f.fabrica)).toBeUndefined();
  });

  it('chave HMAC curta: nao monta (fecha, sem revelar o tamanho)', () => {
    const f = fabricaFalsa();
    expect(montarCatalogo({ ...COMPLETO, [CATALOG_RATE_KEY_ENV]: 'c'.repeat(31) }, f.fabrica)).toBeUndefined();
    expect(f.criar).not.toHaveBeenCalled();
  });

  it('sem fabrica de portas: nao monta mesmo com as variaveis', () => {
    expect(montarCatalogo(COMPLETO, undefined)).toBeUndefined();
  });

  it('a rota responde 404 quando a montagem devolve undefined', async () => {
    const porta = await subir(montarCatalogo({}, fabricaFalsa().fabrica));
    const r = await postBusca(porta, 'pedr');
    expect(r.status).toBe(404);
  });
});

describe('montarCatalogo com variaveis presentes (fabrica falsa)', () => {
  it('monta com URL, chave e SITE_URL recebidos pela fabrica, e devolve as portas dela', () => {
    const f = fabricaFalsa();
    const opts = montarCatalogo(COMPLETO, f.fabrica);
    expect(opts).toBeDefined();
    expect(f.criar).toHaveBeenCalledTimes(1);
    expect(f.criar).toHaveBeenCalledWith({ databaseUrl: URL_SINTETICA, rateKey: CHAVE });
    expect(opts?.search).toBe(f.search);
    expect(opts?.rate).toBe(f.rate);
    expect(opts?.siteUrl).toBe(SITE);
  });

  it('a rota responde 200 com os itens da fabrica falsa, sem o termo na resposta', async () => {
    const f = fabricaFalsa();
    const porta = await subir(montarCatalogo(COMPLETO, f.fabrica));
    const r = await postBusca(porta, 'pedr');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ status: 'ok', items: [LINHA] });
    expect(f.rate.hit).toHaveBeenCalledTimes(1);
  });
});
