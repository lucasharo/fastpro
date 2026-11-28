// Issue 47 (H-034) | Cookie do rascunho expirado na resposta de sucesso da publicacao (decisao 519; desenho §6.3, T-10).
// Servidor HTTP real com a rota isolada; loja, geocodificacao e sessao sao falsas. Sem banco e sem rede externa.
// Sentinelas e chaves de teste por concatenacao ou em memoria (nunca de .env.local).
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DRAFT_CLEAR_COOKIE_HEADER,
  DRAFT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  parseBreakerCaps,
  type PermanentPoint,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { handleRequestPublishRoute, REQUEST_PUBLISH_PATH, type PublishRouteOptions } from '../src/requests/publish-route.js';
import type { PublishStorePort } from '../src/requests/publish-service.js';
import { createDraftHasher, newDraftSecret } from '../src/drafts/draft-hash.js';
import { createAddressVault } from '../src/requests/address-crypto.js';
import type {
  GeocodingPermanentPort,
  GeoPointStorePort,
  GeoReserveOutcome,
  PermanentLookup,
} from '../src/geo/permanent-ports.js';
import type {
  PublishBeginOutcome,
  PublishCommitOutcome,
} from '../../../packages/db/src/request-publish.js';

const SITE = 'https://fastpro.example';
const USER = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 10, 14, 12, 0, 0);
const CHAVE = 'k'.repeat(32);
const CHAVE_ENDERECO_TESTE = ['chave', 'de', 'teste', 'issue47', 'em', 'memoria', '0123456789'].join('-');
const SESSAO_OK = ['sessao', 'valida', 'de', 'teste', 'issue47', '000000000000000000'].join('-');
const CHAVE_IDEM = 'idem-chave-de-teste-47-01';
const PEDIDO_CRIADO = {
  id: PEDIDO,
  publishedAt: new Date(AGORA).toISOString(),
  acceptanceDeadlineAt: new Date(AGORA + 168 * 3600 * 1000).toISOString(),
};

class LojaFalsa implements PublishStorePort {
  beginResultado: PublishBeginOutcome = { status: 'ok', addressText: 'Rua Exemplo, 10' };
  commitResultado: PublishCommitOutcome = { status: 'criado', pedido: PEDIDO_CRIADO };
  beginLanca = false;
  commitLanca = false;

  async begin(): Promise<PublishBeginOutcome> {
    if (this.beginLanca) throw new Error('falha do banco no inicio');
    return this.beginResultado;
  }

  async commit(): Promise<PublishCommitOutcome> {
    if (this.commitLanca) throw new Error('falha do banco no commit');
    return this.commitResultado;
  }

  async abort(): Promise<boolean> {
    return true;
  }
}

class GeoFalsa implements GeoPointStorePort {
  async reserve(): Promise<GeoReserveOutcome> {
    return { acao: 'chamar', ref: 'ref-1' };
  }

  async storePermanent(): Promise<string> {
    return 'ponto-1';
  }

  async markNoResult(): Promise<void> {}

  async release(): Promise<void> {}

  async panel(): Promise<{ readonly used: number; readonly aguardando: number }> {
    return { used: 0, aguardando: 0 };
  }
}

