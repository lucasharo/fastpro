// H-056 (Issue 69) | Entrega da foto com marca d'agua (docs/factory/167-DESENHO-H056.md, §7 e fatia 4).
// Prova: token adulterado/expirado = 404 sem tocar banco, Storage, limite ou compositor; reconferencia do acesso (A-3);
// leitura ausente, divergente ou sem assinatura JPEG = 503 e nada servido; limite photo_deliver (429);
// gate de 2 vagas e timeout de 5 s (a vaga so volta quando a renderizacao termina); cabecalhos exatos da decisao 839
// com Cross-Origin-Resource-Policy same-site; dono sem marca; regressao de rotas e despacho em app.ts.
// Sem rede e sem banco: Storage, banco e compositor sao substitutos; o caso feliz usa sharp real.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-056');
};

import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  createPhotoTokenCodec,
  watermarkIdOf,
  type PhotoTarget,
  type PhotoViewStorePort,
  type RateWindowDecision,
  type ReducedPhotoReaderPort,
  type WatermarkComposerPort,
} from '@fastpro/domain';
import type { SqlClient } from '@fastpro/db';
import {
  RENDER_TIMEOUT_MS,
  entregarFoto,
  type WatermarkDeliveryDeps,
} from '../src/requests/photo-watermark-service.js';
import {
  handleWatermarkedPhotoRoute,
  isWatermarkedPhotoRoute,
  type WatermarkedPhotoRouteOptions,
} from '../src/media/watermarked-photo-route.js';
import { ReduceGate } from '../src/media/reduce-gate.js';
import { SharpWatermarkComposer } from '../src/media/watermark-composer-sharp.js';
import { handleRequest } from '../src/app.js';
import { MEDIA_ENV_STORAGE } from '../src/media/media-composicao.js';
import { montarFotosPedido } from '../src/requests/photo-view-composicao.js';
import { photoViewRoute, isPhotoViewRoute } from '../src/requests/photo-view-route.js';
import { draftNotFound } from '../src/drafts/draft-service.js';
import { isRequestDetailRoute } from '../src/requests/detail-route.js';

const SEGREDO = 'segredo-de-teste-h056-com-trinta-e-dois-caracteres';
const SALT = 'salt-de-teste-h056-com-trinta-e-dois-caracteres-x';
const PROF = '11111111-1111-4111-8111-111111111111';
const DONO = '44444444-4444-4444-8444-444444444444';
const REQ = '22222222-2222-4222-8222-222222222222';
const FOTO = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0);
const CODEC = createPhotoTokenCodec(SEGREDO);
const SAIDA = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const CAMINHO = (token: string): string => `/v1/media/watermarked-photos/${token}`;

let FOTO_JPEG: Uint8Array;

beforeAll(async () => {
  FOTO_JPEG = new Uint8Array(
    await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 120, g: 160, b: 200 } } })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
});

const tokenProf = (variant: 'preview' | 'full' = 'preview', agora = AGORA): string =>
  CODEC.sign({ mode: 'professional', photoId: FOTO, requestId: REQ, userId: PROF, variant }, agora);
const tokenDono = (variant: 'preview' | 'full' = 'full'): string =>
  CODEC.sign({ mode: 'owner', photoId: FOTO, requestId: REQ, userId: DONO, variant }, AGORA);

interface Registro {
  readonly target: unknown[][];
  readonly ownerTarget: unknown[][];
  readonly readReduced: string[];
  readonly compose: Array<{ variant: string; label: string | null; signal: AbortSignal }>;
  readonly check: unknown[][];
  readonly record: unknown[][];
  readonly contadores: string[];
}

interface Montagem {
  readonly deps: WatermarkDeliveryDeps;
  readonly log: Registro;
}

interface Parcial extends Partial<WatermarkDeliveryDeps> {
  readonly alvo?: PhotoTarget | null;
  readonly limite?: RateWindowDecision;
}

