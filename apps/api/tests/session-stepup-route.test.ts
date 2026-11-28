// H-014 | Rota POST /v1/auth/step-up/challenge via HTTP (52 §4.2, §4.3). Porta de pedido e despacho
// simulados; repositorio de sessao em memoria; servidor de loopback; fetch bloqueado. Sem banco, sem
// rede, sem e-mail. Valores sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-014');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SESSION_COOKIE_NAME, type AuthMethod, type SessionRecord, type SessionRepositoryPort } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import type { SessionRouteOptions, StepUpChallengeOutcome } from '../src/session-route.js';

const SITE = 'https://fastpro.example.test';
const SEGREDO = 'example-session-secret-0000000000000000000000';
const T0 = Date.UTC(2099, 0, 1, 12);

function repoCom(metodo: AuthMethod | null): SessionRepositoryPort {
  const sessao: SessionRecord | null =
    metodo === null
      ? null
      : { sessionId: '77777777-7777-4777-8777-777777777777', userId: '88888888-8888-4888-8888-888888888888', recentAuthAtMs: T0, authMethod: metodo };
  return {
    async authenticate(hash: string) {
      return hash === hashSessionSecret(SEGREDO) ? sessao : null;
    },
    async convertStage() {
      return null;
    },
    async revoke() {
      return false;
    },
    async revokeAll() {
      return 0;
    },
    async markRecentAuth() {
      return false;
    },
  } as unknown as SessionRepositoryPort;
}

interface Chamadas {
  pedidos: number;
  agendados: string[];
}

function opcoes(
  metodo: AuthMethod | null,
  resultado: StepUpChallengeOutcome,
  chamadas: Chamadas,
  comDesafio = true,
): SessionRouteOptions {
  return {
    repo: repoCom(metodo),
    siteUrl: SITE,
    clock: { nowMs: () => T0 },
    newSecret: () => 'example-new-secret-000000000000000000000000',
    ...(comDesafio
      ? {
          challenge: {
            port: {
              async request() {
                chamadas.pedidos += 1;
                return resultado;
              },
            },
            dispatch: {
              schedule(outboxId: string) {
                chamadas.agendados.push(outboxId);
              },
            },
          },
        }
      : {}),
  };
}

interface Resposta {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function enviar(
  porta: number,
  caminho: string,
  opts: { cookie?: boolean; origin?: string; corpo?: string; contentType?: string },
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {
    origin: opts.origin ?? SITE,
    'sec-fetch-site': 'same-origin',
    'content-type': opts.contentType ?? 'application/json',
  };
  if (opts.cookie !== false) cabecalhos.cookie = `${SESSION_COOKIE_NAME}=${SEGREDO}`;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: caminho, method: 'POST', headers: cabecalhos },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.corpo ?? '{}');
  });
}

async function servidor(opts: SessionRouteOptions): Promise<{ srv: Server; porta: number }> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, session: opts });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  return { srv, porta: (srv.address() as AddressInfo).port };
}

const CAMINHO = '/v1/auth/step-up/challenge';
const servidores: Server[] = [];
afterAll(() => {
  for (const s of servidores) s.close();
});

describe('POST /v1/auth/step-up/challenge (H-014)', () => {
  it('sessao por link: 202 sem o codigo e agenda o envio do desafio criado', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'criado', outboxId: 'saida-1' }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, {});
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ status: 'enviado' });
    expect(r.body).not.toMatch(/\d{6}/);
    expect(chamadas).toEqual({ pedidos: 1, agendados: ['saida-1'] });
  });

  it('sem cookie de sessao: 401 e nenhum pedido', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'criado', outboxId: 'x' }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, { cookie: false });
    expect(r.status).toBe(401);
    expect(chamadas.pedidos).toBe(0);
  });

  it('sessao por senha: 422 metodo_invalido (o codigo nao se aplica)', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('password', { resultado: 'criado', outboxId: 'x' }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, {});
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'metodo_invalido' });
    expect(chamadas.pedidos).toBe(0);
  });

  it('corpo que nao e {}: 422 pedido_invalido', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'criado', outboxId: 'x' }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, { corpo: '{"codigo":"123456"}' });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body)).toEqual({ code: 'pedido_invalido' });
  });

  it('limite de pedidos: 429 com Retry-After e nenhum envio agendado', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'espera', retryAfterSeconds: 30 }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, {});
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('30');
    expect(chamadas.agendados).toHaveLength(0);
  });

  it('conta negada no pedido: 401 e nenhum envio', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'negado', retryAfterSeconds: null }, chamadas));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, {});
    expect(r.status).toBe(401);
    expect(chamadas.agendados).toHaveLength(0);
  });

  it('sem a opcao challenge a rota nao existe (404)', async () => {
    const chamadas: Chamadas = { pedidos: 0, agendados: [] };
    const { srv, porta } = await servidor(opcoes('link', { resultado: 'criado', outboxId: 'x' }, chamadas, false));
    servidores.push(srv);
    const r = await enviar(porta, CAMINHO, {});
    expect(r.status).toBe(404);
    expect(chamadas.pedidos).toBe(0);
  });
});
