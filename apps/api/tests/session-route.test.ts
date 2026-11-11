// H-014 | Rotas da sessao via HTTP (T-H014-06 no HTTP, T-H014-07, T-H014-10 nas respostas, e a
// guarda de step-up; 52 §1 a §4). Repositorio em memoria com as mesmas regras do SQL; servidor de
// loopback; fetch bloqueado. Sem banco, sem rede, sem e-mail. Valores sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-014');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  STEP_UP_WINDOW_SECONDS,
  type AuthMethod,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import type { SessionRouteOptions, StepUpProofPort } from '../src/session-route.js';

const SITE = 'https://fastpro.example.test';
const DIA = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = Date.UTC(2099, 0, 1, 12);

interface Linha {
  id: string;
  userId: string;
  hash: string;
  stage: 'identificacao' | 'ativa';
  expiresAt: number;
  absoluteExpiresAt: number;
  recentAuthAt: number | null;
  authMethod: AuthMethod;
  revokedAt: number | null;
  userActive: boolean;
}

/** Repositorio em memoria com as mesmas regras de private.app_session_* (52 §1.2, §2, §3). */
class RepoMemoria implements SessionRepositoryPort {
  readonly linhas: Linha[] = [];
  revogacoes = 0;

  private ativa(l: Linha, now: number): boolean {
    return (
      l.stage === 'ativa' &&
      l.revokedAt === null &&
      l.expiresAt > now &&
      l.absoluteExpiresAt > now &&
      l.userActive
    );
  }

  add(l: Omit<Linha, 'id'>): Linha {
    const linha = { ...l, id: randomUUID() };
    this.linhas.push(linha);
    return linha;
  }

  async convertStage(oldHash: string, newHash: string, nowMs: number) {
    const l = this.linhas.find(
      (x) =>
        x.hash === oldHash &&
        x.stage === 'identificacao' &&
        x.revokedAt === null &&
        x.expiresAt > nowMs &&
        x.userActive,
    );
    if (!l) return null;
    l.stage = 'ativa';
    l.hash = newHash;
    l.expiresAt = l.absoluteExpiresAt;
    l.recentAuthAt = nowMs;
    l.authMethod = 'link';
    return { sessionId: l.id, userId: l.userId, absoluteExpiresAtMs: l.absoluteExpiresAt };
  }

  async authenticate(hash: string, nowMs: number): Promise<SessionRecord | null> {
    const l = this.linhas.find((x) => x.hash === hash && this.ativa(x, nowMs));
    if (!l) return null;
    return {
      sessionId: l.id,
      userId: l.userId,
      recentAuthAtMs: l.recentAuthAt,
      authMethod: l.authMethod,
    };
  }

  async revoke(sessionId: string, nowMs: number): Promise<boolean> {
    const l = this.linhas.find((x) => x.id === sessionId && x.stage === 'ativa');
    if (!l) return false;
    l.revokedAt = l.revokedAt ?? nowMs;
    this.revogacoes += 1;
    return true;
  }

  async revokeAll(userId: string, nowMs: number): Promise<number> {
    let n = 0;
    for (const l of this.linhas) {
      if (l.userId === userId && l.revokedAt === null) {
        l.revokedAt = nowMs;
        n += 1;
      }
    }
    this.revogacoes += n;
    return n;
  }

  async markRecentAuth(sessionId: string, nowMs: number): Promise<boolean> {
    const l = this.linhas.find((x) => x.id === sessionId);
    if (!l || !this.ativa(l, nowMs)) return false;
    l.recentAuthAt = Math.max(l.recentAuthAt ?? nowMs, nowMs);
    return true;
  }
}