class ProvedorFalso implements GeocodingPermanentPort {
  async geocode(): Promise<PermanentLookup> {
    return { status: 'ponto', point: { lon: -46.6, lat: -23.5, precision: 'rooftop' } as PermanentPoint };
  }
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

let servidor: Server;
let porta = 0;
let loja: LojaFalsa;
let segredoRascunho: string;

function opcoes(): PublishRouteOptions {
  return {
    siteUrl: SITE,
    sessions: {
      async authenticate(hash: string) {
        return hash === hashSessionSecret(SESSAO_OK) ? { userId: USER } : null;
      },
    },
    service: {
      store: loja,
      geo: {
        store: new GeoFalsa(),
        provider: new ProvedorFalso(),
        hashAddress: () => 'a'.repeat(64),
        caps: parseBreakerCaps('100', '200'),
        clock: () => AGORA,
      },
      hasher: createDraftHasher(CHAVE),
      addressVault: createAddressVault(CHAVE_ENDERECO_TESTE),
      chave: CHAVE,
      rateKey: (finalidade: string, identificador: string) => `${finalidade}:${identificador}`,
      clock: { nowMs: () => AGORA },
    },
  };
}

function chamar(headers: Record<string, string>, corpo: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: porta, path: REQUEST_PUBLISH_PATH, method: 'POST', headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

function cabecalhosValidos(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Origin: SITE,
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
    'Idempotency-Key': CHAVE_IDEM,
    Cookie: `${SESSION_COOKIE_NAME}=${SESSAO_OK}; ${DRAFT_COOKIE_NAME}=${segredoRascunho}`,
    ...extra,
  };
}

const CORPO_OK = JSON.stringify({ draft_id: DRAFT, content_rev: 3 });

beforeAll(async () => {
  segredoRascunho = newDraftSecret();
  servidor = createServer((req, res) => {
    void handleRequestPublishRoute(req, res, req.url ?? '', opcoes());
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  loja = new LojaFalsa();
});

describe('Set-Cookie de limpeza em toda resposta de sucesso da publicacao (T-10, decisao 519)', () => {
  it('criacao (201) traz exatamente um Set-Cookie de limpeza com os atributos do cookie de criacao; corpo de 4 chaves', async () => {
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(201);
    expect([r.headers['set-cookie']].flat()).toEqual([DRAFT_CLEAR_COOKIE_HEADER]);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie.startsWith(`${DRAFT_COOKIE_NAME}=;`)).toBe(true);
    for (const atributo of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=0']) expect(cookie).toContain(atributo);
    expect(Object.keys(JSON.parse(r.body) as object)).toHaveLength(4);
  });

  it('repeticao com a mesma chave (201 repetida) traz o mesmo cookie e corpo igual a primeira resposta', async () => {
    loja.beginResultado = { status: 'repetida', pedido: PEDIDO_CRIADO };
    const primeira = await chamar(cabecalhosValidos(), CORPO_OK);
    const segunda = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect([segunda.headers['set-cookie']].flat()).toEqual([DRAFT_CLEAR_COOKIE_HEADER]);
    expect(segunda.body).toBe(primeira.body);
  });

  it('ja publicado no inicio (200) traz o cookie de limpeza', async () => {
    loja.beginResultado = { status: 'ja_publicado', pedido: PEDIDO_CRIADO };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(200);
    expect([r.headers['set-cookie']].flat()).toEqual([DRAFT_CLEAR_COOKIE_HEADER]);
  });

  it('ja publicado no commit (200) traz o cookie de limpeza', async () => {
    loja.commitResultado = { status: 'ja_publicado', pedido: PEDIDO_CRIADO };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(200);
    expect([r.headers['set-cookie']].flat()).toEqual([DRAFT_CLEAR_COOKIE_HEADER]);
  });
});

describe('respostas de erro nao trazem o cookie de limpeza (T-10)', () => {
  it('401 sem sessao', async () => {
    const cabecalhos = cabecalhosValidos({ Cookie: `${DRAFT_COOKIE_NAME}=${segredoRascunho}` });
    const r = await chamar(cabecalhos, CORPO_OK);
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('422 sem chave de idempotencia', async () => {
    const cabecalhos = cabecalhosValidos();
    delete cabecalhos['Idempotency-Key'];
    const r = await chamar(cabecalhos, CORPO_OK);
    expect(r.status).toBe(422);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('422 com corpo que nao e JSON', async () => {
    const r = await chamar(cabecalhosValidos(), 'nao-e-json');
    expect(r.status).toBe(422);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('409 quando o conteudo muda entre o inicio e o commit', async () => {
    loja.commitResultado = { status: 'conteudo_alterado' };
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(409);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('503 quando o inicio da publicacao falha no banco', async () => {
    loja.beginLanca = true;
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('503 quando o commit falha no banco', async () => {
    loja.commitLanca = true;
    const r = await chamar(cabecalhosValidos(), CORPO_OK);
    expect(r.status).toBe(503);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});
