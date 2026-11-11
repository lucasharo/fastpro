// H-009 | Testes locais (sem Vercel): healthcheck, tick protegido (CA-08), limite de corpo (CA-07
// local), mesma origem (CA-09 local) e configuracao de exemplo. Dados sinteticos (CA-15).
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_BODY_LIMIT_BYTES, handleRequest, readBodyBytes, routePath } from '../src/app.js';

const SECRET = 'segredo-sintetico-'.padEnd(40, 'x');
const SHORT_SECRET = 'curto';
const TICK = '/internal/jobs/tick';
const MB = 1024 * 1024;

const servers: Server[] = [];

async function start(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<string> {
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

async function startApp(tickSecret: string | undefined): Promise<string> {
  return start((req, res) => handleRequest(req, res, { tickSecret }));
}

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('healthcheck (CA-08)', () => {
  it('GET /health responde 200 sem cache', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/health (mesma origem) responde 200', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
  });

  it('metodo errado ou rota desconhecida responde 404 sem corpo', async () => {
    const base = await startApp(SECRET);
    const post = await fetch(`${base}/health`, { method: 'POST' });
    expect(post.status).toBe(404);
    const unknown = await fetch(`${base}/nao-existe`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe('');
  });
});

describe('tick protegido (CA-08)', () => {
  it('sem segredo responde 401', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}${TICK}`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('segredo errado responde 401', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: 'Bearer errado' },
    });
    expect(res.status).toBe(401);
  });

  it('cabecalho que nao e Bearer responde 401', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: `Basic ${SECRET}` },
    });
    expect(res.status).toBe(401);
  });

  it('com o segredo correto responde 200', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('com o segredo correto pelo caminho /api responde 200', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}/api${TICK}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
  });

  it('segredo do ambiente com menos de 32 caracteres fica fechado (401)', async () => {
    const base = await startApp(SHORT_SECRET);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SHORT_SECRET}` },
    });
    expect(res.status).toBe(401);
  });

  it('segredo do ambiente ausente fica fechado (401)', async () => {
    const base = await startApp(undefined);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(401);
  });

  it('corpo de 1024 bytes e aceito e 1025 bytes recebe 413 (limite do tick)', async () => {
    const base = await startApp(SECRET);
    const headers = { authorization: `Bearer ${SECRET}` };
    const ok = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers,
      body: Buffer.alloc(1024, 0x61),
    });
    expect(ok.status).toBe(200);
    const tooBig = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers,
      body: Buffer.alloc(1025, 0x61),
    });
    expect(tooBig.status).toBe(413);
  });

  it('corpo acima de 4 MB com segredo correto responde 413', async () => {
    const base = await startApp(SECRET);
    const res = await fetch(`${base}${TICK}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      body: Buffer.alloc(APP_BODY_LIMIT_BYTES + 1, 0x61),
    });
    expect(res.status).toBe(413);
  });
});

describe('limite de corpo da aplicacao (CA-07, parte local)', () => {
  async function startReader(limit: number): Promise<string> {
    return start(async (req, res) => {
      const { bytes, overflow } = await readBodyBytes(req, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bytes, overflow }));
    });
  }

  it('4,0 MB exatos nao estouram; 4,0 MB + 1 byte e 4,5 MB estouram', async () => {
    const base = await startReader(APP_BODY_LIMIT_BYTES);
    const send = async (size: number) => {
      const res = await fetch(base, { method: 'POST', body: Buffer.alloc(size, 0x61) });
      return (await res.json()) as { bytes: number; overflow: boolean };
    };
    expect(APP_BODY_LIMIT_BYTES).toBe(4 * MB);
    const exact = await send(4 * MB);
    expect(exact).toEqual({ bytes: 4 * MB, overflow: false });
    const plusOne = await send(4 * MB + 1);
    expect(plusOne.overflow).toBe(true);
    const fourHalf = await send(Math.round(4.5 * MB));
    expect(fourHalf.overflow).toBe(true);
  });
});

describe('mesma origem e configuracao de exemplo (CA-09 e CA-06, parte local)', () => {
  it('routePath tira o prefixo /api e mantem as demais rotas', () => {
    expect(routePath('/api/health')).toBe('/health');
    expect(routePath('/api')).toBe('/');
    expect(routePath('/health?x=1')).toBe('/health');
    expect(routePath('/apix/health')).toBe('/apix/health');
    expect(routePath(undefined)).toBe('/');
  });

  it('web de exemplo define nosniff e nao libera origem cruzada (CORS)', () => {
    const text = readFileSync(new URL('../../web/vercel.json', import.meta.url), 'utf8');
    const json = JSON.parse(text) as { headers: { headers: { key: string }[] }[] };
    const keys = json.headers.flatMap((h) => h.headers.map((k) => k.key));
    expect(keys).toContain('X-Content-Type-Options');
    expect(text).not.toMatch(/Access-Control-Allow-Origin/i);
  });

  it('API de exemplo declara uma unica funcao com limite de 300 s', () => {
    const json = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      functions: Record<string, { maxDuration: number }>;
    };
    expect(Object.keys(json.functions)).toEqual(['api/index.ts']);
    expect(json.functions['api/index.ts']?.maxDuration).toBe(300);
  });
});
