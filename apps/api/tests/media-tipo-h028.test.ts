// H-028 (Issue #41) | Tipo pelo conteudo, assinatura antes do decodificador e recusa sem eco (docs/factory/96-DESENHO-H028.md,
// §2.3, §5, §6 e X-07 a X-12; CA-04 a CA-09). Servico da reducao com as linhas e o Storage falsos da #40
// (media-fakes-h027.ts). Desvio do desenho §7: X-07 a X-11 rodam no servico, nao pela rota HTTP; a emissao com tipo
// declarado HEIC ou ausente (415) continua coberta por media-route.test.ts (M-05), sem alteracao.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-028');
};

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DRAFT_HEADERS,
  MEDIA_REJECT_CODES,
  detectarTipoImagem,
  type ImageReducerPort,
  type MediaStorePort,
} from '@fastpro/domain';
import { ReduceCounters, reduzirFoto, type ReduceDeps } from '../src/media/media-reduce-service.js';
import { ReduceGate } from '../src/media/reduce-gate.js';
import { SharpImageReducer } from '../src/media/image-reducer-sharp.js';
import { FakeReducer, MemReduceRows, MemReduceStorage, type LinhaR } from './media-fakes-h027.js';
import {
  SENTINELA,
  fotoJpeg,
  fotoPng,
  fotoWebp,
  vetoresNaoAceitos,
} from './helpers/construtores-imagem.js';

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const MIN = 60_000;
const HASH = 'a'.repeat(64);
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AZUL = { r: 20, g: 60, b: 200 };
const CORPO_FIXO = '{"code":"imagem_invalida"}';

function linha(id: string, extra: Partial<LinhaR> = {}): LinhaR {
  return {
    id,
    draftHash: HASH,
    status: 'pending',
    confirmedMs: T0,
    purgeMs: null,
    createdMs: T0,
    attempts: 0,
    leaseMs: null,
    rejectCode: null,
    originalRemovedMs: null,
    readyBytes: null,
    readyWidth: null,
    readyHeight: null,
    readyMs: null,
    ...extra,
  };
}

/** Servico montado com linhas, Storage e portas falsos da #40; o redutor pode ser o falso ou o real. */
function montar(reducer: ImageReducerPort = new FakeReducer()) {
  const diario: string[] = [];
  const linhas = new Map<string, LinhaR>();
  const rows = new MemReduceRows(linhas, () => true, diario);
  const store = {
    reduceBegin: async (...a: Parameters<MemReduceRows['reduceBegin']>) => rows.reduceBegin(...a),
    reduceDone: async (...a: Parameters<MemReduceRows['reduceDone']>) => rows.reduceDone(...a),
    reduceReject: async (...a: Parameters<MemReduceRows['reduceReject']>) =>
      rows.reduceReject(...a),
    reduceRelease: async (...a: Parameters<MemReduceRows['reduceRelease']>) =>
      rows.reduceRelease(...a),
    originalRemoved: async (...a: Parameters<MemReduceRows['originalRemoved']>) =>
      rows.originalRemoved(...a),
    originalCleanupList: async (n: number) => rows.originalCleanupList(n),
  } as unknown as MediaStorePort;
  const storage = new MemReduceStorage(diario);
  const gate = new ReduceGate({ waitMs: 2000 });
  const contadores = new ReduceCounters();
  const deps: ReduceDeps = { store, storage, reducer, gate, contadores };
  const reduzir = (id: string) => reduzirFoto({ id, hash: HASH }, deps, T0 + MIN);
  return { deps, linhas, diario, storage, contadores, gate, reduzir };
}

/** Foto enviada e confirmada, com o conteudo informado como original. */
function fotoEnviada(m: ReturnType<typeof montar>, n: number, conteudo: Uint8Array): string {
  const id = uuid(n);
  m.linhas.set(id, linha(id));
  m.storage.originais.set(id, conteudo);
  return id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('H-028 | X-07 o conteudo decide o tipo; nome e tipo declarado nao entram (CA-04)', () => {
  const formatos: [string, () => Promise<Buffer>][] = [
    ['JPEG', () => fotoJpeg(1600, 1200, AZUL)],
    ['PNG (tipo declarado image/jpeg, nome .jpg, sem efeito)', () => fotoPng(1600, 1200, AZUL)],
    ['WebP (tipo declarado image/jpeg, nome .jpg, sem efeito)', () => fotoWebp(1600, 1200, AZUL)],
  ];

  it.each(formatos)(
    '%s: reducao real entrega JPEG com assinatura FF D8 FF e sharp lendo format jpeg',
    async (_nome, montarFoto) => {
      const m = montar(new SharpImageReducer());
      const id = fotoEnviada(m, 1, new Uint8Array(await montarFoto()));
      const r = await m.reduzir(id);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ id, status: 'ready', confirmed: true });

      const saida = Buffer.from(m.storage.reduzidas.get(id) ?? new Uint8Array(0));
      expect(saida.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
      expect((await sharp(saida).metadata()).format).toBe('jpeg');
    },
  );

  it('teste estatico: o servico e o redutor nao leem tipo declarado, mime ou nome (CA-04)', () => {
    for (const arquivo of [
      '../src/media/media-reduce-service.ts',
      '../src/media/image-reducer-sharp.ts',
    ]) {
      const fonte = readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), 'utf8');
      expect(fonte).not.toMatch(/content_type|contentType|mime|filename/i);
    }
  });
});