interface Resposta {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const servidores: Server[] = [];
afterAll(async () => {
  for (const s of servidores) await new Promise<void>((r) => s.close(() => r()));
});

function servidor(opts: SessionRouteOptions): Promise<string> {
  const srv = createServer((req, res) => {
    void handleRequest(req, res, { tickSecret: undefined, session: opts });
  });
  servidores.push(srv);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function pedir(
  base: string,
  metodo: string,
  caminho: string,
  opcoes: { headers?: Record<string, string>; corpo?: string } = {},
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const u = new URL(base + caminho);
    const corpo = opcoes.corpo ?? '';
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: metodo,
        headers: {
          Origin: SITE,
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
          ...(opcoes.headers ?? {}),
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(partes).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

const cookie = (nome: string, valor: string) => `${nome}=${valor}`;
const setCookies = (r: Resposta): string[] => {
  const v = r.headers['set-cookie'];
  return Array.isArray(v) ? v : v ? [v] : [];
};

/** Monta o cenario com um usuario, uma etapa (cookie fp_ident) e os segredos conhecidos do teste. */
function cenario(repo: RepoMemoria, segredoEtapa = 'E'.repeat(43)) {
  const userId = randomUUID();
  const etapa = repo.add({
    userId,
    hash: hashSessionSecret(segredoEtapa),
    stage: 'identificacao',
    expiresAt: T0 + 15 * MIN,
    absoluteExpiresAt: T0 + 7 * DIA,
    recentAuthAt: null,
    authMethod: 'link',
    revokedAt: null,
    userActive: true,
  });
  return { userId, etapa, segredoEtapa };
}

let contador = 0;
function opcoes(repo: RepoMemoria, proof?: StepUpProofPort): SessionRouteOptions {
  return {
    repo,
    siteUrl: SITE,
    clock: { nowMs: () => T0 },
    newSecret: () => `n${String(contador++).padStart(42, '0')}`,
    proof,
  };
}

describe('T-H014-06 (HTTP) conversao: 200 com dois Set-Cookie; negacoes iguais e sem cookie', () => {
  it('etapa valida: 200, sessao de 7 dias (Max-Age 604800, Lax), etapa apagada', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor(opcoes(repo));
    const r = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) },
    });
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"status":"autenticado"}');
    const [sess, ident] = setCookies(r);
    expect(sess).toMatch(/^__Host-fp_sess=n\d+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/);
    expect(ident).toBe('__Host-fp_ident=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('sem cookie, desconhecido, ja convertido e vencido: mesma resposta byte a byte e sem Set-Cookie', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor(opcoes(repo));
    const h = { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) };
    const ok = await pedir(base, 'POST', '/v1/auth/session', { corpo: '{}', headers: h });
    expect(ok.status).toBe(200);

    const sem = await pedir(base, 'POST', '/v1/auth/session', { corpo: '{}' });
    const desconhecido = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', 'X'.repeat(43)) },
    });
    const ja = await pedir(base, 'POST', '/v1/auth/session', { corpo: '{}', headers: h });

    for (const r of [sem, desconhecido, ja]) {
      expect(r.status).toBe(401);
      expect(r.body).toBe('{"code":"acesso_expirado"}');
      expect(setCookies(r)).toEqual([]);
    }
  });

  it('vencida no instante exato: negada (relogio no limite)', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor({
      ...opcoes(repo),
      clock: { nowMs: () => T0 + 15 * MIN },
    });
    const r = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) },
    });
    expect(r.status).toBe(401);
    expect(setCookies(r)).toEqual([]);
  });

  it('origem errada e corpo com chaves: recusa antes de qualquer conversao', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor(opcoes(repo));
    const h = { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) };
    const origem = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { ...h, Origin: 'https://outro.example.test' },
    });
    expect(origem.status).toBe(403);
    const corpo = await pedir(base, 'POST', '/v1/auth/session', { corpo: '{"x":1}', headers: h });
    expect(corpo.status).toBe(422);
    expect(repo.linhas[0]?.stage).toBe('identificacao');
  });
});

