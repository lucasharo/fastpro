// H-029 (Issue #42) | Testes da galeria do dono (98-DESENHO-H029 §7: G-01, G-02, G-03, G-04, G-05, G-06, G-07, G-09).
// Portas falsas em memoria; o banco real e provado em packages/db/tests/media-gallery-h029.dbtest.mjs.
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_ORDER_PATH,
  MEDIA_PHOTOS_PATH,
  parseMediaOrderBody,
  type DraftRatePort,
  type GaleriaContador,
  type GaleriaLinha,
  type MediaDeleteCode,
  type MediaGalleryStorePort,
  type MediaReorderCode,
  type MediaStorePort,
  type MediaReduceStoragePort,
  type ReducedPhotoReaderPort,
} from '@fastpro/domain';
import type { DraftHasher } from '../src/drafts/draft-hash.js';
import {
  deletePhoto,
  listPhotos,
  readPhotoImage,
  reorderPhotos,
  type GalleryDeps,
} from '../src/media/media-gallery-service.js';
import { handleMediaRoute } from '../src/media/media-route.js';
import type { MediaDeps } from '../src/media/media-service.js';

const SITE = 'https://fastpro.test';
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const SEGREDO = Buffer.alloc(32, 7).toString('base64url');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

class GaleriaFalsa implements MediaGalleryStorePort {
  linhas: readonly GaleriaLinha[] | null = [];
  codigoExclusao: MediaDeleteCode = 'deleted';
  codigoOrdem: MediaReorderCode = 'ok';
  bytesAlvo: number | null = JPEG.byteLength;
  chamadas: string[] = [];
  async list(): Promise<readonly GaleriaLinha[] | null> {
    this.chamadas.push('list');
    return this.linhas;
  }
  async remove(): Promise<MediaDeleteCode> {
    this.chamadas.push('remove');
    return this.codigoExclusao;
  }
  async reorder(): Promise<MediaReorderCode> {
    this.chamadas.push('reorder');
    return this.codigoOrdem;
  }
  async readTarget(): Promise<number | null> {
    this.chamadas.push('readTarget');
    return this.bytesAlvo;
  }
}

class StorageFalso {
  removidos: string[] = [];
  falha = false;
  async removeOriginal(id: string): Promise<void> {
    if (this.falha) throw new Error('falha_storage');
    this.removidos.push(`d/${id}`);
  }
  async removeReduced(id: string): Promise<void> {
    if (this.falha) throw new Error('falha_storage');
    this.removidos.push(`p/${id}`);
  }
}

function montar(over: { gallery?: GaleriaFalsa; reader?: ReducedPhotoReaderPort; storage?: StorageFalso } = {}) {
  const gallery = over.gallery ?? new GaleriaFalsa();
  const storage = over.storage ?? new StorageFalso();
  const purgados: string[][] = [];
  const contadores: GaleriaContador[] = [];
  const store = { purgeDone: async (ids: readonly string[]) => (purgados.push([...ids]), ids.length) };
  const hasher: DraftHasher = { secretHash: (s) => `h:${s}`, ipHmac: (ip) => `ip:${ip}` };
  const rate: DraftRatePort = { check: async () => ({ ok: true }), hit: async () => undefined };
  const reader: ReducedPhotoReaderPort = over.reader ?? { readReduced: async () => JPEG };
  const deps: GalleryDeps = {
    gallery,
    reader,
    storage: storage as unknown as MediaReduceStoragePort,
    store: store as unknown as MediaStorePort,
    rate,
    hasher,
    clock: { nowMs: () => Date.UTC(2026, 10, 12) },
    contador: (nome) => contadores.push(nome),
  };
  return { deps, gallery, storage, purgados, contadores };
}

const LINHA = (id: string, estado: string, posicao: number | null, motivo: string | null = null): GaleriaLinha => ({
  id,
  estado,
  posicao,
  motivo,
});

