// H-019 | Ligacao da busca na composicao, com teste HTTP em memoria (docs/factory/64-DESENHO-H019.md, §3.1).
// Monta pelo ponto de montagem real (montarIntegracoes) com a fabrica Pg real (criarFabricaCatalogo) sobre
// um pool FALSO. Nenhuma conexao, nenhum valor real: as variaveis abaixo sao sinteticas.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-019');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CATALOG_SEARCH_PATH } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { montarIntegracoes, type ComposicaoEnv } from '../src/composicao.js';
import { criarFabricaCatalogo, type CatalogPool } from '../src/catalog/fabrica-pg.js';

const SITE = 'https://fastpro.example.test';
const CHAVE = 'h'.repeat(40);
const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 1,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Servico sintetico',
  modality: 'presencial',
  regulated: false,
};

interface Chamada {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Pool falso: responde por texto de SQL e registra cada chamada (sem rede). */
function poolFalso() {
  const chamadas: Chamada[] = [];
  let liberados = 0;
  const responder = (text: string): Record<string, unknown>[] => {
    if (text.includes('private.catalog_search')) return [LINHA];
    if (text.includes('private.rl_check')) return [{ out_ok: true, out_retry_after: 0 }];
    return [];
  };
  const executar = async (text: string, params: unknown[] = []) => {
    chamadas.push({ text, params });
    return { rows: responder(text) };
  };
  const pool: CatalogPool = {
    connect: async () => ({
      query: executar,
      release: () => {
        liberados += 1;
      },
    }),
    query: executar,
  };
  return { pool, chamadas, liberados: () => liberados };
}

const ENV_COMPLETO: ComposicaoEnv = {
  DATABASE_URL_APP_API: 'postgres://app_api_sintetico@db.example.test:5432/fastpro_sintetico',
  CATALOG_RATE_HMAC_KEY: CHAVE,
  SITE_URL: SITE,
};

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

async function subirComEnv(env: ComposicaoEnv, pool: CatalogPool): Promise<number> {
  const integracoes = montarIntegracoes(env, {
    fabricaCatalogo: criarFabricaCatalogo(() => pool),
  });
  const server = createServer((req, res) =>
    handleRequest(req, res, { tickSecret: undefined, catalog: integracoes.catalog }).catch(() => {
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

describe('busca ligada pela composicao (fabrica Pg sobre pool falso)', () => {
  it('sem as variaveis, a rota continua 404 e nenhum pool e aberto', async () => {
    const { pool, chamadas } = poolFalso();
    const env: Record<string, string | undefined> = { ...ENV_COMPLETO };
    delete env['DATABASE_URL_APP_API'];
    const porta = await subirComEnv(env, pool);
    const r = await postBusca(porta, 'pedr');
    expect(r.status).toBe(404);
    expect(chamadas).toEqual([]);
  });

  it('com as variaveis, a rota responde 200 pelo caminho Pg (transacao curta e limite de taxa)', async () => {
    const f = poolFalso();
    const porta = await subirComEnv(ENV_COMPLETO, f.pool);
    const r = await postBusca(porta, '  Pedr  ');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ status: 'ok', items: [LINHA] });

    const textos = f.chamadas.map((c) => c.text);
    expect(textos).toContain('begin');
    expect(textos).toContain('commit');
    expect(textos.indexOf('begin')).toBeLessThan(textos.indexOf(textos.find((t) => t.includes('catalog_search')) ?? ''));
    const busca = f.chamadas.find((c) => c.text.includes('private.catalog_search'));
    expect(busca?.params).toEqual(['Pedr']);
    expect(f.liberados()).toBe(1);
  });

  it('o limite de taxa usa chave HMAC (nunca o IP em claro) e nao vaza valores na resposta', async () => {
    const f = poolFalso();
    const porta = await subirComEnv(ENV_COMPLETO, f.pool);
    const r = await postBusca(porta, 'pedr');
    expect(r.status).toBe(200);
    const rl = f.chamadas.find((c) => c.text.includes('private.rl_check'));
    expect(String(rl?.params[0])).toMatch(/^catalog_search:[0-9a-f]{64}$/);
    expect(JSON.stringify(f.chamadas)).not.toContain('127.0.0.1');
    expect(r.text).not.toContain(CHAVE);
    expect(r.text).not.toContain(ENV_COMPLETO['DATABASE_URL_APP_API'] ?? '');
  });
});