describe('T-H014-06 (HTTP) sair e sair de todos; guarda de sessao lida do banco', () => {
  it('sair revoga so a sessao atual: 204, cookie apagado; o mesmo cookie depois da 401', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor(opcoes(repo));
    const conv = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) },
    });
    const segredoSessao = /__Host-fp_sess=([^;]+)/.exec(setCookies(conv)[0] ?? '')?.[1] ?? '';
    expect(segredoSessao).not.toBe('');

    const sair = await pedir(base, 'POST', '/v1/auth/logout', {
      headers: { Cookie: cookie('__Host-fp_sess', segredoSessao) },
    });
    expect(sair.status).toBe(204);
    expect(setCookies(sair)).toEqual([
      '__Host-fp_sess=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    ]);

    const depois = await pedir(base, 'POST', '/v1/auth/logout-all', {
      headers: { Cookie: cookie('__Host-fp_sess', segredoSessao) },
    });
    expect(depois.status).toBe(401);
    expect(depois.body).toBe('{"code":"nao_autenticado"}');
  });

  it('sair com cookie invalido ou ausente: 204 e cookie apagado (sem oraculo)', async () => {
    const repo = new RepoMemoria();
    const base = await servidor(opcoes(repo));
    const a = await pedir(base, 'POST', '/v1/auth/logout', {
      headers: { Cookie: cookie('__Host-fp_sess', 'Z'.repeat(43)) },
    });
    const b = await pedir(base, 'POST', '/v1/auth/logout');
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
    expect(setCookies(a)).toEqual(setCookies(b));
  });

  it('o cookie da etapa (fp_ident) nunca autentica o logout-all (CA-H014-06)', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo);
    const base = await servidor(opcoes(repo));
    const r = await pedir(base, 'POST', '/v1/auth/logout-all', {
      headers: { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) },
    });
    expect(r.status).toBe(401);
    expect(repo.revogacoes).toBe(0);
  });

  it('sair de todos revoga as tres sessoes da pessoa, inclusive a atual', async () => {
    const repo = new RepoMemoria();
    const userId = randomUUID();
    const segs = ['A', 'B', 'C'].map((x) => x.repeat(43));
    for (const s of segs) {
      repo.add({
        userId,
        hash: hashSessionSecret(s),
        stage: 'ativa',
        expiresAt: T0 + 7 * DIA,
        absoluteExpiresAt: T0 + 7 * DIA,
        recentAuthAt: T0,
        authMethod: 'link',
        revokedAt: null,
        userActive: true,
      });
    }
    const base = await servidor(opcoes(repo));
    const r = await pedir(base, 'POST', '/v1/auth/logout-all', {
      headers: { Cookie: cookie('__Host-fp_sess', segs[0] as string) },
    });
    expect(r.status).toBe(204);
    expect(repo.linhas.every((l) => l.revokedAt !== null)).toBe(true);
    const de = await pedir(base, 'POST', '/v1/auth/logout-all', {
      headers: { Cookie: cookie('__Host-fp_sess', segs[1] as string) },
    });
    expect(de.status).toBe(401);
  });
});