/** Dependencias de teste: banco, Storage e compositor gravam chamadas; gate real de 2 vagas sem espera. */
function montar(parcial: Parcial = {}): Montagem {
  const log: Registro = {
    target: [],
    ownerTarget: [],
    readReduced: [],
    compose: [],
    check: [],
    record: [],
    contadores: [],
  };
  const alvo: PhotoTarget | null =
    parcial.alvo === undefined ? { bytes: FOTO_JPEG.byteLength, width: 1200, height: 900 } : parcial.alvo;
  const decisao: RateWindowDecision = parcial.limite ?? { decision: 'permitido' };
  const store: PhotoViewStorePort = parcial.store ?? {
    list: async () => [],
    target: async (...a: unknown[]) => {
      log.target.push(a);
      return alvo;
    },
    ownerList: async () => [],
    ownerTarget: async (...a: unknown[]) => {
      log.ownerTarget.push(a);
      return alvo;
    },
    access: async () => true,
  };
  const reader: ReducedPhotoReaderPort = parcial.reader ?? {
    readReduced: async (id: string) => {
      log.readReduced.push(id);
      return FOTO_JPEG;
    },
  };
  const composer: WatermarkComposerPort = parcial.composer ?? {
    compose: async (_entrada, opts) => {
      log.compose.push({ variant: opts.variant, label: opts.label, signal: opts.signal });
      return { ok: true, jpeg: SAIDA };
    },
  };
  const deps: WatermarkDeliveryDeps = {
    store,
    reader,
    composer,
    gate: parcial.gate ?? new ReduceGate({ maxConcurrent: 2, waitMs: 0 }),
    codec: CODEC,
    limite: {
      check: async (u: string, n: number) => {
        log.check.push([u, n]);
        return decisao;
      },
      record: async (u: string, n: number) => {
        log.record.push([u, n]);
      },
    },
    idSalt: SALT,
    clock: { nowMs: () => AGORA },
    contador: (nome) => {
      log.contadores.push(nome);
    },
    ...(parcial.tempoLimiteMs !== undefined ? { tempoLimiteMs: parcial.tempoLimiteMs } : {}),
  };
  return { deps, log };
}

interface Resposta {
  status: number;
  headers: Record<string, string | number>;
  corpo: Buffer;
  texto: string;
}

