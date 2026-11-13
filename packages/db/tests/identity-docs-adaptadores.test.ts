// H-037 (Issue #50) | Adaptadores de banco e Storage dos documentos (107 §2 D-3, §4.2; T-06, T-17, T-19, T-24 parcial).
// Sem rede e sem banco: cliente SQL e fetch falsos, dados sinteticos. A prova real contra o DEV fica no dbtest.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IDOC_MAX_VIVOS, IdentityDocStoreError, PgIdentityDocStore } from '../src/identity-docs.js';
import {
  IdentityDocStorageError,
  IDOC_FINAL_BUCKET,
  IDOC_INCOMING_BUCKET,
  SupabaseIdentityDocFinalStorage,
  SupabaseIdentityDocStagingStorage,
} from '../src/identity-docs-storage.js';
import * as dominio from '../../domain/src/identity-docs/constants.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://projeto-sintetico.supabase.test';
const CHAVE = 'chave-sintetica-de-servico';
const ID = '0b7e3b52-1f0a-4c1e-9a7e-2d3f4a5b6c7d';
const ID2 = '1c8f4c63-2a1b-4d2f-8b8f-3e4a5b6c7d8e';

interface Chamada {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(resposta: (url: string, init: RequestInit) => Response | Error) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init: init ?? {} });
    const r = resposta(u, init ?? {});
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('H-037 | paridade de constantes com o dominio (CA-05, CA-07)', () => {
  it('limite de vivos e nomes dos buckets batem com packages/domain/src/identity-docs', () => {
    expect(IDOC_MAX_VIVOS).toBe(dominio.IDOC_MAX_VIVOS);
    expect(IDOC_INCOMING_BUCKET).toBe(dominio.IDOC_INCOMING_BUCKET);
    expect(IDOC_FINAL_BUCKET).toBe(dominio.IDOC_FINAL_BUCKET);
  });
});

describe('H-037 | Storage de entrada (identity-incoming, chave s/<uuid>)', () => {
  it('emite URL de envio no bucket de entrada e devolve URL absoluta', async () => {
    const { f, chamadas } = fakeFetch(() =>
      json({ url: `/object/upload/sign/identity-incoming/s/${ID}?token=sintetico` }),
    );
    const st = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    const url = await st.createUploadUrl(`s/${ID}`, 900);
    expect(url).toBe(`${BASE}/storage/v1/object/upload/sign/identity-incoming/s/${ID}?token=sintetico`);
    expect(chamadas[0]?.url).toBe(`${BASE}/storage/v1/object/upload/sign/identity-incoming/s/${ID}`);
  });

  it('stat: 404 devolve null e 200 devolve o tamanho', async () => {
    const ausente = fakeFetch(() => new Response(null, { status: 404 }));
    const st1 = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: ausente.f });
    expect(await st1.stat(`s/${ID}`)).toBeNull();

    const presente = fakeFetch(() => json({ size: 1234 }));
    const st2 = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: presente.f });
    expect(await st2.stat(`s/${ID}`)).toEqual({ bytes: 1234 });
  });

  it('read devolve os bytes e 404 devolve null', async () => {
    const ok = fakeFetch(() => new Response(new Uint8Array([1, 2, 3])));
    const st = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: ok.f });
    expect(await st.read(`s/${ID}`)).toEqual(new Uint8Array([1, 2, 3]));
    const nao = fakeFetch(() => new Response(null, { status: 404 }));
    const st2 = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: nao.f });
    expect(await st2.read(`s/${ID}`)).toBeNull();
  });

  it('falha do Storage vira erro de codigo fixo, sem eco do corpo da resposta', async () => {
    const { f } = fakeFetch(() => new Response('segredo-no-corpo-do-storage', { status: 500 }));
    const st = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    const erro = await st.remove(`s/${ID}`).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(IdentityDocStorageError);
    expect((erro as IdentityDocStorageError).code).toBe('storage_falha');
    expect((erro as Error).message).not.toContain('segredo');
  });

  it('erro de rede vira storage_falha', async () => {
    const { f } = fakeFetch(() => new TypeError('falha de rede sintetica'));
    const st = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    await expect(st.stat(`s/${ID}`)).rejects.toMatchObject({ code: 'storage_falha' });
  });

  it('listOlderThan devolve so as chaves s/ mais antigas que a idade pedida', async () => {
    const agora = new Date().toISOString();
    const { f, chamadas } = fakeFetch(() =>
      json([
        { name: ID, created_at: '2000-01-01T00:00:00.000Z' },
        { name: ID2, created_at: agora },
      ]),
    );
    const st = new SupabaseIdentityDocStagingStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    expect(await st.listOlderThan(3 * 60 * 60 * 1000, 500)).toEqual([`s/${ID}`]);
    expect(chamadas[0]?.url).toContain('/object/list/identity-incoming');
  });
});

