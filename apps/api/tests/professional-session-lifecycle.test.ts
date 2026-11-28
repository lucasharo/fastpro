// H-016 | Sessao do profissional: expiracao de 7 dias absolutos sem prorrogacao (CA-H016-18) e sair / sair de
// todos na API (CA-H016-19). Servidor de loopback, fetch bloqueado, relogio injetado, repositorio em memoria.
// A regra real (SQL de private.app_session_get e revoke) e testada no banco por
// packages/db/tests/identity-professional-session.dbtest.mjs; aqui se testa o contrato da rota com um repositorio
// que segue a mesma regra. Segredos sinteticos. Sem banco e sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { SessionRecord, SessionRepositoryPort } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { handleSessionLogout, handleSessionLogoutAll, type SessionRouteOptions } from '../src/session-route.js';

const SITE = 'https://app.example.test';
const DIA = 24 * 60 * 60 * 1000;
const CRIADA_EM = Date.UTC(2099, 0, 1, 12);
const SEGREDO_A = 'segredo-sintetico-sessao-a-0123456789-abcdefghij';
const SEGREDO_B = 'segredo-sintetico-sessao-b-0123456789-abcdefghij';
const SEGREDO_C = 'segredo-sintetico-sessao-c-0123456789-abcdefghij';
const USUARIO_1 = 'profissional-sintetico-1';
const USUARIO_2 = 'profissional-sintetico-2';

interface Linha {
  readonly id: string;
  readonly userId: string;
  readonly hash: string;
  readonly fimMs: number;
  revogadoMs: number | null;
}

/** Repositorio em memoria com a mesma regra da guarda SQL: nao revogada, dentro dos 7 dias absolutos. */
class RepositorioEmMemoria implements SessionRepositoryPort {
  linhas: Linha[] = [];

  adicionar(userId: string, segredo: string, criadaEm: number): Linha {
    const linha: Linha = {
      id: randomUUID(),
      userId,
      hash: hashSessionSecret(segredo),
      fimMs: criadaEm + 7 * DIA,
      revogadoMs: null,
    };
    this.linhas.push(linha);
    return linha;
  }

  async authenticate(hash: string, nowMs: number): Promise<SessionRecord | null> {
    const linha = this.linhas.find((l) => l.hash === hash);
    if (!linha || linha.revogadoMs !== null || !(nowMs < linha.fimMs)) return null;
    return { sessionId: linha.id, userId: linha.userId, recentAuthAtMs: nowMs, authMethod: 'password' };
  }

  async revoke(sessionId: string, nowMs: number): Promise<boolean> {
    const linha = this.linhas.find((l) => l.id === sessionId);
    if (!linha || linha.revogadoMs !== null) return false;
    linha.revogadoMs = nowMs;
    return true;
  }

  async revokeAll(userId: string, nowMs: number): Promise<number> {
    let n = 0;
    for (const l of this.linhas) {
      if (l.userId === userId && l.revogadoMs === null) {
        l.revogadoMs = nowMs;
        n += 1;
      }
    }
    return n;
  }

  async convertStage(): Promise<null> {
    return null;
  }

  async markRecentAuth(): Promise<boolean> {
    return false;
  }
}

let agora = CRIADA_EM;
let repo: RepositorioEmMemoria;
const servidores: Server[] = [];
afterAll(() => servidores.forEach((s) => s.close()));

beforeEach(() => {
  agora = CRIADA_EM;
  repo = new RepositorioEmMemoria();
});

async function subir(rota: 'logout' | 'logout-all'): Promise<number> {
  const opts: SessionRouteOptions = {
    repo,
    siteUrl: SITE,
    clock: { nowMs: () => agora },
    newSecret: () => 'n'.repeat(43),
  };
  const server = createServer((req, res) =>
    rota === 'logout' ? handleSessionLogout(req, res, opts) : handleSessionLogoutAll(req, res, opts),
  );
  servidores.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return (server.address() as AddressInfo).port;
}