function fakeReq(url: string, metodo = 'GET'): IncomingMessage {
  return { method: metodo, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

/** Captura status, cabecalhos e corpo; nada e enviado a rede. */
function fakeRes(): ServerResponse & Resposta {
  const r = {
    status: 0,
    headers: {} as Record<string, string | number>,
    corpo: Buffer.alloc(0),
    texto: '',
    headersSent: false,
    writeHead(status: number, headers: Record<string, string | number>) {
      r.status = status;
      r.headers = { ...headers };
      r.headersSent = true;
      return r;
    },
    end(corpo?: string | Uint8Array) {
      r.corpo = corpo === undefined ? Buffer.alloc(0) : Buffer.from(corpo);
      r.texto = r.corpo.toString('utf8');
    },
  };
  return r as unknown as ServerResponse & Resposta;
}

async function rota(url: string, deps: WatermarkDeliveryDeps, metodo = 'GET'): Promise<ServerResponse & Resposta> {
  const res = fakeRes();
  const opts: WatermarkedPhotoRouteOptions = { service: deps };
  await handleWatermarkedPhotoRoute(fakeReq(url, metodo), res, url, opts);
  return res;
}

const CABECALHOS_404 = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'application/json; charset=utf-8' };

describe('entrega da foto marcada (H-056, fatia 4)', () => {
  it('token adulterado, expirado ou malformado: 404 sem tocar banco, Storage, limite ou compositor', async () => {
    const valido = tokenProf();
    const adulterado = `${valido.slice(0, -2)}${valido.endsWith('A') ? 'B' : 'A'}${valido.slice(-1)}`;
    const expirado = tokenProf('preview', AGORA - 61_000);
    for (const token of [adulterado, expirado, 'abc', '', `${valido}.extra`]) {
      const { deps, log } = montar();
      const r = await entregarFoto(token, deps);
      expect(r).toEqual({ status: 404 });
      expect(log.target).toHaveLength(0);
      expect(log.ownerTarget).toHaveLength(0);
      expect(log.readReduced).toHaveLength(0);
      expect(log.compose).toHaveLength(0);
      expect(log.check).toHaveLength(0);
      expect(log.contadores).toEqual(['token_invalido']);
    }
  });

  it('profissional elegivel: reconfere o acesso, le a reduzida, marca com o FP do emissor e devolve o JPEG', async () => {
    const { deps, log } = montar();
    const r = await entregarFoto(tokenProf('preview'), deps);
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(Buffer.from(r.jpeg).equals(Buffer.from(SAIDA))).toBe(true);
    expect(log.target).toEqual([[PROF, REQ, FOTO, AGORA]]);
    expect(log.ownerTarget).toHaveLength(0);
    expect(log.readReduced).toEqual([FOTO]);
    expect(log.compose).toHaveLength(1);
    expect(log.compose[0]?.variant).toBe('preview');
    expect(log.compose[0]?.label).toBe(watermarkIdOf(PROF, SALT));
    expect(log.check).toEqual([[PROF, AGORA]]);
    expect(log.record).toEqual([[PROF, AGORA]]);
    expect(log.contadores).toEqual(['foto_ok']);
  });

  it('dono: usa o alvo do dono, sem marca (rotulo null) e sem reconferir como profissional', async () => {
    const { deps, log } = montar();
    const r = await entregarFoto(tokenDono('full'), deps);
    expect(r.status).toBe(200);
    expect(log.ownerTarget).toEqual([[DONO, REQ, FOTO]]);
    expect(log.target).toHaveLength(0);
    expect(log.compose[0]?.label).toBeNull();
    expect(log.compose[0]?.variant).toBe('full');
  });

  it('reconferencia (A-3): acesso negado no banco na hora da entrega = 404, nada lido nem renderizado', async () => {
    const { deps, log } = montar({ alvo: null });
    const r = await entregarFoto(tokenProf(), deps);
    expect(r).toEqual({ status: 404 });
    expect(log.readReduced).toHaveLength(0);
    expect(log.compose).toHaveLength(0);
    expect(log.contadores).toEqual(['foto_404']);
  });

  it('leitura divergente (ausente, tamanho diferente ou sem assinatura JPEG): 503 indisponivel, nada servido', async () => {
    const casos: Array<{ nome: string; reader: ReducedPhotoReaderPort; alvo?: PhotoTarget }> = [
      { nome: 'ausente no bucket', reader: { readReduced: async () => null } },
      {
        nome: 'tamanho declarado diferente',
        reader: { readReduced: async () => FOTO_JPEG },
        alvo: { bytes: FOTO_JPEG.byteLength + 1, width: 1200, height: 900 },
      },
      {
        nome: 'sem assinatura JPEG',
        reader: { readReduced: async () => new Uint8Array([1, 2, 3, 4]) },
        alvo: { bytes: 4, width: 1200, height: 900 },
      },
    ];
    for (const caso of casos) {
      const { deps, log } = montar({ reader: caso.reader, ...(caso.alvo ? { alvo: caso.alvo } : {}) });
      const r = await entregarFoto(tokenProf(), deps);
      expect(r, caso.nome).toEqual({ status: 503, code: 'indisponivel' });
      expect(log.compose, caso.nome).toHaveLength(0);
      expect(log.contadores, caso.nome).toEqual(['leitura_divergente']);
    }
  });

  it('banco ou Storage com erro: 503 indisponivel, sem detalhe e sem renderizar', async () => {
    const semBanco = montar({
      store: {
        list: async () => [],
        target: async () => {
          throw new Error('texto interno do banco');
        },
        ownerList: async () => [],
        ownerTarget: async () => null,
        access: async () => true,
      },
    });
    expect(await entregarFoto(tokenProf(), semBanco.deps)).toEqual({ status: 503, code: 'indisponivel' });
    expect(semBanco.log.compose).toHaveLength(0);
    const semStorage = montar({
      reader: {
        readReduced: async () => {
          throw new Error('chave do bucket');
        },
      },
    });
    expect(await entregarFoto(tokenProf(), semStorage.deps)).toEqual({ status: 503, code: 'indisponivel' });
    expect(semStorage.log.compose).toHaveLength(0);
  });

  it('limite photo_deliver barrado: 429 com a espera, sem banco e sem renderizacao; permitido registra o hit', async () => {
    const barrado = montar({ limite: { decision: 'barrado', retryAfterSeconds: 17 } });
    expect(await entregarFoto(tokenProf(), barrado.deps)).toEqual({ status: 429, retryAfterS: 17 });
    expect(barrado.log.target).toHaveLength(0);
    expect(barrado.log.record).toHaveLength(0);
    expect(barrado.log.compose).toHaveLength(0);
    expect(barrado.log.contadores).toEqual(['foto_429']);
  });

  it('gate cheio (duas vagas tomadas): 503 renderizacao_indisponivel e nenhuma renderizacao', async () => {
    const gate = new ReduceGate({ maxConcurrent: 2, waitMs: 0 });
    await gate.entrar();
    await gate.entrar();
    const { deps, log } = montar({ gate });
    expect(await entregarFoto(tokenProf(), deps)).toEqual({ status: 503, code: 'renderizacao_indisponivel' });
    expect(log.compose).toHaveLength(0);
    expect(log.contadores).toEqual(['foto_503_gate']);
  });

  it('vaga liberada depois de sucesso e depois de falha do compositor', async () => {
    const gate = new ReduceGate({ maxConcurrent: 2, waitMs: 0 });
    const ok = montar({ gate });
    expect((await entregarFoto(tokenProf(), ok.deps)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.emAndamento()).toBe(0);
    const falha = montar({
      gate,
      composer: {
        compose: async () => {
          throw new Error('falha interna do sharp');
        },
      },
    });
    expect(await entregarFoto(tokenProf(), falha.deps)).toEqual({ status: 503, code: 'renderizacao_indisponivel' });
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.emAndamento()).toBe(0);
    expect(falha.log.contadores).toEqual(['foto_503_render']);
  });

  it('compositor sem entrada valida (invalid) = 503 indisponivel; indisponivel = 503 renderizacao_indisponivel', async () => {
    const invalido = montar({ composer: { compose: async () => ({ ok: false, kind: 'invalid' }) } });
    expect(await entregarFoto(tokenProf(), invalido.deps)).toEqual({ status: 503, code: 'indisponivel' });
    const indisponivel = montar({ composer: { compose: async () => ({ ok: false, kind: 'unavailable' }) } });
    expect(await entregarFoto(tokenProf(), indisponivel.deps)).toEqual({
      status: 503,
      code: 'renderizacao_indisponivel',
    });
  });

  it('teto de 5 s: estouro = 503 renderizacao_indisponivel, o sinal de cancelamento sai e a vaga so volta ao fim da conta', async () => {
    expect(RENDER_TIMEOUT_MS).toBe(5000);
    let libera: () => void = () => undefined;
    const travado = new Promise<void>((r) => {
      libera = r;
    });
    let sinal: AbortSignal | undefined;
    const gate = new ReduceGate({ maxConcurrent: 2, waitMs: 0 });
    const { deps, log } = montar({
      gate,
      tempoLimiteMs: 20,
      composer: {
        compose: async (_entrada, opts) => {
          sinal = opts.signal;
          await travado;
          return { ok: true, jpeg: SAIDA };
        },
      },
    });
    expect(await entregarFoto(tokenProf(), deps)).toEqual({ status: 503, code: 'renderizacao_indisponivel' });
    expect(sinal?.aborted).toBe(true);
    expect(gate.emAndamento()).toBe(1);
    libera();
    await new Promise((r) => setTimeout(r, 0));
    expect(gate.emAndamento()).toBe(0);
    expect(log.contadores).toEqual(['foto_503_timeout']);
  });
});

describe('rota GET /v1/media/watermarked-photos/:token', () => {
  it('imagem: cabecalhos exatos da decisao 839 com Cross-Origin-Resource-Policy same-site, sem ETag nem nome', async () => {
    const { deps } = montar();
    const res = await rota(CAMINHO(tokenProf()), deps);
    expect(res.status).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Content-Length': String(SAIDA.byteLength),
    });
    expect(Object.keys(res.headers).map((k) => k.toLowerCase())).not.toContain('etag');
    expect(Object.keys(res.headers).map((k) => k.toLowerCase())).not.toContain('last-modified');
    expect(res.corpo.equals(Buffer.from(SAIDA))).toBe(true);
  });

  it('recusas do token e do acesso devolvem o mesmo 404 (corpo e cabecalhos iguais)', async () => {
    const adulterado = `${tokenProf().slice(0, -3)}AAA`;
    const a = await rota(CAMINHO(adulterado), montar().deps);
    const b = await rota(CAMINHO(tokenProf()), montar({ alvo: null }).deps);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.texto).toBe('{"code":"foto_nao_encontrada"}');
    expect(b.texto).toBe(a.texto);
    expect(a.headers).toEqual(CABECALHOS_404);
    expect(b.headers).toEqual(a.headers);
  });

  it('429 com Retry-After; 503 com codigo fixo e sem texto interno', async () => {
    const limitada = await rota(CAMINHO(tokenProf()), montar({ limite: { decision: 'barrado', retryAfterSeconds: 9 } }).deps);
    expect(limitada.status).toBe(429);
    expect(limitada.headers['Retry-After']).toBe('9');
    expect(limitada.texto).toBe('{"code":"muitas_requisicoes"}');
    const semGate = new ReduceGate({ maxConcurrent: 1, waitMs: 0 });
    await semGate.entrar();
    const cheia = await rota(CAMINHO(tokenProf()), montar({ gate: semGate }).deps);
    expect(cheia.status).toBe(503);
    expect(cheia.texto).toBe('{"code":"renderizacao_indisponivel"}');
    const banco = await rota(
      CAMINHO(tokenProf()),
      montar({
        store: {
          list: async () => [],
          target: async () => {
            throw new Error('segredo do banco');
          },
          ownerList: async () => [],
          ownerTarget: async () => null,
          access: async () => true,
        },
      }).deps,
    );
    expect(banco.status).toBe(503);
    expect(banco.texto).toBe('{"code":"indisponivel"}');
    expect(banco.texto).not.toContain('segredo');
  });

  it('metodo diferente de GET e caminhos fora do formato: 404 uniforme, sem servico', async () => {
    const { deps, log } = montar();
    const post = await rota(CAMINHO(tokenProf()), deps, 'POST');
    expect(post.status).toBe(404);
    expect(post.texto).toBe('{"code":"foto_nao_encontrada"}');
    expect(log.check).toHaveLength(0);
    expect(isWatermarkedPhotoRoute('/v1/media/watermarked-photos/')).toBe(false);
    expect(isWatermarkedPhotoRoute('/v1/media/watermarked-photos/a/b')).toBe(false);
    expect(isWatermarkedPhotoRoute(CAMINHO('abc.def'))).toBe(true);
  });

  it('caso feliz com sharp real: preview do profissional com largura de no maximo 320 e sem EXIF', async () => {
    const { deps } = montar({ composer: new SharpWatermarkComposer() });
    const res = await rota(CAMINHO(tokenProf('preview')), deps);
    expect(res.status).toBe(200);
    const meta = await sharp(res.corpo).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(320);
    expect(meta.exif).toBeUndefined();
  });

  it('caso feliz real do dono em tamanho completo: devolve os bytes reduzidos sem reprocessar', async () => {
    const { deps } = montar({ composer: new SharpWatermarkComposer() });
    const res = await rota(CAMINHO(tokenDono('full')), deps);
    expect(res.status).toBe(200);
    expect(res.corpo.equals(Buffer.from(FOTO_JPEG))).toBe(true);
  });
});