describe('H-037 | Storage final (identity-docs, chave i/<uuid>): so grava, confere e remove (CA-06, CA-19)', () => {
  it('put grava no bucket final com upsert e tipo do conteudo', async () => {
    const { f, chamadas } = fakeFetch(() => json({ Key: 'identity-docs/i/x' }));
    const st = new SupabaseIdentityDocFinalStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    await st.put(ID, new Uint8Array([0xff, 0xd8]), 'image/jpeg');
    const c = chamadas[0];
    expect(c?.url).toBe(`${BASE}/storage/v1/object/identity-docs/i/${ID}`);
    expect(c?.init.method).toBe('POST');
    const headers = c?.init.headers as Record<string, string>;
    expect(headers['x-upsert']).toBe('true');
    expect(headers['content-type']).toBe('image/jpeg');
  });

  it('stat e remove usam so o bucket final', async () => {
    const { f, chamadas } = fakeFetch(() => new Response(null, { status: 404 }));
    const st = new SupabaseIdentityDocFinalStorage({ baseUrl: BASE, serviceKey: CHAVE, fetchImpl: f });
    expect(await st.stat(ID)).toBeNull();
    await st.remove(ID);
    for (const c of chamadas) expect(c.url).toContain('/identity-docs/i/');
  });

  it('a classe do bucket final NAO tem metodo de leitura, URL de leitura nem listagem (CA-06)', () => {
    const proto = SupabaseIdentityDocFinalStorage.prototype as unknown as Record<string, unknown>;
    for (const nome of ['read', 'readForReview', 'createSignedUrl', 'createSignedUrls', 'download', 'list', 'listOlderThan', 'createUploadUrl']) {
      expect(proto[nome]).toBeUndefined();
    }
  });
});

