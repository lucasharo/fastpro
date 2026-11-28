// H-025 | Montagem do rascunho sem conta (apps/api/src/drafts/compose.ts e composicao.ts), em memoria.
// Sem banco e sem rede: fetch global bloqueado; o papel app_api e uma fabrica falsa. Valores sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de composicao do rascunho');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SqlClient } from '@fastpro/db';
import {
  type DraftCreateInput,
  type DraftRatePort,
  type DraftRecord,
  type DraftStorePort,
  type DraftWriteResult,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { montarIntegracoes } from '../src/composicao.js';
import {
  criarFabricaRascunho,
  DRAFT_DATABASE_URL_ENV,
  DRAFT_IP_KEY_ENV,
  DRAFT_SITE_URL_ENV,
  type DraftPortsFactory,
} from '../src/drafts/compose.js';
import type { DraftRouteOptions } from '../src/drafts/draft-route.js';

const SITE = 'https://fastpro.example.test';
const URL_SINTETICA = 'postgres://app_api_sintetico@db.example.test:5432/exemplo';
const CHAVE_IP = 'h'.repeat(40);
const COMPLETO = {
  [DRAFT_DATABASE_URL_ENV]: URL_SINTETICA,
  [DRAFT_IP_KEY_ENV]: CHAVE_IP,
  [DRAFT_SITE_URL_ENV]: SITE,
};
const PENDENCIAS_TODAS = [DRAFT_DATABASE_URL_ENV, DRAFT_IP_KEY_ENV, DRAFT_SITE_URL_ENV];

/** Banco falso do papel app_api: so registra a escrita recebida (o segredo nunca deve chegar aqui). */
class StoreFalso implements DraftStorePort {
  readonly criacoes: DraftCreateInput[] = [];

  async find(): Promise<DraftRecord | null> {
    return null;
  }

  async create(input: DraftCreateInput): Promise<DraftWriteResult> {
    this.criacoes.push(input);
    return {
      ok: true,
      draft: {
        id: 'rascunho-sintetico-1',
        status: 'aberto',
        serviceId: null,
        addressText: null,
        urgency: null,
        description: null,
        expiresAt: '2026-11-18T12:00:00.000Z',
        updatedAt: '2026-11-11T12:00:00.000Z',
      },
    };
  }

  async patch(): Promise<DraftWriteResult> {
    return { ok: false, code: 'nao_encontrado' };
  }

  async discard(): Promise<boolean> {
    return false;
  }
}

/** Limite de taxa falso: sempre aceita e nao conta nada. */
const LIMITE_LIVRE: DraftRatePort = {
  async check() {
    return { ok: true };
  },
  async hit() {},
};

function fabricaFalsa(store: StoreFalso): DraftPortsFactory {
  return { criar: () => ({ store, rate: LIMITE_LIVRE }) };
}

const servidores: Server[] = [];

/** Sobe o roteador da API em loopback com as opcoes do rascunho dadas (ou sem elas). */
async function servir(drafts: DraftRouteOptions | undefined): Promise<number> {
  const server = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, drafts }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return (server.address() as AddressInfo).port;
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function pedir(porta: number, metodo: string, caminho: string, corpo?: string, headers: Record<string, string> = {}): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (d: Buffer) => partes.push(d));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

afterAll(async () => {
  await Promise.all(
    servidores.map((s) => new Promise<void>((ok) => s.close(() => ok()))),
  );
});

