// Issue 47 (H-034) | Rota GET /v1/requests (lista do dono) em HTTP, com servidor real e portas falsas
// (docs/factory/133-DESENHO-H034.md, §8: T-02, T-03, T-08, T-11, T-12, T-17). Sem banco, sem rede externa, sem mapas.
// Sentinelas por concatenacao: o check:secrets nao confunde com segredo real.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { hashSessionSecret, type RequestListRow, type RequestListStorePort } from '@fastpro/db';
import { handleRequestListRoute, type RequestListRouteOptions } from '../src/requests/list-route.js';
import { handleRequestDetailRoute, type RequestDetailRouteOptions } from '../src/requests/detail-route.js';
import type { VisibilityStorePort } from '../src/requests/detail-service.js';
import { createAddressVault } from '../src/requests/address-crypto.js';

const DONO = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const INEXISTENTE = '66666666-6666-4666-8666-666666666666';
const AGORA = Date.UTC(2026, 10, 14, 12, 0, 0);

// Sentinelas (montadas por concatenacao).
const SENT_SERVICO = ['servico', 'sentinela', 'h034', 'lista'].join('-');
const SENT_EMAIL = ['h034', 'sentinela', 'lista'].join('-') + '@example.test';
const SENT_ERRO = ['falha', 'driver', 'sentinela', 'h034', 'conexao'].join(' ');
const SENT_CHAVE = ['chave', 'sentinela', 'h034', 'detalhe', '0123456789abcdef'].join('-');

const SEG = {
  dono: ['sessao', 'dono', 'h034', '0000000000000000000000000000'].join('-'),
  outro: ['sessao', 'outro', 'h034', '0000000000000000000000000000'].join('-'),
  revogada: ['sessao', 'revogada', 'h034', '0000000000000000000000000000'].join('-'),
  vencida: ['sessao', 'vencida', 'h034', '0000000000000000000000000000'].join('-'),
};

interface SessaoFalsa {
  readonly userId: string;
  readonly revogada?: boolean;
  readonly expiraEm?: number;
}

const SESSOES = new Map<string, SessaoFalsa>([
  [hashSessionSecret(SEG.dono), { userId: DONO }],
  [hashSessionSecret(SEG.outro), { userId: OUTRO }],
  [hashSessionSecret(SEG.revogada), { userId: DONO, revogada: true }],
  [hashSessionSecret(SEG.vencida), { userId: DONO, expiraEm: AGORA - 1 }],
]);

/** Loja falsa da lista: conta chamadas (sessao sem dado nao pode chegar aqui) e pode lancar erro. */
class LojaFalsa implements RequestListStorePort {
  chamadas = 0;
  linhas: RequestListRow[] = [];
  erro: Error | null = null;

  async listOwner(_userId: string, _nowMs: number, _cursor: unknown, limit: number): Promise<readonly RequestListRow[]> {
    this.chamadas += 1;
    if (this.erro !== null) throw this.erro;
    return this.linhas.slice(0, limit);
  }
}

function linhaDeExemplo(): RequestListRow {
  return {
    id: PEDIDO,
    serviceName: SENT_SERVICO,
    status: 'publicado',
    prazo: 'aberto',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(AGORA + 168 * 3600 * 1000).toISOString(),
    cursorTs: '2026-11-14T12:00:00.000000Z',
  };
}

let loja: LojaFalsa;
let servidor: Server;
let porta: number;

function opcoes(): RequestListRouteOptions {
  return {
    sessions: {
      async authenticate(hash: string, nowMs: number) {
        const s = SESSOES.get(hash);
        if (s === undefined || s.revogada === true) return null;
        if (s.expiraEm !== undefined && nowMs >= s.expiraEm) return null;
        return { userId: s.userId };
      },
    },
    service: { store: loja, clock: { nowMs: () => AGORA } },
  };
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function pedir(caminho: string, cookie?: string, metodo = 'GET'): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cookie === undefined ? {} : { cookie } },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function sessao(segredo: string): string {
  return `${SESSION_COOKIE_NAME}=${segredo}`;
}

/** Assinatura da resposta: status, cabecalhos de politica e corpo (Date e conexao variam; ficam de fora). */
function assinatura(r: Resposta): string {
  return JSON.stringify({
    status: r.status,
    cacheControl: r.headers['cache-control'],
    referrerPolicy: r.headers['referrer-policy'],
    contentType: r.headers['content-type'],
    setCookie: r.headers['set-cookie'],
    body: r.body,
  });
}

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequestListRoute(req, res, opcoes());
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  loja = new LojaFalsa();
  loja.linhas = [linhaDeExemplo()];
  vi.restoreAllMocks();
});

describe('GET /v1/requests: sessao sem dado (T-02)', () => {
  it('sem cookie, cookie malformado, sessao revogada e sessao vencida: 401 identico, sem Set-Cookie, sem dado, sem banco', async () => {
    const casos = [
      await pedir('/v1/requests'),
      await pedir('/v1/requests', `${SESSION_COOKIE_NAME}=%%%`),
      await pedir('/v1/requests', sessao(SEG.revogada)),
      await pedir('/v1/requests', sessao(SEG.vencida)),
    ];
    for (const r of casos) {
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body)).toEqual({ code: 'sessao_necessaria' });
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.body).not.toContain(SENT_SERVICO);
    }
    const assinaturas = new Set(casos.map((r) => assinatura(r)));
    expect(assinaturas.size).toBe(1);
    expect(loja.chamadas).toBe(0);
  });

  it('cookie de sessao valido chega ao banco e responde 200 com a lista do dono', async () => {
    const r = await pedir('/v1/requests', sessao(SEG.dono));
    expect(r.status).toBe(200);
    expect(loja.chamadas).toBe(1);
    expect(JSON.parse(r.body)).toMatchObject({ nextCursor: null });
  });
});