describe('H-037 | Banco: so funcoes private.idoc_* (CA-06, D-3)', () => {
  interface Gravacao {
    readonly text: string;
    readonly params: unknown[];
  }

  function clienteFalso(linha: Record<string, unknown>, erro?: Error) {
    const gravadas: Gravacao[] = [];
    const cliente = {
      query: async (text: string, params: unknown[] = []) => {
        gravadas.push({ text, params });
        if (erro) throw erro;
        return { rows: [linha] };
      },
    };
    return { cliente: cliente as unknown as ConstructorParameters<typeof PgIdentityDocStore>[0], gravadas };
  }

  const LINHA = {
    out_code: 'begin',
    out_attempt: 1,
    out_declared_type: 'image/jpeg',
    out_id: ID,
    out_status: 'em_envio',
    out_file_kind: 'pdf',
    out_received_at: null,
    out_deletable: true,
    out_staging: true,
    out_final: false,
    out: 'received',
    n: 2,
  };

  it('issue envia os parametros posicionais e mapeia o codigo', async () => {
    const { cliente, gravadas } = clienteFalso({ ...LINHA, out_code: 'new', out_status: 'em_envio' });
    const store = new PgIdentityDocStore(cliente);
    const r = await store.issue({
      userId: ID,
      clientUploadId: ID2,
      declaredType: 'image/jpeg',
      declaredBytes: 4096,
      nowMs: 0,
      globalBytesCap: 250_000_000,
    });
    expect(r).toEqual({ code: 'new', id: ID, status: 'em_envio' });
    expect(gravadas[0]?.text).toContain('private.idoc_issue');
    expect(gravadas[0]?.params).toEqual([ID, ID2, 'image/jpeg', 4096, new Date(0).toISOString(), 250_000_000]);
  });

  it('issue com codigo fora da lista vira erro fixo', async () => {
    const { cliente } = clienteFalso({ ...LINHA, out_code: 'algo_novo' });
    await expect(new PgIdentityDocStore(cliente).issue({
      userId: ID,
      clientUploadId: ID2,
      declaredType: 'image/jpeg',
      declaredBytes: 1,
      nowMs: 0,
      globalBytesCap: 1,
    })).rejects.toBeInstanceOf(IdentityDocStoreError);
  });

  it('erro do banco vira store_falha sem eco do SQL nem da mensagem', async () => {
    const { cliente } = clienteFalso({}, new Error('erro sintetico SENSIVEL do banco'));
    const erro = await new PgIdentityDocStore(cliente).remove(ID, ID2, 0).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(IdentityDocStoreError);
    expect((erro as IdentityDocStoreError).code).toBe('store_falha');
    expect((erro as Error).message).not.toContain('SENSIVEL');
  });

  it('list calcula vagas restantes e mapeia tipo e estado', async () => {
    const { cliente } = clienteFalso({ ...LINHA, out_file_kind: 'pdf', out_status: 'recebido', out_received_at: '2026-11-12T10:00:00Z' });
    const r = await new PgIdentityDocStore(cliente).list(ID);
    expect(r.slotsRemaining).toBe(IDOC_MAX_VIVOS - 1);
    expect(r.documents[0]).toMatchObject({ kind: 'pdf', status: 'recebido', deletable: true });
  });

  it('confirmDone envia o SHA-256 como bytea e purgeDone sem ids nao consulta o banco', async () => {
    const { cliente, gravadas } = clienteFalso({ ...LINHA, out: 'received' });
    const store = new PgIdentityDocStore(cliente);
    expect(await store.confirmDone(ID, ID2, 1, 'image/jpeg', 100, new Uint8Array(32), 0)).toBe('received');
    expect(gravadas[0]?.params[5]).toBeInstanceOf(Buffer);
    expect(await store.purgeDone([])).toBe(0);
    expect(gravadas).toHaveLength(1);
  });

  it('toda chamada usa so funcoes private.idoc_* (sem DML direto em app.identity_document)', async () => {
    const { cliente, gravadas } = clienteFalso(LINHA);
    const store = new PgIdentityDocStore(cliente);
    await store.list(ID);
    await store.confirmBegin(ID, ID2, 0, 30);
    await store.confirmDone(ID, ID2, 1, 'image/jpeg', 1, new Uint8Array(32), 0);
    await store.confirmRefuse(ID, ID2, 1, 'pdf_ativo', 0);
    await store.confirmRelease(ID2, 1, true);
    await store.remove(ID, ID2, 0);
    await store.sweep(0, 10);
    await store.purgeDone([ID2]);
    await store.knownPending([ID2]);
    expect(gravadas.length).toBe(9);
    for (const g of gravadas) {
      expect(g.text).toContain('private.idoc_');
      expect(g.text).not.toMatch(/insert into|update app|delete from|app\.identity_document/i);
    }
  });
});

describe('H-037 | teste estatico de R6 e T-17 sobre os modulos de documento (T-19 i, CA-19)', () => {
  const dominioDir = join(AQUI, '..', '..', 'domain', 'src', 'identity-docs');
  const arquivos = [
    join(AQUI, '..', 'src', 'identity-docs.ts'),
    join(AQUI, '..', 'src', 'identity-docs-storage.ts'),
    ...readdirSync(dominioDir).filter((n) => n.endsWith('.ts')).map((n) => join(dominioDir, n)),
  ];
  const proibidos: RegExp[] = [
    /request-photos/,
    /MEDIA_REDUCED_BUCKET/,
    /'quarantine'/,
    /MEDIA_BUCKET/,
    /SupabaseMediaReduceStorage/,
    /SupabaseQuarantineStorage/,
    /media_asset/,
  ];

  it.each(arquivos.map((a) => [a.split(/[\\/]/).slice(-2).join('/'), a] as const))(
    '%s nao referencia bucket, classe ou tabela de foto',
    (_nome, caminho) => {
      const texto = readFileSync(caminho, 'utf8');
      for (const re of proibidos) expect(texto).not.toMatch(re);
    },
  );

  it('nenhum modulo de documento da camada de banco le o bucket final (IdentityDocReaderPort fica na #52)', () => {
    for (const caminho of arquivos.filter((a) => a.includes(join('packages', 'db')) || a.includes(join('db', 'src')))) {
      const texto = readFileSync(caminho, 'utf8');
      expect(texto).not.toMatch(/readForReview|IdentityDocReaderPort/);
    }
    const storage = readFileSync(join(AQUI, '..', 'src', 'identity-docs-storage.ts'), 'utf8');
    expect(storage).not.toMatch(/readForReview|createSignedUrl|\/object\/sign\//);
  });
});
