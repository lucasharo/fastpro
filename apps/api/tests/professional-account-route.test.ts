// H-016 | GET /v1/professional/me com porta em memoria (CA-H016-10, CA-H016-21). Servidor de loopback,
// fetch bloqueado, relogio injetado. Segredo e e-mail sinteticos. Sem banco, sem rede, sem e-mail.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleProfessionalMe, type ProfessionalAccountPort } from '../src/professional-account-route.js';

const SEGREDO_OK = 'segredo-sintetico-de-sessao-com-tamanho-suficiente';
const EMAIL = 'pessoa.sintetica@example.test';

function porta(estado: { emailVerified: boolean; status: 'pendente' | 'aprovada' } | 'erro'): ProfessionalAccountPort {
  return {
    async me(secret) {
      if (estado === 'erro') throw new Error('falha de infraestrutura');
      return secret === SEGREDO_OK ? estado : null;
    },
  };
}

async function servidor(p: ProfessionalAccountPort): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) =>
    handleProfessionalMe(req, res, { port: p, clock: { nowMs: () => Date.UTC(2099, 0, 1) } }),
  );
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return { server, port: (server.address() as AddressInfo).port };
}

function get(port: number, cookie?: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/v1/professional/me', method: 'GET',
      headers: cookie ? { cookie } : {} }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const servidores: Server[] = [];
afterAll(() => servidores.forEach((s) => s.close()));

describe('GET /v1/professional/me', () => {
  it('sem cookie: 401 nao_autenticado', async () => {
    const { server, port } = await servidor(porta({ emailVerified: true, status: 'pendente' }));
    servidores.push(server);
    const r = await get(port);
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ code: 'nao_autenticado' });
  });

  it('cookie que nao corresponde a sessao viva: 401, sem dizer o motivo', async () => {
    const { server, port } = await servidor(porta({ emailVerified: true, status: 'pendente' }));
    servidores.push(server);
    const r = await get(port, '__Host-fp_sess=outro-segredo');
    expect(r.status).toBe(401);
  });

  it('conta nova verificada e pendente: 200 com explicacao sem prazo (CA-H016-21)', async () => {
    const { server, port } = await servidor(porta({ emailVerified: true, status: 'pendente' }));
    servidores.push(server);
    const r = await get(port, `__Host-fp_sess=${SEGREDO_OK}`);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      access_level: 'full',
      email_verified: true,
      verification: { status: 'pendente', explanation_code: 'human_review_no_deadline' },
    });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('e-mail nao verificado: 200 com nivel so de verificacao (CA-H016-13)', async () => {
    const { server, port } = await servidor(porta({ emailVerified: false, status: 'pendente' }));
    servidores.push(server);
    const r = await get(port, `__Host-fp_sess=${SEGREDO_OK}`);
    expect(JSON.parse(r.body).access_level).toBe('verification_only');
  });

  it('a resposta nunca traz o e-mail nem o segredo (CA-H016-04 e P8)', async () => {
    const { server, port } = await servidor(porta({ emailVerified: true, status: 'pendente' }));
    servidores.push(server);
    const r = await get(port, `__Host-fp_sess=${SEGREDO_OK}`);
    expect(r.body).not.toContain(EMAIL);
    expect(r.body).not.toContain(SEGREDO_OK);
  });

  it('falha de infraestrutura: 503 sem detalhe', async () => {
    const { server, port } = await servidor(porta('erro'));
    servidores.push(server);
    const r = await get(port, `__Host-fp_sess=${SEGREDO_OK}`);
    expect(r.status).toBe(503);
    expect(r.body).not.toContain('falha de infraestrutura');
  });
});
