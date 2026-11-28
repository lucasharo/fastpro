// H-027 (Issue #40) | Dominio da reducao: plano de dimensoes, escada de qualidade, chave reduzida e expurgo com a
// versao reduzida (docs/factory/93-DESENHO-H027.md, §4.2, §4.4, §5.3; R-01 parte logica, R-15 parte do expurgo).
import { describe, expect, it } from 'vitest';
import {
  MEDIA_REDUCE_CEILING_BYTES,
  MEDIA_REDUCE_TARGET_BYTES,
  escolherSaidaJpeg,
  isMediaRejectCode,
  mediaReducedKey,
  planoDimensoes,
  sweepQuarantine,
  type MediaReduceBeginResult,
  type MediaStorePort,
} from '../src/index.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('H-027 | plano de dimensoes (CA-01, CA-12)', () => {
  it('foto menor que 1.280 px nao e ampliada', () => {
    expect(planoDimensoes(800, 600)).toEqual({ width: 800, height: 600 });
    expect(planoDimensoes(1280, 1280)).toEqual({ width: 1280, height: 1280 });
  });

  it('maior lado vira 1.280 e a proporcao e preservada', () => {
    expect(planoDimensoes(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(planoDimensoes(3000, 4000)).toEqual({ width: 960, height: 1280 });
    expect(planoDimensoes(8000, 6000)).toEqual({ width: 1280, height: 960 });
  });

  it('dimensoes invalidas lancam erro sem eco', () => {
    expect(() => planoDimensoes(0, 10)).toThrow('dimensoes_invalidas');
    expect(() => planoDimensoes(10.5, 10)).toThrow('dimensoes_invalidas');
  });
});

describe('H-027 | escada de qualidade (decisao 83)', () => {
  const fabrica = (tamanhos: Record<number, number>) => async (q: number) => ({ bytes: tamanhos[q] ?? 0, q });

  it('para no primeiro degrau em ate 500.000 bytes', async () => {
    const r = await escolherSaidaJpeg(fabrica({ 80: 900_000, 72: 700_000, 65: 480_000, 58: 300_000 }));
    expect(r).toMatchObject({ ok: true, qualidade: 65 });
  });

  it('piso q32 entre 500.000 e 750.000 bytes e aceito como teto', async () => {
    const r = await escolherSaidaJpeg(fabrica({ 80: 900_000, 72: 900_000, 65: 900_000, 58: 900_000, 50: 900_000, 44: 900_000, 38: 900_000, 32: 600_000 }));
    expect(r).toMatchObject({ ok: true, qualidade: 32 });
  });

  it('redutor falso que devolve 800 KB sempre: nao_cabe_no_limite (R-01)', async () => {
    const r = await escolherSaidaJpeg(async () => ({ bytes: 800_000 }));
    expect(r).toEqual({ ok: false, code: 'nao_cabe_no_limite' });
  });

  it('tenta os oito degraus, do maior para o menor', async () => {
    const visto: number[] = [];
    await escolherSaidaJpeg(async (q) => {
      visto.push(q);
      return { bytes: MEDIA_REDUCE_CEILING_BYTES + 1 };
    });
    expect(visto).toEqual([80, 72, 65, 58, 50, 44, 38, 32]);
    expect(MEDIA_REDUCE_TARGET_BYTES).toBeLessThan(MEDIA_REDUCE_CEILING_BYTES);
  });
});

describe('H-027 | chave reduzida e codigos (CA-02, CA-13)', () => {
  it('chave p/<uuid>, sem extensao nem nome original', () => {
    expect(mediaReducedKey(UUID)).toBe(`p/${UUID}`);
    expect(() => mediaReducedKey('rua-das-flores-12.jpg')).toThrow('chave_midia_invalida');
  });

  it('so os quatro codigos fixos de recusa', () => {
    for (const c of ['imagem_invalida', 'imagem_grande_demais', 'nao_cabe_no_limite', 'nao_processavel']) {
      expect(isMediaRejectCode(c)).toBe(true);
    }
    expect(isMediaRejectCode('texto livre')).toBe(false);
  });
});

describe('H-027 | expurgo remove a versao reduzida e recolhe sobras (R-15, parte do expurgo)', () => {
  it('remove original e reduzido de cada id marcado, depois apaga a linha; recolhe original de ready', async () => {
    const quarentena: string[] = [];
    const reduzidos: string[] = [];
    const recolhidos: string[] = [];
    const store = {
      sweep: async () => [UUID],
      purgeDone: async (ids: readonly string[]) => ids.length,
      known: async () => [],
      originalCleanupList: async () => ['00000000-0000-4000-8000-000000000009'],
      originalRemoved: async (id: string) => {
        recolhidos.push(id);
        return true;
      },
    } as unknown as Pick<MediaStorePort, 'sweep' | 'purgeDone' | 'known'> & Partial<Pick<MediaStorePort, 'originalRemoved' | 'originalCleanupList'>>;
    const r = await sweepQuarantine({
      store,
      storage: {
        remove: async (key: string) => {
          quarentena.push(key);
        },
        listOlderThan: async () => [],
      },
      reduzidos: {
        removeReduced: async (id: string) => {
          reduzidos.push(id);
        },
      },
      nowMs: () => Date.UTC(2026, 10, 12),
    });
    expect(quarentena).toEqual([`d/${UUID}`, 'd/00000000-0000-4000-8000-000000000009']);
    expect(reduzidos).toEqual([UUID]);
    expect(recolhidos).toEqual(['00000000-0000-4000-8000-000000000009']);
    expect(r).toMatchObject({ marcados: 1, removidos: 1, falhas: 0, originaisLimpos: 1 });
  });

  it('falha ao remover o reduzido deixa a linha marcada (nao conta como removida)', async () => {
    let purgeChamado = false;
    const store = {
      sweep: async () => [UUID],
      purgeDone: async () => {
        purgeChamado = true;
        return 0;
      },
      known: async () => [],
    };
    const r = await sweepQuarantine({
      store,
      storage: { remove: async () => undefined, listOlderThan: async () => [] },
      reduzidos: {
        removeReduced: async () => {
          throw new Error('falha simulada');
        },
      },
      nowMs: () => Date.UTC(2026, 10, 12),
    });
    expect(purgeChamado).toBe(false);
    expect(r.falhas).toBe(1);
  });
});

/** Tipo de referencia para a forma do resultado de begin (compilacao do teste). */
export type _ReferenciaBegin = MediaReduceBeginResult;
