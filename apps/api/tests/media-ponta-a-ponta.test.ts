// E3 (#141) | Ponta a ponta da midia montada (docs/factory/104-DESENHO-MIDIA-COMPOSICAO.md, §8, CA-08 e CA-10).
// montarMidia com MEDIA_UPLOAD_ENABLED=1 e ambiente completo; o banco e o banco em memoria (MemMedia) e o Storage
// e um fetch falso que implementa o contrato REST que os adaptadores reais usam (bucket quarantine e request-photos).
// Servidor de loopback real (porta 0), sem rede: fetch global bloqueado. Valores sentinela sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de E3 (ponta a ponta)');
};

import { afterAll, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SqlClient } from '@fastpro/db';
import { handleRequest } from '../src/app.js';
import { draftNotFound } from '../src/drafts/draft-service.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';
import { montarMidia } from '../src/media/media-composicao.js';
import { FakeReducer, MemMedia, MemRate } from './media-fakes-h027.js';

const SITE = 'https://fastpro.example.test';
const URL_STORAGE = 'https://sentinela-projeto-e2e.supabase.example.test';
const CHAVE_IP = 'e'.repeat(40);
const SEGREDO = 'B'.repeat(43);
const COOKIE = '__Host-fp_draft';
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const HORA = 3_600_000;
const CUID = '11111111-1111-4111-8111-000000000001';

const ENV_LIGADO: Readonly<Record<string, string>> = {
  MEDIA_UPLOAD_ENABLED: '1',
  DATABASE_URL_APP_API: 'postgres://sentinela-e2e-app-api:senha@db.example.test/app',
  DATABASE_URL_APP_SYSTEM: 'postgres://sentinela-e2e-app-system:senha@db.example.test/sys',
  DRAFT_IP_HMAC_KEY: CHAVE_IP,
  SITE_URL: SITE,
  SUPABASE_URL: URL_STORAGE,
  SUPABASE_SECRET_KEY: 'sentinela-e2e-service-key-0123456789abcdef',
};

/** Foto sintetica: comeca com a assinatura JPEG (a reducao recusa o resto). Nao e imagem real. */
const JPEG = (() => {
  const b = new Uint8Array(4096).fill(7);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
})();

/** Clientes SQL espiao: a montagem nao pode consultar o banco (o banco em memoria cobre as portas). */
const espiaoSql = (): SqlClient =>
  ({
    query: () => {
      throw new Error('banco real nao deve ser consultado no ponta a ponta');
    },
  }) as unknown as SqlClient;

type Tipo = 'assinatura' | 'envio' | 'metadado' | 'listagem' | 'leitura-conteudo' | 'escrita' | 'remocao';
interface Registro {
  readonly tipo: Tipo;
  readonly bucket: string;
  readonly chave: string;
  readonly fase: string;
}

/**
 * Storage falso com o contrato REST dos adaptadores (sign, PUT assinado, info, list, GET, POST com upsert e DELETE).
 * Guarda os bytes por bucket e registra cada chamada com a fase que o teste declarou. Rota desconhecida = 500.
 */
class StorageFalso {
  readonly buckets = new Map<string, Map<string, Uint8Array>>([
    ['quarantine', new Map()],
    ['request-photos', new Map()],
  ]);
  readonly registro: Registro[] = [];
  readonly inesperados: string[] = [];
  readonly tokens = new Map<string, string>();
  fase = 'sem-fase';
  private seq = 0;

  private anota(tipo: Tipo, bucket: string, chave: string): void {
    this.registro.push({ tipo, bucket, chave, fase: this.fase });
  }

  private resposta(status: number, corpo: string | Uint8Array = '', tipo = 'application/json'): Response {
    return new Response(corpo, { status, headers: { 'content-type': tipo } });
  }

  readonly fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const prefixo = '/storage/v1/object/';
    if (!u.pathname.startsWith(prefixo)) {
      this.inesperados.push(`${metodo} ${u.pathname}`);
      return this.resposta(500);
    }
    const resto = u.pathname.slice(prefixo.length);

    if (resto.startsWith('upload/sign/')) {
      const [bucket = '', ...partes] = resto.slice('upload/sign/'.length).split('/');
      const chave = partes.join('/');
      if (metodo === 'POST' && bucket === 'quarantine') {
        this.anota('assinatura', bucket, chave);
        const token = `TOKEN-${++this.seq}`;
        this.tokens.set(chave, token);
        return this.resposta(200, JSON.stringify({ url: `/object/upload/sign/quarantine/${chave}?token=${token}` }));
      }
      if (metodo === 'PUT' && bucket === 'quarantine' && u.searchParams.get('token') === this.tokens.get(chave)) {
        this.anota('envio', bucket, chave);
        this.buckets.get(bucket)?.set(chave, await bytesDe(init?.body));
        return this.resposta(200, '{}');
      }
      this.inesperados.push(`${metodo} ${u.pathname} (assinada)`);
      return this.resposta(400);
    }

