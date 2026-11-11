// H-116 (Issue 125) | Testes de injecao e abuso (docs/factory/65-REFINO-H116.md; T-10 de 11-ARQ-RISCOS-E-TESTES).
// Servidor de loopback; fetch global bloqueado; provedores e repositorios em memoria. Sem banco, sem rede,
// sem e-mail. Valores sinteticos (@example.test). Cada teste afirma resposta E efeito, nao so o texto da carga.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-116');
};

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SESSION_COOKIE_NAME, type SessionRecord, type SessionRepositoryPort } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { suggestAddress, type AddressSuggestDeps } from '../src/geo/address-suggest-service.js';
import type { DraftGatePort, GeocodingTempPort, RateLimitPort, QuotaPort } from '../src/geo/ports.js';

const SITE = 'https://fastpro.example.test';
const EXTERNO = 'https://evil.example.test';
const SEGREDO = 'example-session-secret-0000000000000000000000';
const T0 = Date.UTC(2099, 0, 1, 12);

// Cargas clássicas de SQL, XSS, caminho, SSRF e redirecionamento (somente texto de teste).
const CARGA_SQL = "' OR 1=1 --";
const CARGA_XSS = '<img src=x onerror=alert(1)>';
const CARGA_SSRF = 'http://169.254.169.254/latest/meta-data';
const CARGA_CAMINHO = '../../etc/passwd';

const SESSAO: SessionRecord = {
  sessionId: '77777777-7777-4777-8777-777777777777',
  userId: '88888888-8888-4888-8888-888888888888',
  recentAuthAtMs: T0,
  authMethod: 'otp',
} as unknown as SessionRecord;

function repoEspiao() {
  const revogacoes: string[] = [];
  const repo = {
    async authenticate() {
      return SESSAO;
    },
    async convertStage() {
      return null;
    },
    async revoke(id: string) {
      revogacoes.push(id);
      return true;
    },
    async revokeAll() {
      revogacoes.push('all');
      return 1;
    },
    async markRecentAuth() {
      return false;
    },
  } as unknown as SessionRepositoryPort;
  return { repo, revogacoes };
}

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

async function subir(opts: Parameters<typeof handleRequest>[2]): Promise<number> {
  const server = createServer((req, res) =>
    handleRequest(req, res, opts).catch(() => {
      res.statusCode = 500;
      res.end();
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

interface Resposta {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function chamar(
  porta: number,
  metodo: 'GET' | 'POST',
  caminho: string,
  cab: Record<string, string>,
  corpo = '{}',
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cab },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(metodo === 'POST' ? corpo : undefined);
  });
}

describe('T-10 CSRF: rotas que mudam estado recusam Origin de outro site', () => {
  for (const caminho of ['/v1/auth/logout', '/v1/auth/logout-all']) {
    it(`POST ${caminho} com Origin externo nao revoga nada`, async () => {
      const espia = repoEspiao();
      const porta = await subir({
        tickSecret: undefined,
        session: { repo: espia.repo, siteUrl: SITE, clock: { nowMs: () => T0 }, newSecret: () => 'x'.repeat(43) },
      });
      const r = await chamar(porta, 'POST', caminho, {
        origin: EXTERNO,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${SEGREDO}`,
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(espia.revogacoes).toEqual([]);
    });
  }
});

describe('T-10 redirecionamento aberto: nenhuma resposta manda o cliente para fora', () => {
  it('parametros de retorno com dominio externo nao geram cabecalho Location', async () => {
    const porta = await subir({ tickSecret: undefined });
    for (const caminho of [
      `/health?next=${EXTERNO}`,
      `/health?redirect=${encodeURIComponent(EXTERNO)}`,
      `/health?return_to=//evil.example.test`,
    ]) {
      const r = await chamar(porta, 'GET', caminho, {});
      expect(r.headers.location).toBeUndefined();
    }
  });
});

describe('T-10 SQL e XSS em texto livre: a carga e tratada como dado', () => {
  it('a busca de endereco recebe a carga sem alterar e a resposta e JSON, nao HTML', async () => {
    const suggest = vi.fn(async (_q: string) => ({ ok: true as const, features: [] }));
    const provider: GeocodingTempPort = { suggest };
    const deps: AddressSuggestDeps = {
      gate: { async check() { return { status: 'ok' as const, principal: 'rascunho-sintetico' }; } } as DraftGatePort,
      rate: { async check() { return { ok: true as const }; }, async hit() {} } as RateLimitPort,
      quota: { async take() { return { ok: true, novoAlerta: false, used: 1 }; } } as QuotaPort,
      provider,
      clock: { nowMs: () => T0 },
      onQuotaAlert: () => {},
    } as unknown as AddressSuggestDeps;

    for (const carga of [CARGA_SQL, CARGA_XSS, CARGA_SSRF, CARGA_CAMINHO]) {
      const out = await suggestAddress(
        { q: carga, context: 'request_draft', cookie: undefined, ip: '127.0.0.1' },
        deps,
      );
      expect(out.status).toBeLessThan(500);
      expect(JSON.stringify(out.body)).not.toContain('<script');
    }
    // A carga chega ao provedor exatamente como foi enviada (sem concatenacao de SQL ou de URL).
    expect(suggest.mock.calls.map((c) => c[0])).toEqual([CARGA_SQL, CARGA_XSS, CARGA_SSRF, CARGA_CAMINHO]);
  });
});

describe('T-10 upload e SSRF: superficies ainda nao existentes (registrado como nao aplicavel)', () => {
  it('nenhuma rota de upload de arquivo existe na API desta versao (404 sem corpo)', async () => {
    const porta = await subir({ tickSecret: undefined });
    const r = await chamar(porta, 'POST', '/v1/uploads', { 'content-type': 'multipart/form-data' });
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
  });
});
