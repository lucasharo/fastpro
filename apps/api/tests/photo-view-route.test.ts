// H-056 (Issue 69) | Rotas das fotos elegiveis com fakes (docs/factory/167-DESENHO-H056.md, §7 e fatia 3).
// Prova: 401, 403, 404 uniforme (corpo e cabecalhos iguais entre causas), 400 de parametro, 429 sem tocar no banco,
// 503 fixo, lista com chaves fechadas, link de 60 s verificavel pelo codec, dono sem exigencia de perfil,
// e roteamento exato (sem casar o detalhe do pedido). Sem rede e sem banco.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  createPhotoTokenCodec,
  type PhotoViewStorePort,
  type RateWindowDecision,
} from '@fastpro/domain';
import {
  handlePhotoViewRoute,
  isPhotoViewRoute,
  photoViewRoute,
  type PhotoViewRouteOptions,
} from '../src/requests/photo-view-route.js';
import { isRequestDetailRoute } from '../src/requests/detail-route.js';

const SEGREDO = 'segredo-de-teste-h056-com-trinta-e-dois-caracteres';
const PROF = '11111111-1111-4111-8111-111111111111';
const DONO = '44444444-4444-4444-8444-444444444444';
const REQ = '22222222-2222-4222-8222-222222222222';
const FOTO = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const COOKIE = `${SESSION_COOKIE_NAME}=sessao-de-teste`;

const LISTA_PROF = `/v1/professional/requests/${REQ}/photos`;
const VIEW_PROF = (foto = FOTO, query = '?variant=preview') => `/v1/professional/requests/${REQ}/photos/${foto}/view${query}`;
const LISTA_DONO = `/v1/requests/${REQ}/photos`;
const VIEW_DONO = (foto = FOTO, query = '') => `/v1/requests/${REQ}/photos/${foto}/view${query}`;