describe('T-H014-07 novo acesso por link nao revoga a sessao anterior', () => {
  it('a sessao antiga continua valida depois de uma nova etapa convertida para a mesma pessoa', async () => {
    const repo = new RepoMemoria();
    const c = cenario(repo, 'E'.repeat(43));
    // A porta so e chamada depois que a guarda aceita a sessao: registra o sid que passou.
    const aprovadas: string[] = [];
    const proof: StepUpProofPort = {
      verify: async (sessao) => {
        aprovadas.push(sessao.sessionId);
        return { ok: true };
      },
    };
    const base = await servidor(opcoes(repo, proof));
    const conv1 = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', c.segredoEtapa) },
    });
    expect(conv1.status).toBe(200);
    const sess1 = /__Host-fp_sess=([^;]+)/.exec(setCookies(conv1)[0] ?? '')?.[1] ?? '';
    const antiga = repo.linhas[0];

    const segundaEtapa = 'F'.repeat(43);
    repo.add({
      userId: c.userId,
      hash: hashSessionSecret(segundaEtapa),
      stage: 'identificacao',
      expiresAt: T0 + 15 * MIN,
      absoluteExpiresAt: T0 + 7 * DIA,
      recentAuthAt: null,
      authMethod: 'link',
      revokedAt: null,
      userActive: true,
    });
    const conv2 = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', segundaEtapa) },
    });
    expect(conv2.status).toBe(200);
    const sess2 = /__Host-fp_sess=([^;]+)/.exec(setCookies(conv2)[0] ?? '')?.[1] ?? '';
    expect(sess2).not.toBe(sess1);

    // Guarda de recurso (step-up com prova aceita): a sessao antiga passa e recebe 204.
    const ainda = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"123456"}',
      headers: { Cookie: cookie('__Host-fp_sess', sess1) },
    });
    expect(ainda.status).toBe(204);
    expect(aprovadas).toEqual([antiga?.id]);

    const nova = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"123456"}',
      headers: { Cookie: cookie('__Host-fp_sess', sess2) },
    });
    expect(nova.status).toBe(204);

    // Nenhuma revogacao: as duas linhas seguem ativas e sem revoked_at.
    expect(antiga?.stage).toBe('ativa');
    expect(antiga?.revokedAt).toBeNull();
    expect(repo.linhas.filter((l) => l.stage === 'ativa')).toHaveLength(2);
    expect(repo.linhas.every((l) => l.revokedAt === null)).toBe(true);
    expect(repo.revogacoes).toBe(0);
  });
});

describe('T-H014-04 atividade comum nao renova a janela de 30 min (repositorio em memoria)', () => {
  it('leituras pela guarda nao alteram recent_auth_at nem expires_at', async () => {
    const repo = new RepoMemoria();
    const seg = 'W'.repeat(43);
    const linha = repo.add({
      userId: randomUUID(),
      hash: hashSessionSecret(seg),
      stage: 'ativa',
      expiresAt: T0 + 7 * DIA,
      absoluteExpiresAt: T0 + 7 * DIA,
      recentAuthAt: T0,
      authMethod: 'link',
      revokedAt: null,
      userActive: true,
    });
    for (const t of [T0 + 5 * MIN, T0 + 20 * MIN, T0 + 30 * MIN]) {
      const s = await repo.authenticate(hashSessionSecret(seg), t);
      expect(s?.recentAuthAtMs).toBe(T0);
    }
    expect(linha.recentAuthAt).toBe(T0);
    expect(linha.expiresAt).toBe(T0 + 7 * DIA);
    expect(repo.revogacoes).toBe(0);
  });
});

