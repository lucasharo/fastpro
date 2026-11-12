// H-019 | Fabrica Pg da busca sobre pool falso (docs/factory/64-DESENHO-H019.md, §3.1, §3.3). Em memoria:
// sem banco, sem rede, sem variavel real. Valores sinteticos; fetch global bloqueado.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes da fabrica Pg de H-019');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CATALOG_SEARCH_PATH } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import {
  CATALOG_DATABASE_URL_ENV,
  CATALOG_RATE_KEY_ENV,
  CATALOG_SITE_URL_ENV,
  montarCatalogo,
  type CatalogEnv,
} from '../src/catalog/compose.js';
import { criarFabricaCatalogo, type CatalogPool } from '../src/catalog/fabrica-pg.js';

const SITE = 'https://fastpro.example.test';
const URL_SINTETICA = 'postgres://app_api_sintetico@db.example.test:5432/fastpro_sintetico';
const CHAVE_TAXA = 'k'.repeat(40);
const TERMO = 'pedr';
const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 2,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Servente de pedreiro sintetico',
  modality: 'presencial',
  regulated: false,
};

const COMPLETO: CatalogEnv = {
  [CATALOG_DATABASE_URL_ENV]: URL_SINTETICA,
  [CATALOG_RATE_KEY_ENV]: CHAVE_TAXA,
  [CATALOG_SITE_URL_ENV]: SITE,
};

interface Chamada {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Pool falso: registra cada consulta e responde pelo texto (limite, busca, transacao). */
function poolFalso(opcoes: { rateOk?: boolean; falha?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const executa = async (text: string, params: unknown[] = []) => {
    chamadas.push({ text, params });
    if (text.includes('rl_check')) {
      return { rows: [{ out_ok: opcoes.rateOk ?? true, out_retry_after: null }] };
    }
    if (text.includes('catalog_search')) {
      if (opcoes.falha) throw new Error(`erro do banco com ${TERMO}`);
      return { rows: [LINHA] };
    }
    return { rows: [] };
  };
  const cliente = { query: executa, release: () => undefined };
  const pool: CatalogPool = { connect: async () => cliente, query: executa };
  return { chamadas, pool };
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

async function subir(env: CatalogEnv, abrirPool: (url: string) => CatalogPool): Promise<number> {
  const catalog = montarCatalogo(env, criarFabricaCatalogo(abrirPool));
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

function buscar(porta: number, termo: string): Promise<{ status: number; text: string }> {
  const corpo = JSON.stringify({ q: termo });
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

describe('H-019 fabrica Pg da busca sobre pool injetado', () => {
  it('com as tres variaveis: a rota existe e responde 200 com a projecao publica', async () => {
    const { pool, chamadas } = poolFalso();
    const porta = await subir(COMPLETO, () => pool);
    const r = await buscar(porta, TERMO);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ status: 'ok', items: [LINHA] });
    // O termo vai so como parametro ligado, nunca no texto SQL.
    const busca = chamadas.find((c) => c.text.includes('catalog_search'));
    expect(busca?.params).toEqual([TERMO]);
    expect(chamadas.every((c) => !c.text.includes(TERMO))).toBe(true);
  });

  it('limite de taxa estourado: 429 sem consultar o catalogo', async () => {
    const { pool, chamadas } = poolFalso({ rateOk: false });
    const porta = await subir(COMPLETO, () => pool);
    const r = await buscar(porta, TERMO);
    expect(r.status).toBe(429);
    expect(chamadas.some((c) => c.text.includes('catalog_search'))).toBe(false);
  });

  it('falha do banco vira 503 fixo, sem a mensagem do erro nem o termo', async () => {
    const { pool } = poolFalso({ falha: true });
    const porta = await subir(COMPLETO, () => pool);
    const r = await buscar(porta, TERMO);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text)).toEqual({ status: 'erro', code: 'falha' });
    expect(r.text).not.toContain(TERMO);
  });

  it('o pool e aberto uma vez por URL, mesmo com varias montagens', () => {
    let aberturas = 0;
    const fabrica = criarFabricaCatalogo(() => {
      aberturas += 1;
      return poolFalso().pool;
    });
    montarCatalogo(COMPLETO, fabrica);
    montarCatalogo(COMPLETO, fabrica);
    expect(aberturas).toBe(1);
  });

  it('sem fabrica a montagem nao liga, mesmo com as tres variaveis', () => {
    expect(montarCatalogo(COMPLETO, undefined)).toBeUndefined();
  });
});
