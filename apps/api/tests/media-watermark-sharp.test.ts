// H-056 (Issue #69) | Compositor real da marca com sharp, medido nos pixels (167-DESENHO-H056.md, §7, fatia 2).
// Imagens geradas dentro do teste (sem foto real e sem binario versionado). Sem rede.
// Prova: JPEG valido nas duas variantes, limites de largura e de bytes, marca visivel sobre fundo claro e escuro,
// sem metadados (EXIF) na saida, sem marca para o dono, recusa de entrada que nao e JPEG, e cancelamento.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-056');
};

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SharpWatermarkComposer } from '../src/media/watermark-composer-sharp.js';

const composer = new SharpWatermarkComposer();
const sinal = (): AbortSignal => new AbortController().signal;
const ROTULO = 'FP-ABCD-EFGH';

async function fundo(cor: number, largura = 1280, altura = 960): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: { r: cor, g: cor, b: cor } } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function pixels(jpeg: Uint8Array): Promise<{ data: Buffer; largura: number; altura: number }> {
  const { data, info } = await sharp(Buffer.from(jpeg)).raw().toBuffer({ resolveWithObject: true });
  return { data, largura: info.width, altura: info.height };
}

/** Diferenca media absoluta por canal entre duas imagens de mesmo tamanho (0 = identicas). */
async function diferencaMedia(a: Uint8Array, b: Uint8Array): Promise<number> {
  const pa = await pixels(a);
  const pb = await pixels(b);
  expect(pa.largura).toBe(pb.largura);
  expect(pa.altura).toBe(pb.altura);
  let soma = 0;
  for (let i = 0; i < pa.data.length; i += 1) soma += Math.abs((pa.data[i] as number) - (pb.data[i] as number));
  return soma / pa.data.length;
}

describe('compositor sharp da marca d agua', () => {
  it('preview: JPEG de no maximo 320 px de largura e menor que 60 KB, com marca', async () => {
    const origem = await fundo(235);
    const r = await composer.compose(new Uint8Array(origem), { variant: 'preview', label: ROTULO, signal: sinal() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(Buffer.from(r.jpeg)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(320);
    expect(meta.width as number).toBeLessThanOrEqual(320);
    expect(r.jpeg.length).toBeLessThan(60_000);
  });

  it('full: JPEG de no maximo 1280 px de largura, com a proporcao da origem preservada', async () => {
    const origem = await fundo(235);
    const r = await composer.compose(new Uint8Array(origem), { variant: 'full', label: ROTULO, signal: sinal() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(Buffer.from(r.jpeg)).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(960);
  });

  it('a marca aparece sobre fundo claro e sobre fundo escuro, nas duas variantes (teste de pixel)', async () => {
    for (const cor of [235, 20]) {
      const origem = new Uint8Array(await fundo(cor));
      for (const variante of ['preview', 'full'] as const) {
        const marcada = await composer.compose(origem, { variant: variante, label: ROTULO, signal: sinal() });
        const semMarca = await composer.compose(origem, { variant: variante, label: null, signal: sinal() });
        expect(marcada.ok && semMarca.ok).toBe(true);
        if (!marcada.ok || !semMarca.ok) return;
        const diferenca = await diferencaMedia(marcada.jpeg, semMarca.jpeg);
        // Limiar conservador: a marca precisa mexer de forma perceptivel nos pixels, nao so no metadado.
        expect(diferenca, `cor ${cor} ${variante}`).toBeGreaterThan(2);
      }
    }
  });

  it('rotulos diferentes geram marcas diferentes (cada identificador e desenhado)', async () => {
    const origem = new Uint8Array(await fundo(235));
    const a = await composer.compose(origem, { variant: 'preview', label: 'FP-ABCD-EFGH', signal: sinal() });
    const b = await composer.compose(origem, { variant: 'preview', label: 'FP-WXYZ-2345', signal: sinal() });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await diferencaMedia(a.jpeg, b.jpeg)).toBeGreaterThan(0.5);
  });

  it('dono em tamanho completo (sem marca): devolve os mesmos bytes da foto reduzida', async () => {
    const origem = new Uint8Array(await fundo(235));
    const r = await composer.compose(origem, { variant: 'full', label: null, signal: sinal() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.jpeg).equals(Buffer.from(origem))).toBe(true);
  });

  it('a saida nao carrega metadados (EXIF) mesmo quando a origem tem', async () => {
    const origem = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 200, b: 200 } } })
      .withExif({ IFD0: { Copyright: 'teste-h056' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(origem).metadata()).exif).toBeDefined();
    const marcada = await composer.compose(new Uint8Array(origem), { variant: 'full', label: ROTULO, signal: sinal() });
    expect(marcada.ok).toBe(true);
    if (!marcada.ok) return;
    expect((await sharp(Buffer.from(marcada.jpeg)).metadata()).exif).toBeUndefined();
  });

  it('entrada que nao e JPEG e recusada como invalida, sem excecao', async () => {
    const texto = await composer.compose(new Uint8Array(Buffer.from('isto nao e uma imagem')), {
      variant: 'preview',
      label: ROTULO,
      signal: sinal(),
    });
    expect(texto).toEqual({ ok: false, kind: 'invalid' });
    const cinza = '#808080'; // check-hex:ignore: cor de fundo de imagem de teste, nao da interface
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: cinza } }).png().toBuffer();
    const naoJpeg = await composer.compose(new Uint8Array(png), { variant: 'preview', label: ROTULO, signal: sinal() });
    expect(naoJpeg).toEqual({ ok: false, kind: 'invalid' });
  });

  it('sinal ja cancelado devolve indisponivel sem processar', async () => {
    const controle = new AbortController();
    controle.abort();
    const origem = new Uint8Array(await fundo(235));
    const r = await composer.compose(origem, { variant: 'preview', label: ROTULO, signal: controle.signal });
    expect(r).toEqual({ ok: false, kind: 'unavailable' });
  });
});