describe('step-up: contrato unico, metodo da sessao e guarda', () => {
  it('sem sessao: 401 nao_autenticado; metodo de outro tipo: 422 metodo_invalido; corpo ruim: 422', async () => {
    const repo = new RepoMemoria();
    const userId = randomUUID();
    const seg = 'P'.repeat(43);
    repo.add({
      userId,
      hash: hashSessionSecret(seg),
      stage: 'ativa',
      expiresAt: T0 + 7 * DIA,
      absoluteExpiresAt: T0 + 7 * DIA,
      recentAuthAt: T0,
      authMethod: 'link',
      revokedAt: null,
      userActive: true,
    });
    const proof: StepUpProofPort = { verify: async () => ({ ok: true }) };
    const base = await servidor(opcoes(repo, proof));

    const semSessao = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"123456"}',
    });
    expect(semSessao.status).toBe(401);
    expect(semSessao.body).toBe('{"code":"nao_autenticado"}');

    const metodo = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"password","password":"x"}',
      headers: { Cookie: cookie('__Host-fp_sess', seg) },
    });
    expect(metodo.status).toBe(422);
    expect(metodo.body).toBe('{"code":"metodo_invalido"}');

    const ruim = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"12"}',
      headers: { Cookie: cookie('__Host-fp_sess', seg) },
    });
    expect(ruim.status).toBe(422);
  });

  it('prova aceita: 204 e recent_auth_at avanca; sem porta, a rota nao existe (404)', async () => {
    const repo = new RepoMemoria();
    const userId = randomUUID();
    const seg = 'Q'.repeat(43);
    const linha = repo.add({
      userId,
      hash: hashSessionSecret(seg),
      stage: 'ativa',
      expiresAt: T0 + 7 * DIA,
      absoluteExpiresAt: T0 + 7 * DIA,
      recentAuthAt: T0 - 60 * MIN,
      authMethod: 'link',
      revokedAt: null,
      userActive: true,
    });
    const proof: StepUpProofPort = { verify: async () => ({ ok: true }) };
    const base = await servidor(opcoes(repo, proof));
    const r = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"123456"}',
      headers: { Cookie: cookie('__Host-fp_sess', seg) },
    });
    expect(r.status).toBe(204);
    expect(linha.recentAuthAt).toBe(T0);
    expect(linha.expiresAt).toBe(T0 + 7 * DIA);

    const semPorta = await servidor(opcoes(repo));
    const n = await pedir(semPorta, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"123456"}',
      headers: { Cookie: cookie('__Host-fp_sess', seg) },
    });
    expect(n.status).toBe(404);
  });

  it('prova recusada: o status e o codigo da porta; nada e alterado', async () => {
    const repo = new RepoMemoria();
    const seg = 'R'.repeat(43);
    const linha = repo.add({
      userId: randomUUID(),
      hash: hashSessionSecret(seg),
      stage: 'ativa',
      expiresAt: T0 + 7 * DIA,
      absoluteExpiresAt: T0 + 7 * DIA,
      recentAuthAt: T0 - 60 * MIN,
      authMethod: 'link',
      revokedAt: null,
      userActive: true,
    });
    const proof: StepUpProofPort = {
      verify: async () => ({ ok: false, status: 422, code: 'codigo_invalido' }),
    };
    const base = await servidor(opcoes(repo, proof));
    const r = await pedir(base, 'POST', '/v1/auth/step-up', {
      corpo: '{"method":"code","code":"000000"}',
      headers: { Cookie: cookie('__Host-fp_sess', seg) },
    });
    expect(r.status).toBe(422);
    expect(r.body).toBe('{"code":"codigo_invalido"}');
    expect(linha.recentAuthAt).toBe(T0 - 60 * MIN);
    expect(STEP_UP_WINDOW_SECONDS).toBe(1800);
  });
});

describe('T-H014-10 respostas nao carregam segredo, hash nem cookie', () => {
  it('nenhuma resposta da conversao, saida e step-up expoe o segredo ou o hash', async () => {
    const repo = new RepoMemoria();
    const segEtapa = 'V'.repeat(43);
    const c = cenario(repo, segEtapa);
    const base = await servidor(opcoes(repo));
    const conv = await pedir(base, 'POST', '/v1/auth/session', {
      corpo: '{}',
      headers: { Cookie: cookie('__Host-fp_ident', segEtapa) },
    });
    const segSessao = /__Host-fp_sess=([^;]+)/.exec(setCookies(conv)[0] ?? '')?.[1] ?? '';
    const todas = [
      conv,
      await pedir(base, 'POST', '/v1/auth/logout', {
        headers: { Cookie: cookie('__Host-fp_sess', segSessao) },
      }),
    ];
    // O Set-Cookie carrega o segredo da sessao de proposito (e o cookie entregue ao navegador); por
    // isso a varredura cobre corpo e demais cabecalhos, e o Set-Cookie so pode ter o segredo da sessao.
    for (const r of todas) {
      const demais: Record<string, unknown> = { ...r.headers };
      delete demais['set-cookie'];
      const texto = JSON.stringify(demais) + r.body;
      for (const p of [segEtapa, hashSessionSecret(segEtapa), hashSessionSecret(segSessao), c.userId]) {
        expect(texto.includes(p)).toBe(false);
      }
      for (const cookieLinha of setCookies(r)) {
        expect(cookieLinha.includes(segEtapa)).toBe(false);
        expect(cookieLinha.includes(hashSessionSecret(segSessao))).toBe(false);
      }
    }
  });
});