describe('listagem da galeria (98 §2.1, G-01)', () => {
  it('devolve so as chaves da lista: recusada com motivo, nao recusada com posicao', async () => {
    const m = montar();
    m.gallery.linhas = [LINHA(ID1, 'pronta', 1), LINHA(ID2, 'recusada', null, 'imagem_invalida')];
    const r = await listPhotos({ secret: SEGREDO, ip: '10.0.0.1' }, m.deps);
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(r.body as string)).toEqual({
      fotos: [
        { id: ID1, estado: 'pronta', posicao: 1 },
        { id: ID2, estado: 'recusada', motivo: 'imagem_invalida' },
      ],
    });
    expect(m.contadores).toEqual(['lista_ok']);
  });

  it('rascunho sem foto = 200 com lista vazia; rascunho inexistente = 404 uniforme', async () => {
    const vazio = montar();
    vazio.gallery.linhas = [LINHA(null as unknown as string, 'x', null)];
    expect(JSON.parse((await listPhotos({ secret: SEGREDO, ip: 'a' }, vazio.deps)).body as string)).toEqual({ fotos: [] });
    const ausente = montar();
    ausente.gallery.linhas = null;
    const r404 = await listPhotos({ secret: SEGREDO, ip: 'a' }, ausente.deps);
    expect(r404.status).toBe(404);
    expect(r404.headers['Cache-Control']).toBe('no-store');
  });
});