    if (resto.startsWith('info/')) {
      const [bucket = '', ...partes] = resto.slice('info/'.length).split('/');
      const chave = partes.join('/');
      this.anota('metadado', bucket, chave);
      const bytes = this.buckets.get(bucket)?.get(chave);
      return bytes === undefined ? this.resposta(404) : this.resposta(200, JSON.stringify({ size: bytes.byteLength }));
    }

    if (resto.startsWith('list/')) {
      this.anota('listagem', resto.slice('list/'.length), '');
      return this.resposta(200, '[]');
    }

    const [bucket = '', ...partes] = resto.split('/');
    const chave = partes.join('/');
    if (!this.buckets.has(bucket)) {
      this.inesperados.push(`${metodo} ${u.pathname}`);
      return this.resposta(500);
    }
    const mapa = this.buckets.get(bucket) ?? new Map<string, Uint8Array>();
    if (metodo === 'GET') {
      this.anota('leitura-conteudo', bucket, chave);
      const bytes = mapa.get(chave);
      return bytes === undefined ? this.resposta(404) : this.resposta(200, bytes, 'image/jpeg');
    }
    if (metodo === 'POST') {
      this.anota('escrita', bucket, chave);
      mapa.set(chave, await bytesDe(init?.body));
      return this.resposta(200, '{}');
    }
    if (metodo === 'DELETE') {
      this.anota('remocao', bucket, chave);
      const existia = mapa.delete(chave);
      return this.resposta(existia ? 200 : 404, '{}');
    }
    this.inesperados.push(`${metodo} ${u.pathname}`);
    return this.resposta(500);
  }) as unknown as typeof fetch;
}

async function bytesDe(corpo: BodyInit | null | undefined): Promise<Uint8Array> {
  if (corpo instanceof Uint8Array) return new Uint8Array(corpo);
  if (corpo instanceof Blob) return new Uint8Array(await corpo.arrayBuffer());
  throw new Error('corpo nao suportado no Storage falso');
}

interface Pedido {
  readonly metodo: string;
  readonly caminho: string;
  readonly cookie?: string;
  readonly corpo?: unknown;
}
interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function pedir(porta: number, p: Pedido): Promise<Resposta> {
  const headers: Record<string, string> = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
  const texto = p.corpo === undefined ? '' : JSON.stringify(p.corpo);
  if (p.corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(texto));
  }
  if (p.cookie) headers['Cookie'] = p.cookie;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: p.metodo, path: p.caminho, headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', reject);
    if (p.corpo !== undefined) req.write(texto);
    req.end();
  });
}

const servidores: Server[] = [];
afterAll(() => {
  for (const s of servidores) s.close();
});

interface Montagem {
  readonly porta: number;
  readonly store: MemMedia;
  readonly storage: StorageFalso;
  readonly pendencias: readonly string[];
}

