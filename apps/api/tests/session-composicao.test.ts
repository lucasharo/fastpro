// Issue 156 (F5b) | Montagem da sessao na funcao: sem variaveis a rota nao existe; com variaveis, POST
// /v1/auth/session responde 401 (acesso expirado, sem cookie de etapa), nunca 404, e sem Set-Cookie.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import { montarSessao, novoSegredoSessao } from '../src/session-composicao.js';

const SITE = 'http://127.0.0.1:3000';
const clienteFalso: SqlClient = { query: async () => ({ rows: [] }) };
const servers: Server[] = [];

async function start(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<string> {
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('montagem da sessao (Issue 156, F5b)', () => {
  it('sem DATABASE_URL_APP_SYSTEM ou SITE_URL, nao monta (undefined)', () => {
    expect(montarSessao({ SITE_URL: SITE }, { abrirCliente: () => clienteFalso })).toBeUndefined();
    expect(montarSessao({ DATABASE_URL_APP_SYSTEM: 'sintetica' }, { abrirCliente: () => clienteFalso })).toBeUndefined();
  });

  it('com as duas variaveis, monta as opcoes com segredo de 43 caracteres em base64url', () => {
    const opcoes = montarSessao(
      { DATABASE_URL_APP_SYSTEM: 'sintetica', SITE_URL: SITE },
      { abrirCliente: () => clienteFalso },
    );
    expect(opcoes).toBeDefined();
    expect(opcoes?.siteUrl).toBe(SITE);
    expect(novoSegredoSessao()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('POST /v1/auth/session com Origin e corpo {} responde 401 e sem Set-Cookie (nao 404)', async () => {
    const opcoes = montarSessao(
      { DATABASE_URL_APP_SYSTEM: 'sintetica', SITE_URL: SITE },
      { abrirCliente: () => clienteFalso },
    );
    if (opcoes === undefined) throw new Error('sessao_nao_montada');
    const base = await start((req, res) => handleRequest(req, res, { session: opcoes }));
    const res = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',
      headers: { Origin: SITE, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
