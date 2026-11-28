// H-056 (Issue #69) | Compositor real da marca d'agua com sharp (167-DESENHO-H056.md, §4.2, A-5, A-7, decisao 843).
// Unico modulo da entrega que monta a imagem marcada. A carga e preguicosa: se sharp nao carregar, devolve
// 'unavailable' (503 na rota). Nenhuma mensagem de biblioteca sai daqui. Nunca grava nada no Storage nem em disco.
import {
  PHOTO_VARIANT_MAX_WIDTH,
  buildWatermarkSvg,
  type WatermarkComposerPort,
} from '@fastpro/domain';

type SharpFn = typeof import('sharp').default;

/** Lado maximo aceito na entrada (a foto ja chega reduzida a 1280 px; limite do sharp, A-7). */
const ENTRADA_MAX_PIXELS = 1280 * 1280;
/** Qualidade e subamostragem fixas (decisao 843). Sem withMetadata: EXIF e ICC saem na saida. */
const OPCOES_JPEG = { quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' } as const;

let carga: Promise<SharpFn | null> | null = null;

/** Carrega sharp uma vez, com uma thread e sem cache de operacoes (mesmo ajuste do redutor). */
function carregarSharp(): Promise<SharpFn | null> {
  carga ??= import('sharp').then(
    (m) => {
      const s = m.default;
      s.concurrency(1);
      s.cache(false);
      return s;
    },
    () => null,
  );
  return carga;
}

export class SharpWatermarkComposer implements WatermarkComposerPort {
  async compose(
    input: Uint8Array,
    opts: { readonly variant: 'preview' | 'full'; readonly label: string | null; readonly signal: AbortSignal },
  ): Promise<{ ok: true; jpeg: Uint8Array } | { ok: false; kind: 'unavailable' | 'invalid' }> {
    if (opts.signal.aborted) return { ok: false, kind: 'unavailable' };
    const sharp = await carregarSharp();
    if (sharp === null) return { ok: false, kind: 'unavailable' };

    const entrada = Buffer.from(input);
    const larguraMaxima = PHOTO_VARIANT_MAX_WIDTH[opts.variant];
    try {
      const meta = await sharp(entrada, { failOn: 'error', limitInputPixels: ENTRADA_MAX_PIXELS })
        .metadata()
        .catch(() => null);
      if (meta === null || meta.format !== 'jpeg' || !meta.width || !meta.height) {
        return { ok: false, kind: 'invalid' };
      }

      // Dono em tamanho completo: a foto ja e a reduzida, sem marca e sem reprocessar (§4.2).
      if (opts.label === null && opts.variant === 'full') {
        return { ok: true, jpeg: new Uint8Array(input) };
      }

      // Redimensiona sem ampliar, em PNG intermediario (sem perda), para conhecer as dimensoes finais.
      const redimensionada = await sharp(entrada, { failOn: 'error', limitInputPixels: ENTRADA_MAX_PIXELS })
        .resize({ width: larguraMaxima, withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      if (opts.signal.aborted) return { ok: false, kind: 'unavailable' };

      let pipeline = sharp(redimensionada.data);
      if (opts.label !== null) {
        const { width, height } = redimensionada.info;
        const svg = buildWatermarkSvg(width, height, opts.label);
        pipeline = pipeline.composite([{ input: Buffer.from(svg, 'utf8'), top: 0, left: 0 }]);
      }
      const saida = await pipeline.jpeg(OPCOES_JPEG).toBuffer();
      if (opts.signal.aborted) return { ok: false, kind: 'unavailable' };
      return { ok: true, jpeg: new Uint8Array(saida) };
    } catch {
      return { ok: false, kind: 'unavailable' };
    }
  }
}