function post(
  port: number,
  path: string,
  segredo: string | null,
  origem: string = SITE,
): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Origin: origem, 'Sec-Fetch-Site': 'same-origin' };
    if (segredo !== null) headers.cookie = `__Host-fp_sess=${segredo}`;
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('expiracao da sessao do profissional (CA-H016-18): 7 dias absolutos, sem prorrogacao', () => {
  it('dentro dos 7 dias a sessao vale (204 no 6o dia)', async () => {
    repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout-all');
    agora = CRIADA_EM + 6 * DIA;
    expect((await post(port, '/v1/auth/logout-all', SEGREDO_A)).status).toBe(204);
  });

  it('o uso no 6o dia nao prorroga: no 7o dia a mesma sessao ja e recusada (401)', async () => {
    const linha = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout-all');
    agora = CRIADA_EM + 6 * DIA;
    await repo.authenticate(hashSessionSecret(SEGREDO_A), agora);
    expect(linha.fimMs).toBe(CRIADA_EM + 7 * DIA);
    agora = CRIADA_EM + 7 * DIA;
    expect((await post(port, '/v1/auth/logout-all', SEGREDO_A)).status).toBe(401);
  });

  it('sessao vencida nao revoga nem altera nada: o logout-all responde 401 sem tocar nas linhas', async () => {
    const linha = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout-all');
    agora = CRIADA_EM + 8 * DIA;
    expect((await post(port, '/v1/auth/logout-all', SEGREDO_A)).status).toBe(401);
    expect(linha.revogadoMs).toBeNull();
  });
});

describe('sair e sair de todos na API do profissional (CA-H016-19)', () => {
  it('sair revoga so a sessao atual e apaga o cookie; a outra sessao da mesma pessoa segue valida', async () => {
    const atual = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const outra = repo.adicionar(USUARIO_1, SEGREDO_B, CRIADA_EM);
    const port = await subir('logout');
    const r = await post(port, '/v1/auth/logout', SEGREDO_A);
    expect(r.status).toBe(204);
    expect(String(r.headers['set-cookie'])).toContain('__Host-fp_sess=');
    expect(atual.revogadoMs).toBe(CRIADA_EM);
    expect(outra.revogadoMs).toBeNull();
    expect(await repo.authenticate(hashSessionSecret(SEGREDO_B), agora)).not.toBeNull();
  });

  it('sair de todos revoga todas as sessoes da pessoa e nenhuma de outra pessoa', async () => {
    const a = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const b = repo.adicionar(USUARIO_1, SEGREDO_B, CRIADA_EM);
    const alheia = repo.adicionar(USUARIO_2, SEGREDO_C, CRIADA_EM);
    const port = await subir('logout-all');
    expect((await post(port, '/v1/auth/logout-all', SEGREDO_A)).status).toBe(204);
    expect(a.revogadoMs).not.toBeNull();
    expect(b.revogadoMs).not.toBeNull();
    expect(alheia.revogadoMs).toBeNull();
  });

  it('sair de todos sem sessao valida responde 401 e nao revoga nada', async () => {
    const a = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout-all');
    expect((await post(port, '/v1/auth/logout-all', null)).status).toBe(401);
    expect(a.revogadoMs).toBeNull();
  });

  it('origem que nao e a do site e recusada (403) e nada e revogado', async () => {
    const a = repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout');
    expect((await post(port, '/v1/auth/logout', SEGREDO_A, 'https://outro.example.test')).status).toBe(403);
    expect(a.revogadoMs).toBeNull();
  });

  it('sair e idempotente: repetir com a mesma sessao responde 204 sem erro', async () => {
    repo.adicionar(USUARIO_1, SEGREDO_A, CRIADA_EM);
    const port = await subir('logout');
    expect((await post(port, '/v1/auth/logout', SEGREDO_A)).status).toBe(204);
    expect((await post(port, '/v1/auth/logout', SEGREDO_A)).status).toBe(204);
  });
});
