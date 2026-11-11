// H-012 | T-H012-01 (422 no HTTP), T-H012-02 (Origin e Content-Type antes do corpo, sem consumo),
// T-H012-03 (resposta uniforme 400), T-H012-04 (200 com cookie), T-H012-09 (cabecalhos de §5).
// Servidor de loopback e cliente node:http; fetch bloqueado. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-012');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConsumeDeps, ConsumeLinkResult } from '@fastpro/db';
import { handleRequest } from '../src/app.js';

const SITE = 'https://fastpro.example.test';
const TOKEN_VALIDO = 'TOKEN-VALIDO-' + 'v'.repeat(30);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SENTINELA_EMAIL = 'rota.h012@example.test';

class RepoFake {
  calls = 0;
  private usado = false;
  readonly hashValido = sha(TOKEN_VALIDO);

  async consumeLink(tokenHash: string): Promise<ConsumeLinkResult> {
    this.calls += 1;
    if (tokenHash !== this.hashValido || this.usado) return { resultado: 'invalido' };
    this.usado = true;
    return {
      resultado: 'ok',
      challengeId: randomUUID(),
      purpose: 'login',
      emailEnc: Buffer.from('bloco-sintetico'),
      draftId: null,
    };
  }
}

function montarDeps(repo: RepoFake): ConsumeDeps {
  return {
    repo,
    accounts: {
      async ensureCustomer() {
        return { status: 'ok', userId: randomUUID() };
      },
    },
    stages: {
      async openStage() {
        return true;
      },
    },
    decryptEmail: () => SENTINELA_EMAIL,
    clock: { nowMs: () => Date.UTC(2099, 0, 1, 12) },
    newSecret: () => 'S'.repeat(43),
    newSessionId: () => randomUUID(),
  };
}

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

async function subir(semRota = false): Promise<{ porta: number; repo: RepoFake }> {
  const repo = new RepoFake();
  const deps = montarDeps(repo);
  const server = createServer((req, res) =>
    handleRequest(req, res, {
      tickSecret: undefined,
      consume: semRota ? undefined : { deps, siteUrl: SITE },
    }).catch(() => {
      res.statusCode = 500;
      res.end();
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { porta: (server.address() as AddressInfo).port, repo };
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

function pedir(
  porta: number,
  metodo: string,
  caminho: string,
  headers: Record<string, string>,
  corpo?: string,
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers },
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

const JSON_OK = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
const CAMINHO = '/v1/auth/challenges/consume';
const postar = (porta: number, corpo: string, headers: Record<string, string> = JSON_OK) =>
  pedir(porta, 'POST', CAMINHO, headers, corpo);

describe('T-H012-02 Origin e Content-Type antes do corpo', () => {
  it('Origin de outro site: 403 origem_invalida, sem consumo', async () => {
    const { porta, repo } = await subir();
    const r = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }), {
      ...JSON_OK,
      Origin: 'https://atacante.example.test',
    });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual({ code: 'origem_invalida' });
    expect(repo.calls).toBe(0);
  });

  it('sem Origin e com Sec-Fetch-Site cross-site: 403', async () => {
    const { porta, repo } = await subir();
    const semOrigem: Record<string, string> = { ...JSON_OK, 'Sec-Fetch-Site': 'cross-site' };
    delete semOrigem.Origin;
    const r = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }), semOrigem);
    expect(r.status).toBe(403);
    expect(repo.calls).toBe(0);
  });

  it('Content-Type que nao e JSON: 415 tipo_invalido, sem consumo', async () => {
    const { porta, repo } = await subir();
    const r = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }), {
      ...JSON_OK,
      'Content-Type': 'text/plain',
    });
    expect(r.status).toBe(415);
    expect(JSON.parse(r.text)).toEqual({ code: 'tipo_invalido' });
    expect(repo.calls).toBe(0);
  });

  it('recusa por cabecalho responde sem esperar o corpo (nao le antes de conferir)', async () => {
    const { porta, repo } = await subir();
    const resposta = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: porta,
          path: CAMINHO,
          method: 'POST',
          headers: { ...JSON_OK, Origin: 'https://atacante.example.test', 'Content-Length': '100' },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
        },
      );
      req.on('error', reject);
      req.write('{"tok'); // corpo incompleto e nunca encerrado
    });
    expect(resposta).toBe(403);
    expect(repo.calls).toBe(0);
  });
});

describe('T-H012-01 forma do corpo (422, sem consumo)', () => {
  it.each([
    ['campo extra code', JSON.stringify({ token: TOKEN_VALIDO, code: '123456' })],
    ['campo extra email', JSON.stringify({ token: TOKEN_VALIDO, email: 'a@example.test' })],
    ['token que nao e texto', JSON.stringify({ token: 123456 })],
    ['sem token', JSON.stringify({})],
    ['JSON invalido', '{token:'],
    ['corpo acima de 1 KiB', JSON.stringify({ token: 'x'.repeat(2000) })],
  ])('%s: 422 pedido_invalido', async (_, corpo) => {
    const { porta, repo } = await subir();
    const r = await postar(porta, corpo);
    expect(r.status).toBe(422);
    expect(JSON.parse(r.text)).toEqual({ code: 'pedido_invalido' });
    expect(repo.calls).toBe(0);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

describe('T-H012-03 link invalido: resposta uniforme', () => {
  it('inexistente e ja usado: mesmo status, cabecalhos e corpo; sem Set-Cookie', async () => {
    const { porta, repo } = await subir();
    const primeiro = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }));
    expect(primeiro.status).toBe(200);
    const usado = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }));
    const inexistente = await postar(porta, JSON.stringify({ token: 'nao-existe-' + 'n'.repeat(30) }));

    for (const r of [usado, inexistente]) {
      expect(r.status).toBe(400);
      expect(r.text).toBe(JSON.stringify({ code: 'link_invalido' }));
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    }
    expect(usado.text).toBe(inexistente.text);
    expect(repo.calls).toBe(3);
  });
});

describe('T-H012-04 link valido: 200 com cookie da etapa', () => {
  it('Set-Cookie com __Host-, HttpOnly, Secure, SameSite=Strict, Max-Age=900 e sem Domain', async () => {
    const { porta } = await subir();
    const r = await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ status: 'identificado' });
    const cookie = String(r.headers['set-cookie'] ?? '');
    expect(cookie).toBe(
      `__Host-fp_ident=${'S'.repeat(43)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
    );
    expect(cookie.toLowerCase()).not.toContain('domain=');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('nenhuma resposta traz CORS nem o e-mail ou o token', async () => {
    const { porta } = await subir();
    const respostas = [
      await postar(porta, JSON.stringify({ token: TOKEN_VALIDO })),
      await postar(porta, JSON.stringify({ token: TOKEN_VALIDO })),
    ];
    for (const r of respostas) {
      expect(Object.keys(r.headers).some((k) => k.startsWith('access-control-'))).toBe(false);
      expect(r.text).not.toContain(SENTINELA_EMAIL);
      expect(r.text).not.toContain(TOKEN_VALIDO);
    }
  });
});

describe('rota condicionada e metodo', () => {
  it('sem opcao consume a rota nao existe (404)', async () => {
    const { porta } = await subir(true);
    expect((await postar(porta, JSON.stringify({ token: TOKEN_VALIDO }))).status).toBe(404);
  });

  it('GET na rota responde 404 e nao chama o handler', async () => {
    const { porta, repo } = await subir();
    const r = await pedir(porta, 'GET', CAMINHO, {});
    expect(r.status).toBe(404);
    expect(repo.calls).toBe(0);
  });
});