describe('H-028 | X-08 assinatura antes do decodificador (CA-05)', () => {
  it.each(vetoresNaoAceitos().map((v) => [v.nome, v.bytes] as const))(
    '%s: recusado pela assinatura, o redutor nao e chamado e o original sai',
    async (_nome, bytes) => {
      const reducer = new FakeReducer();
      const m = montar(reducer);
      const id = fotoEnviada(m, 2, new Uint8Array(bytes));
      const r = await m.reduzir(id);
      expect(r.status).toBe(422);
      expect(r.body).toBe(CORPO_FIXO);
      expect(reducer.chamadas).toBe(0);
      expect(m.linhas.get(id)?.status).toBe('rejected');
      expect(m.storage.originais.has(id)).toBe(false);
      expect(m.diario).not.toContain('putReduced');
    },
  );

  it('PNG com assinatura e IHDR bons e corpo truncado passa pela assinatura e e recusado pela segunda camada (CA-05)', async () => {
    const png = await fotoPng(64, 64, AZUL);
    const cortado = new Uint8Array(png.subarray(0, Math.floor(png.length / 2)));
    expect(detectarTipoImagem(cortado)).toBe('png');

    const m = montar(new SharpImageReducer());
    const id = fotoEnviada(m, 3, cortado);
    const r = await m.reduzir(id);
    expect(r.status).toBe(422);
    expect(r.body).toBe(CORPO_FIXO);
    expect(m.diario).not.toContain('putReduced');
  });

  it('teste estatico: a checagem de assinatura aparece antes da chamada ao redutor em reduzirTentativa', () => {
    const fonte = readFileSync(
      fileURLToPath(new URL('../src/media/media-reduce-service.ts', import.meta.url)),
      'utf8',
    );
    const posAssinatura = fonte.indexOf('detectarTipoImagem(');
    const posRedutor = fonte.indexOf('deps.reducer.reduce(');
    expect(posAssinatura).toBeGreaterThan(0);
    expect(posRedutor).toBeGreaterThan(posAssinatura);
    expect(fonte).not.toMatch(/from ['"]sharp['"]/);
  });
});

describe('H-028 | X-09 HEIC e HEIF pelo conteudo, com tipo declarado JPEG e nome .jpg (CA-06)', () => {
  const heif = vetoresNaoAceitos().filter(
    (v) => v.nome.startsWith('HEIC') || v.nome.startsWith('HEIF'),
  );

  it('sao cinco vetores (heic, heix, hevc, mif1, msf1)', () => {
    expect(heif.map((v) => v.nome)).toHaveLength(5);
  });

  it.each(heif.map((v) => [v.nome, v.bytes] as const))(
    '%s: 422 imagem_invalida, rejected, original removido, sem objeto reduzido e finalize repetido sem nova leitura',
    async (_nome, bytes) => {
      const reducer = new FakeReducer();
      const m = montar(reducer);
      const id = fotoEnviada(m, 4, new Uint8Array(bytes));

      const primeiro = await m.reduzir(id);
      expect(primeiro.status).toBe(422);
      expect(primeiro.body).toBe(CORPO_FIXO);
      expect(m.linhas.get(id)).toMatchObject({ status: 'rejected', rejectCode: 'imagem_invalida' });
      expect(m.storage.originais.has(id)).toBe(false);
      expect(m.storage.reduzidas.size).toBe(0);
      expect(m.diario).not.toContain('putReduced');

      const leiturasAntes = m.storage.chamadasLeitura;
      const repetido = await m.reduzir(id);
      expect(repetido.status).toBe(422);
      expect(repetido.body).toBe(CORPO_FIXO);
      expect(m.storage.chamadasLeitura).toBe(leiturasAntes);
      expect(reducer.chamadas).toBe(0);
    },
  );
});

describe('H-028 | X-10 lista fechada: cada tipo recusado sai como imagem_invalida e libera a vaga (CA-07)', () => {
  it.each(vetoresNaoAceitos().map((v) => [v.nome, v.bytes] as const))(
    '%s: 422, rejected, original removido, nenhum objeto reduzido e vaga de reducao livre',
    async (_nome, bytes) => {
      const m = montar();
      const id = fotoEnviada(m, 5, new Uint8Array(bytes));
      const r = await m.reduzir(id);
      expect(r.status).toBe(422);
      expect(m.linhas.get(id)?.status).toBe('rejected');
      expect(m.storage.originais.has(id)).toBe(false);
      expect(m.storage.reduzidas.size).toBe(0);

      // A vaga volta: as quatro vagas da instancia podem ser tomadas de novo logo depois da recusa.
      const vagas = [];
      for (let i = 0; i < 4; i++) vagas.push(await m.gate.entrar());
      expect(vagas.every((v) => v !== null)).toBe(true);
      for (const v of vagas) v?.sair();
    },
  );
});

describe('H-028 | X-11 recusa sem eco: resposta, log e contadores sem nome, tipo, bytes ou caminho (CA-08)', () => {
  it('captura respostas, console, stdout e stderr dos casos de recusa com sentinelas injetadas no conteudo', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(' ')),
    );
    vi.spyOn(console, 'info').mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(' ')),
    );
    vi.spyOn(console, 'warn').mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(' ')),
    );
    vi.spyOn(console, 'error').mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(' ')),
    );
    vi.spyOn(process.stdout, 'write').mockImplementation(
      (s: unknown) => void logs.push(String(s)) as unknown as true,
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (s: unknown) => void logs.push(String(s)) as unknown as true,
    );

    const sentinelas = [SENTINELA.nome, SENTINELA.cabecalho, SENTINELA.exif];
    const respostas: { status: number; headers: Record<string, unknown>; body: string }[] = [];
    const contadores: Record<string, number>[] = [];
    const reducer = new FakeReducer();

    // Vetores com menos de 4 bytes nao recebem sentinela: FF D8 FF seguido de qualquer marcador ja e assinatura JPEG
    // pela regra de 96 §2.2 (limitacao 4 de 96 §8); colar texto ali mudaria o caso, nao a prova.
    const casos: Uint8Array[] = vetoresNaoAceitos().map(
      (v) =>
        new Uint8Array(
          v.bytes.length < 4
            ? v.bytes
            : Buffer.concat([v.bytes, Buffer.from(sentinelas.join(' '), 'ascii')]),
        ),
    );
    let n = 100;
    for (const conteudo of casos) {
      const m = montar(reducer);
      const id = fotoEnviada(m, n++, conteudo);
      const r = await m.reduzir(id);
      respostas.push({ status: r.status, headers: r.headers, body: r.body });
      contadores.push(m.contadores.instantanea());
    }

    expect(respostas.map((r) => `${r.status}:${r.body}`)).toEqual(
      respostas.map(() => `422:${CORPO_FIXO}`),
    );
    for (const r of respostas) {
      expect(Object.keys(r.headers).sort()).toEqual(Object.keys(DRAFT_HEADERS).sort());
    }
    expect(logs).toEqual([]);

    const texto = JSON.stringify({ respostas, contadores }) + logs.join('');
    for (const s of sentinelas) expect(texto).not.toContain(s);
    expect(texto).not.toMatch(/heic|heif|avif|gif|svg|tiff|pdf|ftyp|image\/|rua-das|sentinela/i);
    expect(texto).not.toMatch(/\bd\/|\bp\//);
    const chaves = new Set(contadores.flatMap((c) => Object.keys(c)));
    for (const k of chaves) expect(k).toMatch(/^recusa_(assinatura|imagem_invalida)$/);
  });
});

describe('H-028 | X-12 sem contrato novo (CA-09)', () => {
  it('MEDIA_REJECT_CODES continua com os quatro codigos da #40 e nenhum novo', () => {
    expect([...MEDIA_REJECT_CODES]).toEqual([
      'imagem_invalida',
      'imagem_grande_demais',
      'nao_cabe_no_limite',
      'nao_processavel',
    ]);
  });
});

describe('H-028 | X-01 detectarTipoImagem: funcao pura, sem imports (CA-05)', () => {
  it('o arquivo image-type.ts do dominio nao importa modulo nenhum (sem sharp, sem I/O)', () => {
    const fonte = readFileSync(
      fileURLToPath(new URL('../../../packages/domain/src/media/image-type.ts', import.meta.url)),
      'utf8',
    );
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\(/);
    expect(fonte).not.toMatch(/\bsharp\b/);
  });
});