describe('GET /v1/requests: lista vazia (T-08)', () => {
  it('dono sem pedidos recebe 200 com lista vazia e nextCursor nulo (nao e erro)', async () => {
    loja.linhas = [];
    const r = await pedir('/v1/requests', sessao(SEG.dono));
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"items":[],"nextCursor":null}');
  });
});

describe('GET /v1/requests: cabecalhos (T-11)', () => {
  it('200, 400, 401, 405 e 503 trazem no-store, no-referrer e JSON, e nenhum Access-Control-*', async () => {
    const respostas: Resposta[] = [];
    respostas.push(await pedir('/v1/requests', sessao(SEG.dono)));
    respostas.push(await pedir('/v1/requests?cursor=lixo', sessao(SEG.dono)));
    respostas.push(await pedir('/v1/requests'));
    respostas.push(await pedir('/v1/requests', sessao(SEG.dono), 'POST'));
    loja.erro = new Error(SENT_ERRO);
    respostas.push(await pedir('/v1/requests', sessao(SEG.dono)));
    expect(respostas.map((r) => r.status)).toEqual([200, 400, 401, 405, 503]);
    for (const r of respostas) {
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(String(r.headers['content-type'])).toMatch(/^application\/json/);
      for (const nome of Object.keys(r.headers)) expect(nome.startsWith('access-control-')).toBe(false);
    }
  });
});

describe('GET /v1/requests: parametros e cursor', () => {
  it('parametro extra e cursor malformado respondem 400 com codigo fixo, sem tocar o banco', async () => {
    const extra = await pedir('/v1/requests?limit=1000', sessao(SEG.dono));
    expect(extra.status).toBe(400);
    expect(JSON.parse(extra.body)).toEqual({ code: 'parametro_invalido' });
    const cursor = await pedir('/v1/requests?cursor=nao-e-cursor', sessao(SEG.dono));
    expect(cursor.status).toBe(400);
    expect(JSON.parse(cursor.body)).toEqual({ code: 'cursor_invalido' });
    expect(loja.chamadas).toBe(0);
  });
});

describe('GET /v1/requests: sentinelas e falha de banco (T-12, T-17)', () => {
  it('erro do banco vira 503 indisponivel com Retry-After 10, sem texto do driver, sem sentinela em log', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
    loja.erro = new Error(`${SENT_ERRO} ${SENT_EMAIL} ${SENT_SERVICO}`);
    const r = await pedir('/v1/requests', sessao(SEG.dono));
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ code: 'indisponivel' });
    expect(r.headers['retry-after']).toBe('10');
    expect(r.body).not.toContain(SENT_EMAIL);
    expect(r.body).not.toContain(SENT_SERVICO);
    expect(r.body).not.toContain('conexao');
    const emLogs = JSON.stringify(logs.map((spy) => spy.mock.calls));
    for (const sentinela of [SENT_ERRO, SENT_EMAIL, SENT_SERVICO, SENT_CHAVE]) expect(emLogs).not.toContain(sentinela);
  });

  it('nome do servico so aparece no corpo 200; sentinelas nao vazam em log na leitura normal', async () => {
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => undefined), vi.spyOn(console, 'error').mockImplementation(() => undefined)];
    const r = await pedir('/v1/requests', sessao(SEG.dono));
    expect(r.status).toBe(200);
    expect(r.body).toContain(SENT_SERVICO);
    expect(JSON.stringify(logs.map((spy) => spy.mock.calls))).not.toContain(SENT_SERVICO);
  });
});

describe('T-03: detalhe da Issue 45 em HTTP (404 uniforme, rota nao alterada)', () => {
  let servidorDetalhe: Server;
  let portaDetalhe: number;

  /** Visibilidade falsa: nenhum pedido pertence a DONO nem existe com o id pedido; mesma resposta para todos. */
  const visibilidade: VisibilityStorePort = {
    async readOwner() {
      return null;
    },
    async readProfessional() {
      return null;
    },
  };

  const detalhe: RequestDetailRouteOptions = {
    sessions: {
      async authenticate(hash: string) {
        const s = SESSOES.get(hash);
        return s === undefined ? null : { userId: s.userId };
      },
    },
    service: {
      store: visibilidade,
      addressVault: createAddressVault(SENT_CHAVE),
      clock: { nowMs: () => AGORA },
    },
  };

  beforeAll(async () => {
    servidorDetalhe = createServer((req: IncomingMessage, res: ServerResponse) => {
      void handleRequestDetailRoute(req, res, (req.url ?? '').split('?')[0] ?? '', detalhe);
    });
    await new Promise<void>((resolve) => servidorDetalhe.listen(0, '127.0.0.1', () => resolve()));
    portaDetalhe = (servidorDetalhe.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => servidorDetalhe.close(() => resolve()));
  });

  function pedirDetalhe(caminho: string, segredo: string): Promise<Resposta> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: portaDetalhe, method: 'GET', path: caminho, headers: { cookie: sessao(segredo) } },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c: Buffer) => partes.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('pedido de outro cliente, id inexistente e id mal formado devolvem 404 identico byte a byte', async () => {
    const outroDono = await pedirDetalhe(`/v1/requests/${PEDIDO}`, SEG.outro);
    const inexistente = await pedirDetalhe(`/v1/requests/${INEXISTENTE}`, SEG.dono);
    const malformado = await pedirDetalhe('/v1/requests/nao-e-uuid', SEG.dono);
    expect(outroDono.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(malformado.status).toBe(404);
    expect(assinatura(outroDono)).toBe(assinatura(inexistente));
    expect(assinatura(inexistente)).toBe(assinatura(malformado));
    expect(outroDono.headers['set-cookie']).toBeUndefined();
  });
});