describe('H-025 montagem do rascunho sem conta', () => {
  it('sem variaveis: rotas nao ligam e as pendencias sao so nomes', () => {
    const store = new StoreFalso();
    const r = montarIntegracoes({}, { fabricaRascunho: fabricaFalsa(store) });
    expect(r.drafts).toBeUndefined();
    expect(r.pendenciasRascunho).toEqual(PENDENCIAS_TODAS);
    expect(store.criacoes).toEqual([]);
  });

  it('chave curta: nao liga e marca so o nome da variavel, sem tamanho nem valor', () => {
    const curta = 'h'.repeat(31);
    const r = montarIntegracoes(
      { ...COMPLETO, [DRAFT_IP_KEY_ENV]: curta },
      { fabricaRascunho: fabricaFalsa(new StoreFalso()) },
    );
    expect(r.drafts).toBeUndefined();
    expect(r.pendenciasRascunho).toEqual([`${DRAFT_IP_KEY_ENV} (curta)`]);
    expect(JSON.stringify(r.pendenciasRascunho)).not.toContain(curta);
  });

  it('variaveis completas sem fabrica do pool: nao liga (404)', () => {
    const r = montarIntegracoes(COMPLETO, {});
    expect(r.drafts).toBeUndefined();
    expect(r.pendenciasRascunho).toEqual(['fabrica do pool do rascunho (ainda nao montada na funcao)']);
  });

  it('variaveis completas com fabrica: liga com o site e sem pendencias', () => {
    const r = montarIntegracoes(COMPLETO, { fabricaRascunho: fabricaFalsa(new StoreFalso()) });
    expect(r.drafts).toBeDefined();
    expect(r.drafts?.siteUrl).toBe(SITE);
    expect(r.pendenciasRascunho).toEqual([]);
    // A chave do IP e so usada como HMAC: o objeto de opcoes nao guarda o valor em claro.
    expect(JSON.stringify(r.drafts)).not.toContain(CHAVE_IP);
  });

  it('sem variaveis, a rota do rascunho responde 404 sem corpo (mesmo com a fabrica montada)', async () => {
    const r = montarIntegracoes({}, { fabricaRascunho: fabricaFalsa(new StoreFalso()) });
    const porta = await servir(r.drafts);
    const origem = { Origin: SITE, 'Content-Type': 'application/json' };
    const criar = await pedir(porta, 'POST', '/v1/drafts', '{"urgency":"imediato"}', origem);
    expect(criar.status).toBe(404);
    expect(criar.body).toBe('');
    const ler = await pedir(porta, 'GET', '/v1/drafts/current');
    expect(ler.status).toBe(404);
  });

  it('com variaveis: POST cria (201) com cookie novo e o banco recebe so o hash do segredo', async () => {
    const store = new StoreFalso();
    const r = montarIntegracoes(COMPLETO, { fabricaRascunho: fabricaFalsa(store) });
    const porta = await servir(r.drafts);
    const resp = await pedir(porta, 'POST', '/v1/drafts', '{"urgency":"imediato"}', {
      Origin: SITE,
      'Content-Type': 'application/json',
    });
    expect(resp.status).toBe(201);
    const cookie = String(resp.headers['set-cookie'] ?? '');
    const segredo = /^__Host-fp_draft=([A-Za-z0-9_-]{43});/.exec(cookie)?.[1];
    expect(segredo).toBeDefined();
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict; Path=/');

    expect(store.criacoes).toHaveLength(1);
    const escrita = store.criacoes[0];
    expect(escrita?.secretHash).toBe(createHash('sha256').update(segredo ?? '', 'utf8').digest('hex'));
    const gravado = JSON.stringify(store.criacoes);
    expect(gravado).not.toContain(segredo ?? '');
    // O IP do socket (loopback) so entra como HMAC, nunca em claro.
    expect(gravado).not.toContain('127.0.0.1');
    expect(resp.body).not.toContain(segredo ?? '');
  });

  it('criar as portas nao consulta o banco e o cliente SQL e aberto uma vez por URL', () => {
    let aberturas = 0;
    let consultas = 0;
    const cliente: SqlClient = {
      query: async () => {
        consultas++;
        throw new Error('nao deveria consultar o banco na montagem');
      },
    };
    const fabrica = criarFabricaRascunho(() => {
      aberturas++;
      return cliente;
    });
    fabrica.criar(URL_SINTETICA);
    fabrica.criar(URL_SINTETICA);
    expect(aberturas).toBe(1);
    fabrica.criar(`${URL_SINTETICA}?outra=1`);
    expect(aberturas).toBe(2);
    expect(consultas).toBe(0);
  });
});
