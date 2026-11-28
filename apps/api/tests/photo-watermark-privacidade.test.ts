// H-056 (Issue 69) | Testes negativos de persistencia e privacidade (docs/factory/167-DESENHO-H056.md, §6, §8 fatia 5).
// Prova: nenhuma tabela ou log por foto criado nas migracoes da H-056; nenhum codigo de escrita no caminho da entrega
// (fonte e execucao); o leitor do Storage so le (GET em p/<uuid>); respostas sem PII, sem token e sem identificadores;
// nenhum console por foto; JPEG sem EXIF. Sem rede e sem banco.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-056');
};

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createPhotoTokenCodec, watermarkIdOf, type PhotoViewStorePort } from '@fastpro/domain';
import { SupabaseReducedPhotoReader } from '@fastpro/db';
import { entregarFoto, type ContadorEntrega, type WatermarkDeliveryDeps } from '../src/requests/photo-watermark-service.js';
import { handleWatermarkedPhotoRoute } from '../src/media/watermarked-photo-route.js';
import { ReduceGate } from '../src/media/reduce-gate.js';
import { SharpWatermarkComposer } from '../src/media/watermark-composer-sharp.js';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const SEGREDO = 'segredo-de-teste-h056-com-trinta-e-dois-caracteres';
const SALT = 'salt-de-teste-h056-com-trinta-e-dois-caracteres-x';
const PROF = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const FOTO = '33333333-3333-4333-8333-333333333333';
const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0);
const CODEC = createPhotoTokenCodec(SEGREDO);
/** Arquivos do caminho de entrega e da leitura da foto (fonte). Nenhum deles pode escrever nada. */
const FONTES_DA_ENTREGA = [
  'apps/api/src/requests/photo-watermark-service.ts',
  'apps/api/src/media/watermarked-photo-route.ts',
  'apps/api/src/requests/photo-view-service.ts',
  'apps/api/src/requests/photo-view-route.ts',
  'apps/api/src/media/watermark-composer-sharp.ts',
  'packages/domain/src/media/watermark.ts',
  'packages/db/src/photo-view-store.ts',
];
const PADRAO_PROIBIDO =
  /writeFile|createWriteStream|appendFile|putReduced|removeReduced|removeOriginal|insert\s+into|delete\s+from|update\s+app\.|method:\s*'(PUT|POST|DELETE|PATCH)'|console\.|logger\./i;

let FOTO_JPEG: Uint8Array;

beforeAll(async () => {
  FOTO_JPEG = new Uint8Array(
    await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 90, g: 140, b: 190 } } })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lerRaiz(relativo: string): string {
  return readFileSync(`${RAIZ}${relativo}`, 'utf8');
}

function fakeReq(url: string): IncomingMessage {
  return { method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { status: number; headers: Record<string, string | number>; texto: string; corpo: Buffer } {
  const r = {
    status: 0,
    headers: {} as Record<string, string | number>,
    texto: '',
    corpo: Buffer.alloc(0),
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
  return r as unknown as ServerResponse & typeof r;
}

function depsDe(opcoes: { store?: PhotoViewStorePort; reader?: WatermarkDeliveryDeps['reader']; contadores?: ContadorEntrega[] } = {}): WatermarkDeliveryDeps {
  const alvo = { bytes: FOTO_JPEG.byteLength, width: 1200, height: 900 };
  return {
    store: opcoes.store ?? {
      list: async () => [],
      target: async () => alvo,
      ownerList: async () => [],
      ownerTarget: async () => alvo,
      access: async () => true,
    },
    reader: opcoes.reader ?? { readReduced: async () => FOTO_JPEG },
    composer: new SharpWatermarkComposer(),
    gate: new ReduceGate({ maxConcurrent: 2, waitMs: 0 }),
    codec: CODEC,
    limite: { check: async () => ({ decision: 'permitido' }), record: async () => {} },
    idSalt: SALT,
    clock: { nowMs: () => AGORA },
    contador: (nome) => opcoes.contadores?.push(nome),
  };
}

describe('persistencia (H-056, fatia 5)', () => {
  it('migracoes da H-056: nenhuma tabela criada e nenhuma escrita de dados (so funcoes de leitura)', () => {
    const pasta = `${RAIZ}supabase/migrations`;
    const arquivos = readdirSync(pasta).filter((n) => /^2026112050|^2026112051/.test(n));
    expect(arquivos.length).toBeGreaterThanOrEqual(2);
    for (const nome of arquivos) {
      const sql = readFileSync(`${pasta}/${nome}`, 'utf8').toLowerCase();
      expect(sql, nome).not.toMatch(/create\s+table/);
      expect(sql, nome).not.toMatch(/\binsert\s+into/);
      expect(sql, nome).not.toMatch(/\bdelete\s+from/);
      expect(sql, nome).not.toMatch(/\bupdate\s+app\./);
      expect(sql, nome).not.toMatch(/alter\s+table/);
    }
  });

  it('codigo da entrega e da leitura: nenhuma escrita em disco, Storage, banco ou log por foto', () => {
    for (const arquivo of FONTES_DA_ENTREGA) {
      const fonte = lerRaiz(arquivo);
      expect(fonte.match(PADRAO_PROIBIDO), arquivo).toBeNull();
    }
  });

  it('leitor do bucket reduzido so le: unico metodo publico e readReduced', () => {
    const leitor = new SupabaseReducedPhotoReader({ baseUrl: 'https://exemplo.test', serviceKey: 'x' });
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(leitor)).sort();
    expect(metodos).toEqual(['constructor', 'readReduced']);
  });

  it('execucao: o Storage recebe so GET em p/<uuid> e nenhuma escrita durante a entrega', async () => {
    const chamadas: Array<{ url: string; metodo: string }> = [];
    const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), metodo: init?.method ?? 'GET' });
      return new Response(FOTO_JPEG, { status: 200 });
    }) as unknown as typeof fetch;
    const leitor = new SupabaseReducedPhotoReader({ baseUrl: 'https://exemplo.test', serviceKey: 'x', fetchImpl: fetchFalso });
    const r = await entregarFoto(CODEC.sign({ mode: 'professional', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'full' }, AGORA), depsDe({ reader: leitor }));
    expect(r.status).toBe(200);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.metodo).toBe('GET');
    expect(chamadas[0]?.url).toMatch(/\/storage\/v1\/object\/request-photos\/p\/[0-9a-f-]+$/);
    expect(chamadas[0]?.url).not.toContain('/d/');
  });
});

