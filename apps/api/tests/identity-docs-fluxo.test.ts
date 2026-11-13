// H-037 (Issue #50) | R6 e T-19 (obrigatorio). Fluxo completo com os adaptadores REAIS de Storage (packages/db) e um
// fetch espiao que registra toda URL. Nenhuma chamada pode ir a request-photos nem a quarantine, e nenhum prefixo
// p/ ou d/ pode aparecer. Tambem varre os codigos de identity-docs procurando referencias de foto (i). A prova de
// banco (iii, media_asset sem linhas) fica no dbtest, porque exige o banco.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSessionSecret } from '@fastpro/db';
import { SESSION_COOKIE_NAME, type SessionRepositoryPort } from '@fastpro/domain';
import { SupabaseIdentityDocFinalStorage, SupabaseIdentityDocStagingStorage } from '../../../packages/db/src/identity-docs-storage.js';
import { IDOC_PATH } from '../src/identity-docs/espelho/constants.js';
import type { IdentityDocServiceDeps } from '../src/identity-docs/identity-doc-service.js';
import { handleIdentityDocRoute, type IdentityDocRouteOptions } from '../src/identity-docs/identity-doc-route.js';
import { sweepIdentityDocs } from '../src/identity-docs/identity-doc-sweep.js';
import { FakeReducer, MemGate, MemRate, MemStore, PDF_VALIDO, Relogio, T0, JPEG_FAKE } from './identity-docs-fakes.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const BASE_STORAGE = 'https://proj.test';
const SITE = 'https://fastpro.test';
const USUARIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEGREDO = 'segredo-do-fluxo-de-teste';
const HASH = hashSessionSecret(SEGREDO);

interface Registro {
  readonly metodo: string;
  readonly url: string;
}

/** Storage falso no fetch: guarda bytes por bucket/chave e registra cada URL chamada (T-19). */
function storageEspiao(): { fetchImpl: typeof fetch; registros: Registro[]; objetos: Map<string, Uint8Array> } {
  const registros: Registro[] = [];
  const objetos = new Map<string, Uint8Array>();
  const fetchImpl = (async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const metodo = (init?.method ?? 'GET').toUpperCase();
    registros.push({ metodo, url });
    const caminho = new URL(url).pathname;
    const pref = '/storage/v1/object/';
    if (!caminho.startsWith(pref)) return new Response('nao', { status: 404 });
    const resto = caminho.slice(pref.length);
    if (resto.startsWith('upload/sign/')) {
      if (metodo === 'PUT') {
        const chave = resto.slice('upload/sign/'.length);
        objetos.set(chave, new Uint8Array(init?.body as ArrayBuffer));
        return new Response('{}', { status: 200 });
      }
      const chave = resto.slice('upload/sign/'.length);
      return new Response(JSON.stringify({ url: `/storage/v1/object/upload/sign/${chave}?token=t` }), { status: 200 });
    }
    if (resto.startsWith('info/')) {
      const chave = resto.slice('info/'.length);
      const o = objetos.get(chave);
      return o === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify({ size: o.length }), { status: 200 });
    }
    if (resto.startsWith('list/')) return new Response('[]', { status: 200 });
    if (metodo === 'GET') {
      const o = objetos.get(resto);
      return o === undefined ? new Response('', { status: 404 }) : new Response(new Uint8Array(o), { status: 200 });
    }
    if (metodo === 'DELETE') {
      objetos.delete(resto);
      return new Response('', { status: 200 });
    }
    if (metodo === 'POST') {
      objetos.set(resto, new Uint8Array(init?.body as ArrayBuffer));
      return new Response('{}', { status: 200 });
    }
    return new Response('', { status: 405 });
  }) as typeof fetch;
  return { fetchImpl, registros, objetos };
}