interface Resposta {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

function lojaPadrao(sobrescrever: Partial<PhotoViewStorePort> = {}): PhotoViewStorePort {
  return {
    list: async () => [{ id: FOTO, sortOrder: 1, width: 1200, height: 900 }],
    target: async () => ({ bytes: 1000, width: 1200, height: 900 }),
    ownerList: async () => [{ id: FOTO, sortOrder: 1, width: 1200, height: 900 }],
    ownerTarget: async () => ({ bytes: 1000, width: 1200, height: 900 }),
    access: async () => true,
    ...sobrescrever,
  };
}

interface Cenario {
  store: PhotoViewStorePort;
  usuario: string | null;
  perfil: boolean;
  limite: RateWindowDecision;
}

function opcoes(parcial: Partial<Cenario> = {}): PhotoViewRouteOptions {
  const cenario: Cenario = {
    store: lojaPadrao(),
    usuario: PROF,
    perfil: true,
    limite: { decision: 'permitido' },
    ...parcial,
  };
  return {
    sessions: { authenticate: async () => (cenario.usuario === null ? null : { userId: cenario.usuario }) },
    profissional: { existe: async (id) => id === PROF && cenario.perfil },
    limite: { check: async () => cenario.limite, record: async () => {} },
    service: { store: cenario.store, codec: createPhotoTokenCodec(SEGREDO), clock: { nowMs: () => AGORA } },
  };
}

async function chamar(
  metodo: string,
  url: string,
  opts: PhotoViewRouteOptions,
  cookie: string | null = COOKIE,
): Promise<Resposta> {
  const estado: Resposta = { status: 0, headers: {}, corpo: '' };
  const res = {
    get headersSent() {
      return estado.status !== 0;
    },
    writeHead(status: number, headers: Record<string, string>) {
      estado.status = status;
      estado.headers = headers;
    },
    end(corpo?: string) {
      estado.corpo = corpo ?? '';
    },
  };
  const req = { method: metodo, url, headers: cookie === null ? {} : { cookie } };
  const caminho = new URL(url, 'http://localhost').pathname;
  await handlePhotoViewRoute(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    caminho,
    opts,
  );
  return estado;
}

describe('fotos elegiveis: lista e link do profissional', () => {
  it('lista 200 com chaves fechadas (sem chave de bucket, bytes ou nome) e cabecalhos de privacidade', async () => {
    const r = await chamar('GET', LISTA_PROF, opcoes());
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.headers['Referrer-Policy']).toBe('no-referrer');
    const corpo = JSON.parse(r.corpo) as { photos: Array<Record<string, unknown>> };
    expect(Object.keys(corpo)).toEqual(['photos']);
    expect(Object.keys(corpo.photos[0] ?? {}).sort()).toEqual(['height', 'id', 'sortOrder', 'width']);
  });

  it('sem sessao (cookie ausente ou sessao invalida) = 401', async () => {
    expect((await chamar('GET', LISTA_PROF, opcoes(), null)).status).toBe(401);
    const invalida = await chamar('GET', LISTA_PROF, opcoes({ usuario: null }));
    expect(invalida.status).toBe(401);
    expect(JSON.parse(invalida.corpo)).toEqual({ code: 'sessao_necessaria' });
  });

  it('sem perfil profissional = 403', async () => {
    const r = await chamar('GET', LISTA_PROF, opcoes({ perfil: false }));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.corpo)).toEqual({ code: 'perfil_profissional_obrigatorio' });
  });

  it('negacoes de causas diferentes (negado, id malformado, metodo errado, foto ausente) saem identicas', async () => {
    const causas = [
      await chamar('GET', LISTA_PROF, opcoes({ store: lojaPadrao({ list: async () => null }) })),
      await chamar('GET', '/v1/professional/requests/nao-e-uuid/photos', opcoes()),
      await chamar('POST', LISTA_PROF, opcoes()),
      await chamar('GET', VIEW_PROF(), opcoes({ store: lojaPadrao({ target: async () => null }) })),
    ];
    for (const r of causas) {
      expect(r.status).toBe(404);
      expect(r.corpo).toBe('{"code":"foto_nao_encontrada"}');
      expect(r.headers).toEqual(causas[0]?.headers);
    }
  });

  it('variante invalida, repetida ou parametro extra = 400 parametro_invalido', async () => {
    const consultas = [
      VIEW_PROF(FOTO, '?variant=grande'),
      VIEW_PROF(FOTO, '?variant=preview&variant=full'),
      VIEW_PROF(FOTO, '?variant=preview&extra=1'),
      `${LISTA_PROF}?extra=1`,
    ];
    for (const url of consultas) {
      const r = await chamar('GET', url, opcoes());
      expect(r.status).toBe(400);
      expect(JSON.parse(r.corpo)).toEqual({ code: 'parametro_invalido' });
    }
  });

  it('limite barrado = 429 com Retry-After e nenhuma consulta ao banco', async () => {
    let consultas = 0;
    const store = lojaPadrao({
      list: async () => {
        consultas += 1;
        return [];
      },
    });
    const r = await chamar('GET', LISTA_PROF, opcoes({ store, limite: { decision: 'barrado', retryAfterSeconds: 12 } }));
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('12');
    expect(JSON.parse(r.corpo)).toEqual({ code: 'muitas_requisicoes' });
    expect(consultas).toBe(0);
  });

  it('falha do banco = 503 indisponivel, sem texto de erro', async () => {
    const store = lojaPadrao({
      list: async () => {
        throw new Error('texto-interno-do-banco');
      },
    });
    const r = await chamar('GET', LISTA_PROF, opcoes({ store }));
    expect(r.status).toBe(503);
    expect(r.corpo).toBe('{"code":"indisponivel"}');
    expect(r.corpo).not.toContain('texto-interno');
  });

  it('link 200: caminho relativo, expires_in 60 e token que vale 60 s com a marca do emissor', async () => {
    const r = await chamar('GET', VIEW_PROF(), opcoes());
    expect(r.status).toBe(200);
    const corpo = JSON.parse(r.corpo) as { view_url: string; expires_in: number };
    expect(corpo.expires_in).toBe(60);
    expect(corpo.view_url.startsWith('/v1/media/watermarked-photos/')).toBe(true);
    const token = corpo.view_url.slice('/v1/media/watermarked-photos/'.length);
    const codec = createPhotoTokenCodec(SEGREDO);
    expect(codec.verify(token, AGORA)).toMatchObject({
      mode: 'professional',
      photoId: FOTO,
      requestId: REQ,
      userId: PROF,
      variant: 'preview',
    });
    expect(codec.verify(token, AGORA + 59_000)).not.toBeNull();
    expect(codec.verify(token, AGORA + 61_000)).toBeNull();
  });

  it('sem variant o link e full (padrao)', async () => {
    const r = await chamar('GET', VIEW_PROF(FOTO, ''), opcoes());
    const token = (JSON.parse(r.corpo) as { view_url: string }).view_url.split('/').pop() ?? '';
    expect(createPhotoTokenCodec(SEGREDO).verify(token, AGORA)?.variant).toBe('full');
  });
});

describe('fotos elegiveis: dono e roteamento', () => {
  it('dono lista e emite link sem exigir perfil profissional; o token e de dono', async () => {
    const o = opcoes({ usuario: DONO, perfil: false });
    expect((await chamar('GET', LISTA_DONO, o)).status).toBe(200);
    const r = await chamar('GET', VIEW_DONO(), o);
    expect(r.status).toBe(200);
    const token = (JSON.parse(r.corpo) as { view_url: string }).view_url.split('/').pop() ?? '';
    expect(createPhotoTokenCodec(SEGREDO).verify(token, AGORA)).toMatchObject({ mode: 'owner', userId: DONO });
  });

  it('dono de outro pedido ou foto inexistente = 404 identico', async () => {
    const o = opcoes({ usuario: DONO, store: lojaPadrao({ ownerTarget: async () => null }) });
    const r = await chamar('GET', VIEW_DONO(), o);
    expect(r.status).toBe(404);
    expect(r.corpo).toBe('{"code":"foto_nao_encontrada"}');
  });

  it('casa somente os quatro caminhos exatos e nao captura o detalhe do pedido', () => {
    expect(photoViewRoute(LISTA_PROF)).toEqual({ papel: 'professional', acao: 'lista', id: REQ, photoId: '' });
    expect(photoViewRoute(`/v1/requests/${REQ}/photos/${FOTO}/view`)).toEqual({
      papel: 'owner',
      acao: 'view',
      id: REQ,
      photoId: FOTO,
    });
    expect(isPhotoViewRoute(`/v1/requests/${REQ}`)).toBe(false);
    expect(isPhotoViewRoute(`${VIEW_PROF()}/extra`)).toBe(false);
    expect(isRequestDetailRoute(LISTA_DONO)).toBe(false);
  });
});