describe('composicao e registro de rotas (regressao)', () => {
  const ambiente = (sem: readonly string[] = []): Record<string, string> => {
    const base: Record<string, string> = {
      DATABASE_URL_APP_SYSTEM: 'postgresql://app_system@exemplo/db',
      WATERMARK_TOKEN_SECRET: SEGREDO,
      WATERMARK_ID_SALT: SALT,
      SUPABASE_URL: 'https://projeto.exemplo.test',
    };
    const [, chave] = MEDIA_ENV_STORAGE;
    base[chave] = 'chave-de-teste-do-storage';
    for (const nome of sem) delete base[nome];
    return base;
  };
  const cliente = (): SqlClient => ({ query: async () => ({ rows: [] }) }) as unknown as SqlClient;

  it('ambiente completo liga a entrega e a lista com o mesmo gate singleton e sem pendencias', () => {
    const a = montarFotosPedido(ambiente(), { abrirCliente: cliente });
    const b = montarFotosPedido(ambiente(), { abrirCliente: cliente });
    expect(a.pendencias).toEqual([]);
    expect(a.options).toBeDefined();
    expect(a.entrega).toBeDefined();
    expect(a.entrega?.service.gate).toBe(b.entrega?.service.gate);
    expect(a.entrega?.service.gate).toBeInstanceOf(ReduceGate);
    expect(a.entrega?.service.composer).toBeInstanceOf(SharpWatermarkComposer);
  });

  it('falta do Storage: as rotas nao ligam e a pendencia leva so o nome', () => {
    const [url] = MEDIA_ENV_STORAGE;
    const m = montarFotosPedido(ambiente([url ?? '']), { abrirCliente: cliente });
    expect(m.options).toBeUndefined();
    expect(m.entrega).toBeUndefined();
    expect(m.pendencias).toEqual([url]);
    expect(JSON.stringify(m.pendencias)).not.toContain(SEGREDO);
  });

  it('rotas de foto e de detalhe continuam separadas (regressao de roteamento)', () => {
    const marca = `/v1/media/watermarked-photos/${tokenProf()}`;
    expect(isWatermarkedPhotoRoute(marca)).toBe(true);
    expect(isPhotoViewRoute(marca)).toBe(false);
    expect(photoViewRoute(marca)).toBeNull();
    expect(isRequestDetailRoute(`/v1/requests/${REQ}`)).toBe(true);
    expect(isRequestDetailRoute(`/v1/professional/requests/${REQ}`)).toBe(true);
    expect(isRequestDetailRoute(marca)).toBe(false);
    expect(isPhotoViewRoute(`/v1/requests/${REQ}/photos`)).toBe(true);
  });

  it('despacho em app.ts: a entrega responde antes do bloco de midia, e sem montagem responde o 404 do rascunho', async () => {
    const token = tokenProf();
    const comMidia = fakeRes();
    const deps = montar().deps;
    await handleRequest(
      fakeReq(CAMINHO(token)),
      comMidia,
      {
        media: {} as never,
        watermarkedPhoto: { service: deps },
      } as unknown as Parameters<typeof handleRequest>[2],
    );
    expect(comMidia.status).toBe(200);
    expect(comMidia.headers['Content-Type']).toBe('image/jpeg');

    const semMontagem = fakeRes();
    await handleRequest(fakeReq(CAMINHO(token)), semMontagem, {} as unknown as Parameters<typeof handleRequest>[2]);
    expect(semMontagem.status).toBe(404);
    expect(semMontagem.texto).toBe(draftNotFound().body);
  });
});
