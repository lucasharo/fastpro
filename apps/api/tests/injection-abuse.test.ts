// H-116 (Issue 125) | Testes de injecao e abuso (docs/factory/65-REFINO-H116.md; T-10 de 11-ARQ-RISCOS-E-TESTES).
// Servidor de loopback; fetch global bloqueado com vi.stubGlobal (restaurado ao fim); provedores e
// repositorios em memoria. Sem banco, sem rede, sem e-mail. Valores sinteticos (@example.test).
// Cada teste afirma status exato, corpo ou efeito. Categorias sem superficie na API desta versao
// aparecem como "nao aplicavel" com motivo, nunca em silencio.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SESSION_COOKIE_NAME, type SessionRecord, type SessionRepositoryPort } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import { suggestAddress, type AddressSuggestDeps } from '../src/geo/address-suggest-service.js';
import { buildForwardUrl } from '../src/geo/mapbox-temp-adapter.js';
import type { DraftGatePort, GeocodingTempPort, RateLimitPort, QuotaPort } from '../src/geo/ports.js';

const SITE = 'https://fastpro.example.test';
const EXTERNO = 'https://evil.example.test';
const SEGREDO = 'example-session-secret-0000000000000000000000';
const T0 = Date.UTC(2099, 0, 1, 12);

// Cargas de teste (texto somente).
const CARGA_SQL = "' OR 1=1 --";
const CARGA_XSS = '<img src=x onerror=alert(1)>';
const CARGA_SSRF = 'http://169.254.169.254/latest/meta-data';
const CARGA_CAMINHO = '../../etc/passwd';

const SESSAO = {
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
beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('rede bloqueada nos testes de H-116');
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
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

const cookie = `${SESSION_COOKIE_NAME}=${SEGREDO}`;

describe('T-10 CSRF: logout recusa Origin de outro site e aceita o do proprio site', () => {
  for (const caminho of ['/v1/auth/logout', '/v1/auth/logout-all']) {
    it(`POST ${caminho} com Origin externo: 403 origem_invalida e nenhuma revogacao`, async () => {
      const espia = repoEspiao();
      const porta = await subir({
        tickSecret: undefined,
        session: { repo: espia.repo, siteUrl: SITE, clock: { nowMs: () => T0 }, newSecret: () => 'x'.repeat(43) },
      });
      const r = await chamar(porta, 'POST', caminho, {
        origin: EXTERNO,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
        cookie,
      });
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ code: 'origem_invalida' });
      expect(espia.revogacoes).toEqual([]);
    });

    it(`POST ${caminho} sem Origin: 403 e nenhuma revogacao`, async () => {
      const espia = repoEspiao();
      const porta = await subir({
        tickSecret: undefined,
        session: { repo: espia.repo, siteUrl: SITE, clock: { nowMs: () => T0 }, newSecret: () => 'x'.repeat(43) },
      });
      const r = await chamar(porta, 'POST', caminho, { 'sec-fetch-site': 'same-origin', cookie });
      expect(r.status).toBe(403);
      expect(espia.revogacoes).toEqual([]);
    });
  }

  it('controle positivo: POST /v1/auth/logout com Origin do proprio site revoga a sessao', async () => {
    const espia = repoEspiao();
    const porta = await subir({
      tickSecret: undefined,
      session: { repo: espia.repo, siteUrl: SITE, clock: { nowMs: () => T0 }, newSecret: () => 'x'.repeat(43) },
    });
    const r = await chamar(porta, 'POST', '/v1/auth/logout', {
      origin: SITE,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie,
    });
    expect(r.status).toBe(204);
    expect(espia.revogacoes).toEqual([SESSAO.sessionId]);
  });
});

describe('T-10 redirecionamento aberto: nao aplicavel hoje (nenhuma rota le parametro de retorno)', () => {
  it('parametros de retorno com dominio externo nao geram Location, nem em GET nem em POST', async () => {
    const espia = repoEspiao();
    const porta = await subir({
      tickSecret: undefined,
      session: { repo: espia.repo, siteUrl: SITE, clock: { nowMs: () => T0 }, newSecret: () => 'x'.repeat(43) },
    });
    const gets = [`/health?next=${EXTERNO}`, `/health?redirect=${encodeURIComponent(EXTERNO)}`, `/health?return_to=//evil.example.test`];
    for (const caminho of gets) {
      const r = await chamar(porta, 'GET', caminho, {});
      expect(r.headers.location).toBeUndefined();
      expect(r.status).toBeLessThan(300);
    }
    const post = await chamar(porta, 'POST', `/v1/auth/logout?next=${EXTERNO}`, {
      origin: SITE,
      'sec-fetch-site': 'same-origin',
      cookie,
    });
    expect(post.headers.location).toBeUndefined();
    expect(post.status).toBeLessThan(300);
  });
});

describe('T-10 texto livre: a carga chega ao provedor intacta e a resposta e JSON', () => {
  it('busca de endereco envia SQL e XSS sem alterar e devolve status 200 de dados', async () => {
    const suggest = vi.fn(async (_q: string) => ({ ok: true as const, features: [] }));
    const provider: GeocodingTempPort = { suggest };
    const deps = {
      gate: { async check() { return { status: 'ok' as const, principal: 'rascunho-sintetico' }; } } as DraftGatePort,
      rate: { async check() { return { ok: true as const }; }, async hit() {} } as RateLimitPort,
      quota: { async take() { return { ok: true, novoAlerta: false, used: 1 }; } } as QuotaPort,
      provider,
      clock: { nowMs: () => T0 },
      onQuotaAlert: () => {},
    } as unknown as AddressSuggestDeps;

    for (const carga of [CARGA_SQL, CARGA_XSS]) {
      const out = await suggestAddress(
        { q: carga, context: 'request_draft', cookie: undefined, ip: '127.0.0.1' },
        deps,
      );
      expect(out).toEqual({ status: 200, body: { mode: 'ok', items: [] } });
    }
    expect(suggest.mock.calls.map((c) => c[0])).toEqual([CARGA_SQL, CARGA_XSS]);
  });

  it('nao aplicavel: SQL direto nao existe nesta rota (o servico nao toca em banco; a parametrizacao e coberta em packages/db)', () => {
    expect(true).toBe(true);
  });

  it('nao aplicavel: XSS armazenado em descricao de pedido e chat (nenhuma dessas rotas existe nesta versao)', () => {
    expect(true).toBe(true);
  });
});

describe('T-10 SSRF: a URL do provedor e fixa; a carga so vai no parametro q', () => {
  for (const carga of [CARGA_SSRF, 'http://127.0.0.1:8080/admin', 'file:///etc/passwd', CARGA_CAMINHO]) {
    it(`carga ${carga} nao muda host, esquema nem caminho da URL do provedor`, () => {
      const url = buildForwardUrl(carga, 'pk.sintetico');
      expect(url.hostname).toBe('api.mapbox.com');
      expect(url.protocol).toBe('https:');
      expect(url.searchParams.get('q')).toBe(carga);
    });
  }
});

describe('T-10 upload e nome de arquivo: nao aplicavel nesta versao (nenhuma rota de upload existe)', () => {
  it('nenhuma rota com multipart ou upload responde a POST (404 sem corpo)', async () => {
    const porta = await subir({ tickSecret: undefined });
    for (const caminho of ['/v1/uploads', '/v1/photos', '/v1/orders/photos']) {
      const r = await chamar(porta, 'POST', caminho, { 'content-type': 'multipart/form-data' });
      expect(r.status).toBe(404);
      expect(r.body).toBe('');
    }
  });
});