describe('H-037 | R6 (T-19): documento nunca toca o bucket de fotos', () => {
  it('fluxo completo com Storage real e fetch espiao: nenhuma URL vai a request-photos ou quarantine (T-19 ii)', async () => {
    const espiao = storageEspiao();
    const relogio = new Relogio(T0);
    const store = new MemStore();
    store.emailVerificado.add(USUARIO);
    const staging = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE_STORAGE, serviceKey: 'chave-de-teste', fetchImpl: espiao.fetchImpl });
    const final = new SupabaseIdentityDocFinalStorage({ baseUrl: BASE_STORAGE, serviceKey: 'chave-de-teste', fetchImpl: espiao.fetchImpl });
    const deps: IdentityDocServiceDeps = {
      store,
      staging,
      final,
      reducer: new FakeReducer(),
      gate: new MemGate(),
      rate: new MemRate(),
      ipHmac: (ip) => `h:${ip}`,
      clock: relogio,
    };
    const sessions = {
      async authenticate(h: string) {
        return h === HASH ? { userId: USUARIO } : null;
      },
    } as unknown as SessionRepositoryPort;
    const opts: IdentityDocRouteOptions = { sessions, perfis: { existe: async () => true }, deps, siteUrl: SITE };

    const servidor: Server = createServer((req, res) => {
      void handleIdentityDocRoute(req, res, new URL(req.url ?? '/', 'http://l').pathname, opts);
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    const cab = { cookie: `${SESSION_COOKIE_NAME}=${SEGREDO}`, origin: SITE, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    try {
      // Imagem: emite, o navegador envia direto ao Storage de entrada, finaliza.
      const e1 = await fetch(`${base}${IDOC_PATH}/uploads`, {
        method: 'POST',
        headers: cab,
        body: JSON.stringify({ client_upload_id: '55555555-5555-4555-8555-555555555555', content_type: 'image/jpeg', size_bytes: 2000 }),
      });
      expect(e1.status).toBe(201);
      const d1 = (await e1.json()) as { id: string; upload_url: string };
      await espiao.fetchImpl(d1.upload_url, { method: 'PUT', body: JPEG_FAKE(2000) });
      const f1 = await fetch(`${base}${IDOC_PATH}/${d1.id}/finalize`, { method: 'POST', headers: cab, body: '' });
      expect(f1.status).toBe(200);

      // PDF valido de 4 KiB, sem redução.
      const e2 = await fetch(`${base}${IDOC_PATH}/uploads`, {
        method: 'POST',
        headers: cab,
        body: JSON.stringify({ client_upload_id: '66666666-6666-4666-8666-666666666666', content_type: 'application/pdf', size_bytes: 4096 }),
      });
      const d2 = (await e2.json()) as { id: string; upload_url: string };
      await espiao.fetchImpl(d2.upload_url, { method: 'PUT', body: PDF_VALIDO(4096) });
      const f2 = await fetch(`${base}${IDOC_PATH}/${d2.id}/finalize`, { method: 'POST', headers: cab, body: '' });
      expect(f2.status).toBe(200);

      // Recusado por conteudo (GIF): nada vai ao bucket final.
      const e3 = await fetch(`${base}${IDOC_PATH}/uploads`, {
        method: 'POST',
        headers: cab,
        body: JSON.stringify({ client_upload_id: '77777777-7777-4777-8777-777777777777', content_type: 'image/jpeg', size_bytes: 40 }),
      });
      const d3 = (await e3.json()) as { id: string; upload_url: string };
      await espiao.fetchImpl(d3.upload_url, { method: 'PUT', body: new TextEncoder().encode('GIF89a' + 'x'.repeat(40)) });
      expect((await fetch(`${base}${IDOC_PATH}/${d3.id}/finalize`, { method: 'POST', headers: cab, body: '' })).status).toBe(415);

      // Exclusao do primeiro documento e varredura.
      expect((await fetch(`${base}${IDOC_PATH}/${d1.id}`, { method: 'DELETE', headers: cab })).status).toBe(204);
      await sweepIdentityDocs({ store, staging, final, clock: relogio });
    } finally {
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }

    expect(espiao.registros.length).toBeGreaterThan(5);
    for (const r of espiao.registros) {
      const u = r.url;
      expect(u).toMatch(/\/storage\/v1\/object\/(upload\/sign\/|info\/|list\/)?identity-(incoming|docs)(\/|$)/);
      expect(u).not.toMatch(/request-photos|quarantine/);
      expect(u).not.toMatch(/\/p\/|\/d\/|%2Fp%2F|%2Fd%2F/);
    }
    // Todo PUT no Storage do documento tem como destino o bucket de entrada ou o final, nunca o de fotos.
    const puts = espiao.registros.filter((r) => r.metodo === 'PUT');
    for (const p of puts) expect(p.url).toMatch(/identity-incoming/);
    // Recusado (GIF) nunca gerou POST no bucket final.
    const postFinal = espiao.registros.filter((r) => r.metodo === 'POST' && /\/identity-docs\//.test(r.url));
    expect(postFinal.length).toBe(2);
    // Leitura de documento nunca aparece no bucket final: nenhum GET para identity-docs (CA-06).
    expect(espiao.registros.some((r) => r.metodo === 'GET' && /\/object\/identity-docs\//.test(r.url))).toBe(false);
  });
});

describe('H-037 | R6 (T-19 i): codigo de identity-docs nao referencia nada de foto', () => {
  const proibidos = [
    'request-photos',
    'MEDIA_REDUCED_BUCKET',
    'quarantine',
    'MEDIA_BUCKET',
    'SupabaseMediaReduceStorage',
    'SupabaseQuarantineStorage',
    'media_asset',
  ];
  const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  const arquivos = [
    ...lerDir(join(raiz, 'apps', 'api', 'src', 'identity-docs')),
    ...lerDir(join(raiz, 'packages', 'domain', 'src', 'identity-docs')),
    join(raiz, 'packages', 'db', 'src', 'identity-docs.ts'),
    join(raiz, 'packages', 'db', 'src', 'identity-docs-storage.ts'),
  ];
  it('nenhum arquivo de identity-docs cita os nomes de foto (exceto a documentacao de regra)', () => {
    for (const caminho of arquivos) {
      const texto = readFileSync(caminho, 'utf8');
      const sem = texto
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**'))
        .join('\n');
      for (const termo of proibidos) expect(sem.includes(termo), `${caminho} cita ${termo}`).toBe(false);
    }
  });
});

function lerDir(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return lerDir(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}