/** Sobe o servidor com a montagem real (ou sem ela, quando a liberacao falta). Banco e Storage sao os falsos. */
async function subir(env: Readonly<Record<string, string>>): Promise<Montagem> {
  const store = new MemMedia();
  const storage = new StorageFalso();
  const hasher = createDraftHasher(CHAVE_IP);
  store.rascunhos.set(hasher.secretHash(SEGREDO), { status: 'aberto', expiresMs: T0 + 7 * 24 * HORA });
  const m = montarMidia(env, {
    abrirCliente: espiaoSql,
    fetchImpl: storage.fetch,
    relogio: { nowMs: () => T0 },
    reducer: new FakeReducer(),
    portas: { store, rate: new MemRate() },
  });
  const servidor = createServer((req, res) => {
    handleRequest(req, res, { tickSecret: undefined, media: m.options }).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  servidores.push(servidor);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return { porta: (servidor.address() as AddressInfo).port, store, storage, pendencias: m.pendencias };
}

/** Fluxo completo: emitir (201), PUT simulado ao Storage, finalizar (com reducao) e ler o estado. */
async function fluxoCompleto(m: Montagem): Promise<{ id: string; estado: Resposta; finalizacao: Resposta }> {
  const cookie = `${COOKIE}=${SEGREDO}`;
  m.storage.fase = 'emissao';
  const emissao = await pedir(m.porta, {
    metodo: 'POST',
    caminho: '/v1/media/uploads',
    cookie,
    corpo: { client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: JPEG.byteLength },
  });
  expect(emissao.status).toBe(201);
  const { id, upload_url: urlEnvio } = JSON.parse(emissao.body) as { id: string; upload_url: string };
  m.storage.fase = 'envio-simulado';
  const envio = await m.storage.fetch(urlEnvio, { method: 'PUT', body: JPEG });
  expect(envio.status).toBe(200);
  m.storage.fase = 'finalizacao';
  const finalizacao = await pedir(m.porta, { metodo: 'POST', caminho: `/v1/media/${id}/finalize`, cookie });
  m.storage.fase = 'leitura';
  const estado = await pedir(m.porta, { metodo: 'GET', caminho: `/v1/media/${id}`, cookie });
  return { id, estado, finalizacao };
}

describe('E3 ponta a ponta com a midia montada (CA-10, automatizado e simulado)', () => {
  it('CA-10: emitir (201 com upload_url) -> PUT simulado -> finalizar -> reduzir -> estado pronto', async () => {
    const m = await subir(ENV_LIGADO);
    expect(m.pendencias).toEqual(['portas da galeria (ainda nao montadas na funcao)']);
    const { id, estado, finalizacao } = await fluxoCompleto(m);
    expect(finalizacao.status).toBe(200);
    expect(estado.status).toBe(200);
    expect(JSON.parse(estado.body)).toEqual({ id, status: 'ready', confirmed: true });
    // Estado no Storage: original saiu da quarentena e a versao reduzida foi gravada no bucket fixo.
    expect(m.storage.buckets.get('quarantine')?.has(`d/${id}`)).toBe(false);
    expect(m.storage.buckets.get('request-photos')?.has(`p/${id}`)).toBe(true);
    expect(m.storage.inesperados).toEqual([]);
    // Resposta de estado sem URL, caminho nem bucket (CA-06).
    expect(estado.body).not.toMatch(/quarantine|request-photos|upload_url|token|d\/|p\//);
  });

  it('CA-10: com a liberacao ausente, todas as rotas de midia respondem o 404 do rascunho e nada toca o banco ou o Storage', async () => {
    const env = { ...ENV_LIGADO };
    delete (env as Record<string, string | undefined>).MEDIA_UPLOAD_ENABLED;
    const m = await subir(env);
    expect(m.pendencias).toEqual(['MEDIA_UPLOAD_ENABLED (liberacao explicita)']);
    const esperado = draftNotFound();
    const cookie = `${COOKIE}=${SEGREDO}`;
    const alvos: Pedido[] = [
      { metodo: 'POST', caminho: '/v1/media/uploads', cookie, corpo: { client_upload_id: CUID, content_type: 'image/jpeg', size_bytes: 10 } },
      { metodo: 'POST', caminho: '/v1/media/11111111-1111-4111-8111-000000000002/finalize', cookie },
      { metodo: 'GET', caminho: '/v1/media/11111111-1111-4111-8111-000000000002', cookie },
    ];
    for (const alvo of alvos) {
      const r = await pedir(m.porta, alvo);
      expect(r.status, `${alvo.metodo} ${alvo.caminho}`).toBe(esperado.status);
      expect(r.body, `${alvo.metodo} ${alvo.caminho}`).toBe(esperado.body);
    }
    expect(m.storage.registro).toEqual([]);
    expect(m.store.chamadas).toBe(0);
  });
});

describe('E3 CA-08: o Storage so toca o bucket fixo e so le a quarentena durante a reducao', () => {
  it('CA-08: os buckets usados sao exatamente quarantine e request-photos, e nenhuma rota fora deles', async () => {
    const m = await subir(ENV_LIGADO);
    await fluxoCompleto(m);
    const buckets = new Set(m.storage.registro.map((r) => r.bucket));
    expect([...buckets].sort()).toEqual(['quarantine', 'request-photos']);
    expect(m.storage.inesperados).toEqual([]);
  });

  it('CA-08: a quarentena so e lida (conteudo) uma vez, dentro da finalizacao (reducao); emissao e leitura do estado nao tocam o Storage de conteudo', async () => {
    const m = await subir(ENV_LIGADO);
    await fluxoCompleto(m);
    const leiturasQuarentena = m.storage.registro.filter((r) => r.tipo === 'leitura-conteudo' && r.bucket === 'quarantine');
    expect(leiturasQuarentena).toHaveLength(1);
    expect(leiturasQuarentena[0]?.fase).toBe('finalizacao');
    // Fora da reducao, nada le conteudo: emissao so assina; leitura do estado nao chama o Storage.
    expect(m.storage.registro.filter((r) => r.fase === 'emissao').map((r) => r.tipo)).toEqual(['assinatura']);
    expect(m.storage.registro.filter((r) => r.fase === 'leitura')).toEqual([]);
    // Ninguem le o bucket de reducao (request-photos) por conteudo nesta sequencia.
    expect(m.storage.registro.filter((r) => r.tipo === 'leitura-conteudo' && r.bucket === 'request-photos')).toEqual([]);
  });
});
