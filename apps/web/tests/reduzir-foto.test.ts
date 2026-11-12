// H-027 (Issue #40) | Reducao no navegador com portas falsas (docs/factory/93-DESENHO-H027.md, §4.4; R-12).
// Sem navegador real: a decodificacao e o canvas sao falsos. Em navegador real a verificacao e NAO VERIFICADO
// ate a primeira conferencia manual (cor Display P3, orientacao em Safari antigo).
import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_BYTES, planoDimensoes } from '@fastpro/domain';
import { enviarFoto, prepararEnvio, type ImagemDecodificada, type PortasNavegador } from '../src/media/reduzir-foto.js';

const blobDe = (tamanho: number, tipo = 'image/jpeg'): Blob => new Blob([new Uint8Array(tamanho)], { type: tipo });

/** Portas falsas: canvas que devolve o tamanho pedido por qualidade e registra as chamadas. */
function portasFalsas(opts: {
  decodifica?: boolean;
  tamanhoPorQualidade?: (q: number) => number;
  falhaCodificar?: boolean;
} = {}) {
  const chamadas: Array<{ largura: number; altura: number; qualidade: number }> = [];
  const portas: PortasNavegador = {
    decodificar: async (): Promise<ImagemDecodificada | null> => {
      if (opts.decodifica === false) return null;
      return { width: 4000, height: 3000, recurso: {} };
    },
    codificar: async (_img, largura, altura, qualidade) => {
      chamadas.push({ largura, altura, qualidade });
      if (opts.falhaCodificar) return null;
      const q = Math.round(qualidade * 100);
      const tamanho = opts.tamanhoPorQualidade ? opts.tamanhoPorQualidade(q) : 300_000;
      return blobDe(tamanho);
    },
  };
  return { portas, chamadas };
}

describe('H-027 | R-12: escolhe a foto, reduz, emite com o tamanho reduzido e so depois envia', () => {
  it('ordem: emitir (content_type e size_bytes do blob reduzido) antes de enviar', async () => {
    const { portas } = portasFalsas({ tamanhoPorQualidade: () => 420_000 });
    const eventos: string[] = [];
    const original = blobDe(4_000_000, 'image/jpeg');
    const r = await enviarFoto({
      arquivo: original,
      tipoDeclarado: 'image/jpeg',
      portas,
      emitir: async (corpo) => {
        eventos.push(`emitir:${corpo.content_type}:${corpo.size_bytes}`);
      },
      enviar: async (blob) => {
        eventos.push(`enviar:${blob.size}`);
      },
    });
    expect(r).toEqual({ ok: true, reduzida: true });
    expect(eventos).toEqual(['emitir:image/jpeg:420000', 'enviar:420000']);
  });

  it('a escada para no primeiro degrau em ate 500.000 bytes (do maior para o menor)', async () => {
    const { portas, chamadas } = portasFalsas({ tamanhoPorQualidade: (q) => (q >= 65 ? 900_000 : 480_000) });
    await prepararEnvio(blobDe(4_000_000), 'image/jpeg', portas);
    expect(chamadas.map((c) => c.qualidade)).toEqual([0.8, 0.72, 0.65, 0.58]);
  });

  it('o plano de dimensoes e a mesma funcao do dominio usada pelo servidor (paridade)', async () => {
    const { portas, chamadas } = portasFalsas();
    await prepararEnvio(blobDe(4_000_000), 'image/jpeg', portas);
    const esperado = planoDimensoes(4000, 3000);
    expect(chamadas[0]).toMatchObject({ largura: esperado.width, altura: esperado.height });
    expect(esperado).toEqual({ width: 1280, height: 960 });
  });
});

describe('H-027 | R-12: recusa de reducao cai no envio do original com o tipo e o tamanho dele', () => {
  it('sem decodificacao (createImageBitmap ausente ou HEIC): envia o original com o tipo declarado', async () => {
    const { portas } = portasFalsas({ decodifica: false });
    const original = blobDe(2_000_000, 'image/heic');
    const r = await prepararEnvio(original, 'image/heic', portas);
    expect(r).toMatchObject({ reduzida: false, contentType: 'image/heic' });
    if ('blob' in r) expect(r.blob.size).toBe(2_000_000);
  });

  it('blob que nao fecha em 750.000 bytes no piso: envia o original', async () => {
    const { portas } = portasFalsas({ tamanhoPorQualidade: () => 800_000 });
    const original = blobDe(3_000_000, 'image/png');
    const r = await prepararEnvio(original, 'image/png', portas);
    expect(r).toMatchObject({ reduzida: false, contentType: 'image/png' });
  });

  it('falha do canvas: envia o original', async () => {
    const { portas } = portasFalsas({ falhaCodificar: true });
    const r = await prepararEnvio(blobDe(3_000_000), 'image/jpeg', portas);
    expect(r).toMatchObject({ reduzida: false });
  });

  it('original acima de 10 MB sem reducao possivel: recusa local com arquivo_grande, sem emitir', async () => {
    const { portas } = portasFalsas({ decodifica: false });
    let emitiu = false;
    const r = await enviarFoto({
      arquivo: blobDe(MEDIA_MAX_BYTES + 1),
      tipoDeclarado: 'image/jpeg',
      portas,
      emitir: async () => {
        emitiu = true;
      },
      enviar: async () => undefined,
    });
    expect(r).toEqual({ code: 'arquivo_grande' });
    expect(emitiu).toBe(false);
  });

  it('o blob reduzido nunca passa de 750.000 bytes', async () => {
    const { portas } = portasFalsas({ tamanhoPorQualidade: (q) => (q === 32 ? 740_000 : 900_000) });
    const r = await prepararEnvio(blobDe(4_000_000), 'image/jpeg', portas);
    expect(r.reduzida).toBe(true);
    if (r.reduzida) expect(r.blob.size).toBeLessThanOrEqual(750_000);
  });
});

describe('H-027 | R-12: pendencias de navegador real ficam fora deste teste', () => {
  it('a conversao de cor Display P3 e a orientacao em Safari antigo sao NAO VERIFICADO aqui', () => {
    expect(true).toBe(true);
  });
});