describe('privacidade das respostas (H-056, fatia 5)', () => {
  it('respostas de erro trazem so o codigo; nenhum identificador, token ou segredo aparece no corpo', async () => {
    const token = CODEC.sign({ mode: 'professional', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'preview' }, AGORA);
    const cenarios: Array<{ nome: string; deps: WatermarkDeliveryDeps; url: string }> = [
      { nome: 'token invalido', deps: depsDe(), url: `/v1/media/watermarked-photos/${token.slice(0, -4)}AAAA` },
      {
        nome: 'negado no banco',
        deps: depsDe({ store: { list: async () => [], target: async () => null, ownerList: async () => [], ownerTarget: async () => null, access: async () => false } }),
        url: `/v1/media/watermarked-photos/${token}`,
      },
      {
        nome: 'leitura ausente',
        deps: depsDe({ reader: { readReduced: async () => null } }),
        url: `/v1/media/watermarked-photos/${token}`,
      },
    ];
    for (const c of cenarios) {
      const res = fakeRes();
      await handleWatermarkedPhotoRoute(fakeReq(c.url), res, c.url, { service: c.deps });
      expect(res.status, c.nome).toBeGreaterThanOrEqual(400);
      expect(Object.keys(JSON.parse(res.texto)), c.nome).toHaveLength(1);
      for (const proibido of [PROF, REQ, FOTO, token, SEGREDO, SALT, watermarkIdOf(PROF, SALT)]) {
        expect(res.texto.includes(proibido), `${c.nome}: ${proibido.slice(0, 6)}`).toBe(false);
      }
    }
  });

  it('imagem: cabecalhos sem identificador, sem nome de arquivo e sem ETag; a marca traz so o rotulo FP', async () => {
    const token = CODEC.sign({ mode: 'professional', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'preview' }, AGORA);
    const res = fakeRes();
    await handleWatermarkedPhotoRoute(fakeReq(`/v1/media/watermarked-photos/${token}`), res, `/v1/media/watermarked-photos/${token}`, {
      service: depsDe(),
    });
    expect(res.status).toBe(200);
    const todos = JSON.stringify(res.headers);
    for (const proibido of [PROF, REQ, FOTO, token, SALT]) expect(todos.includes(proibido)).toBe(false);
    expect(res.headers['Content-Disposition']).toBe('inline');
    expect(Object.keys(res.headers).map((k) => k.toLowerCase())).not.toContain('etag');
    const meta = await sharp(res.corpo).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('nenhum console por foto: a entrega completa (sucesso e erros) nao registra nada no console', async () => {
    const espiao = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    };
    const contadores: ContadorEntrega[] = [];
    const ok = CODEC.sign({ mode: 'professional', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'preview' }, AGORA);
    await entregarFoto(ok, depsDe({ contadores }));
    await entregarFoto('token-invalido', depsDe({ contadores }));
    expect(espiao.log).not.toHaveBeenCalled();
    expect(espiao.info).not.toHaveBeenCalled();
    expect(espiao.warn).not.toHaveBeenCalled();
    expect(espiao.error).not.toHaveBeenCalled();
    expect(contadores).toEqual(['foto_ok', 'token_invalido']);
  });

  it('contadores operacionais tem nomes fixos e nunca recebem identificador', async () => {
    const contadores: ContadorEntrega[] = [];
    const token = CODEC.sign({ mode: 'owner', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'full' }, AGORA);
    await entregarFoto(token, depsDe({ contadores }));
    await entregarFoto(`${token}x`, depsDe({ contadores }));
    const permitidos = new Set<string>([
      'foto_ok',
      'foto_404',
      'foto_429',
      'foto_503_gate',
      'foto_503_timeout',
      'foto_503_render',
      'foto_503_indisponivel',
      'leitura_divergente',
      'token_invalido',
    ]);
    for (const nome of contadores) {
      expect(permitidos.has(nome)).toBe(true);
      expect(nome).not.toContain(PROF);
      expect(nome).not.toContain(FOTO);
    }
  });

  it('dono em tamanho completo devolve os bytes exatamente como foram lidos (sem EXIF novo)', async () => {
    const token = CODEC.sign({ mode: 'owner', photoId: FOTO, requestId: REQ, userId: PROF, variant: 'full' }, AGORA);
    const r = await entregarFoto(token, depsDe());
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(Buffer.from(r.jpeg).equals(Buffer.from(FOTO_JPEG))).toBe(true);
  });
});