describe('leitura da versao reduzida (98 §2.2, G-02, G-03, G-04)', () => {
  it('serve os bytes do objeto p/<id> com cabecalhos exatos', async () => {
    const m = montar();
    const r = await readPhotoImage({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(JPEG);
    expect(r.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
  });

  it('foto que nao e do dono, nao esta pronta ou foi excluida: 404 uniforme', async () => {
    const m = montar();
    m.gallery.bytesAlvo = null;
    const r = await readPhotoImage({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(r.status).toBe(404);
    expect(m.contadores).toEqual(['imagem_404']);
  });

  it('tamanho divergente, objeto ausente ou sem assinatura JPEG: 503 e nada servido', async () => {
    const divergente = montar();
    divergente.gallery.bytesAlvo = JPEG.byteLength + 1;
    const r1 = await readPhotoImage({ id: ID1, secret: SEGREDO, ip: 'a' }, divergente.deps);
    expect(r1.status).toBe(503);
    expect(JSON.parse(r1.body as string)).toEqual({ code: 'indisponivel' });
    expect(divergente.contadores).toEqual(['leitura_divergente']);

    const ausente = montar({ reader: { readReduced: async () => null } });
    expect((await readPhotoImage({ id: ID1, secret: SEGREDO, ip: 'a' }, ausente.deps)).status).toBe(503);

    const semAssinatura = montar({ reader: { readReduced: async () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) } });
    expect((await readPhotoImage({ id: ID1, secret: SEGREDO, ip: 'a' }, semAssinatura.deps)).status).toBe(503);
  });
});

describe('exclusao (98 §2.3, G-06, G-07)', () => {
  it('deleted e already dao 200 igual; a remocao fisica roda e o expurgo so depois dela', async () => {
    const m = montar();
    const primeira = await deletePhoto({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(primeira).toMatchObject({ status: 200 });
    expect(JSON.parse(primeira.body as string)).toEqual({ excluida: true });
    expect(m.storage.removidos).toEqual([`d/${ID1}`, `p/${ID1}`]);
    expect(m.purgados).toEqual([[ID1]]);
    expect(m.contadores).toEqual(['exclusao_ok']);

    m.gallery.codigoExclusao = 'already';
    const repetida = await deletePhoto({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(repetida.body).toBe(primeira.body);
    expect(m.contadores.at(-1)).toBe('exclusao_repetida');
  });

  it('foto alheia ou inexistente: 404 uniforme e nada removido', async () => {
    const m = montar();
    m.gallery.codigoExclusao = 'not_found';
    const r = await deletePhoto({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(r.status).toBe(404);
    expect(m.storage.removidos).toEqual([]);
  });

  it('falha da remocao fisica nao muda a resposta: 200, sem expurgo e com contador', async () => {
    const storage = new StorageFalso();
    storage.falha = true;
    const m = montar({ storage });
    const r = await deletePhoto({ id: ID1, secret: SEGREDO, ip: 'a' }, m.deps);
    expect(r.status).toBe(200);
    expect(m.purgados).toEqual([]);
    expect(m.contadores).toEqual(['exclusao_ok', 'remocao_fisica_falhou']);
  });
});

describe('reordenacao (98 §2.4, G-08 na parte da rota, G-09)', () => {
  it('ok devolve a lista; changed devolve 409 com a lista atual; invalid 422; not_found 404', async () => {
    const m = montar();
    m.gallery.linhas = [LINHA(ID2, 'pronta', 1), LINHA(ID1, 'pronta', 2)];
    const ok = await reorderPhotos({ atual: [ID1, ID2], nova: [ID2, ID1], secret: SEGREDO, ip: 'a' }, m.deps);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body as string).fotos[0].id).toBe(ID2);

    m.gallery.codigoOrdem = 'changed';
    const conflito = await reorderPhotos({ atual: [ID1, ID2], nova: [ID2, ID1], secret: SEGREDO, ip: 'a' }, m.deps);
    expect(conflito.status).toBe(409);
    expect(JSON.parse(conflito.body as string)).toMatchObject({ code: 'ordem_mudou', fotos: expect.any(Array) });

    m.gallery.codigoOrdem = 'invalid';
    expect((await reorderPhotos({ atual: [ID1], nova: [ID2], secret: SEGREDO, ip: 'a' }, m.deps)).status).toBe(422);

    m.gallery.codigoOrdem = 'not_found';
    expect((await reorderPhotos({ atual: [ID1], nova: [ID1], secret: SEGREDO, ip: 'a' }, m.deps)).status).toBe(404);
  });
});

describe('validacao do corpo da ordem (98 §2.4, G-09)', () => {
  const corpo = (o: unknown) => JSON.stringify(o);
  it('aceita a permutacao e recusa as demais formas com o codigo fixo', () => {
    expect(parseMediaOrderBody(corpo({ ordem_atual: [ID1, ID2], ordem_nova: [ID2, ID1] }), 60)).toMatchObject({ ok: true });
    expect(parseMediaOrderBody(corpo({ ordem_atual: [ID1], ordem_nova: [ID1], extra: 1 }), 60)).toMatchObject({
      code: 'campo_desconhecido',
      status: 422,
    });
    expect(parseMediaOrderBody(corpo({ ordem_atual: [], ordem_nova: [] }), 40)).toMatchObject({ code: 'vazio' });
    expect(
      parseMediaOrderBody(corpo({ ordem_atual: [ID1, ID2, ID3, ID1, ID2, ID3], ordem_nova: [ID1] }), 90),
    ).toMatchObject({ code: 'ordem_invalida' });
    expect(parseMediaOrderBody(corpo({ ordem_atual: [ID1, ID2], ordem_nova: [ID1, ID1] }), 60)).toMatchObject({
      code: 'ordem_invalida',
    });
    expect(parseMediaOrderBody(corpo({ ordem_atual: [ID1], ordem_nova: [ID3] }), 50)).toMatchObject({
      code: 'ordem_invalida',
    });
    expect(parseMediaOrderBody(corpo({ ordem_atual: ['nao-uuid'], ordem_nova: ['nao-uuid'] }), 50)).toMatchObject({
      code: 'ordem_invalida',
    });
    expect(parseMediaOrderBody('{', 1)).toMatchObject({ code: 'corpo_invalido' });
    expect(parseMediaOrderBody('x', 2000)).toMatchObject({ status: 413, code: 'corpo_grande' });
  });
});

/** Requisicao falsa para o roteador: corpo como fluxo, cabecalhos e endereco do socket. */
function requisicao(metodo: string, cabecalhos: Record<string, string>, corpo = ''): IncomingMessage {
  const r = Readable.from(corpo ? [Buffer.from(corpo)] : []) as unknown as IncomingMessage;
  Object.assign(r, { method: metodo, headers: cabecalhos, socket: { remoteAddress: '10.0.0.9' } });
  return r;
}

function resposta(): { res: ServerResponse; saida: { status: number; headers: unknown; body: unknown } } {
  const saida = { status: 0, headers: undefined as unknown, body: undefined as unknown };
  const res = {
    headersSent: false,
    writeHead(status: number, headers: unknown) {
      saida.status = status;
      saida.headers = headers;
      this.headersSent = true;
    },
    end(body: unknown) {
      saida.body = body;
    },
  } as unknown as ServerResponse;
  return { res, saida };
}

function opcoesRota(m: ReturnType<typeof montar>) {
  return {
    deps: { store: m.deps.store, storage: m.deps.storage, rate: m.deps.rate, hasher: m.deps.hasher, clock: m.deps.clock, reduce: {} } as unknown as MediaDeps,
    siteUrl: SITE,
    galeria: m.deps,
  };
}

const CABEC_OK = { origin: SITE, 'sec-fetch-site': 'same-origin', cookie: `__Host-fp_draft=${SEGREDO}` };

describe('rotas da galeria (98 §1, G-03, G-09)', () => {
  it('sem cookie ou com cookie malformado: 404 sem tocar o banco', async () => {
    const m = montar();
    const { res, saida } = resposta();
    await handleMediaRoute(requisicao('GET', { origin: SITE }), res, MEDIA_PHOTOS_PATH, opcoesRota(m));
    expect(saida.status).toBe(404);
    expect(m.gallery.chamadas).toEqual([]);
  });

  it('GET /v1/media/photos com cookie: 200 e lista', async () => {
    const m = montar();
    m.gallery.linhas = [LINHA(ID1, 'aguardando', 1)];
    const { res, saida } = resposta();
    await handleMediaRoute(requisicao('GET', CABEC_OK), res, MEDIA_PHOTOS_PATH, opcoesRota(m));
    expect(saida.status).toBe(200);
    expect(JSON.parse(saida.body as string)).toEqual({ fotos: [{ id: ID1, estado: 'aguardando', posicao: 1 }] });
  });

  it('PUT da ordem exige JSON: outro tipo recebe 415 antes do banco', async () => {
    const m = montar();
    const { res, saida } = resposta();
    await handleMediaRoute(requisicao('PUT', { ...CABEC_OK, 'content-type': 'text/plain' }, '{}'), res, MEDIA_ORDER_PATH, opcoesRota(m));
    expect(saida.status).toBe(415);
    expect(m.gallery.chamadas).toEqual([]);
  });

  it('DELETE /v1/media/{id} remove a foto do dono; id que nao e uuid recebe 404 sem banco', async () => {
    const m = montar();
    const { res, saida } = resposta();
    await handleMediaRoute(requisicao('DELETE', CABEC_OK), res, `/v1/media/${ID1}`, opcoesRota(m));
    expect(saida.status).toBe(200);
    const { res: res2, saida: saida2 } = resposta();
    await handleMediaRoute(requisicao('DELETE', CABEC_OK), res2, '/v1/media/nao-uuid', opcoesRota(m));
    expect(saida2.status).toBe(404);
  });

  it('sem a opcao galeria, as rotas novas continuam 404 uniforme', async () => {
    const m = montar();
    const opcoes = { ...opcoesRota(m), galeria: undefined };
    const { res, saida } = resposta();
    await handleMediaRoute(requisicao('GET', CABEC_OK), res, MEDIA_PHOTOS_PATH, opcoes);
    expect(saida.status).toBe(404);
    expect(m.gallery.chamadas).toEqual([]);
  });
});
