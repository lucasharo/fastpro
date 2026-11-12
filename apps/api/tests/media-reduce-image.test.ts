// H-027 (Issue #40) | Redutor real com sharp sobre o conjunto de imagens gerado dentro do teste (sem foto real e sem
// binario versionado). Docs: docs/factory/93-DESENHO-H027.md, §4.2, §5.1, §7; R-01, R-04, R-08, R-09.
// Cabecalhos de PNG com dimensoes falsas sao montados aqui para provar a recusa por area sem decodificar.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-027');
};

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { planoDimensoes, type MediaRejectCode, type ReduceOutcome } from '@fastpro/domain';
import { SharpImageReducer } from '../src/media/image-reducer-sharp.js';

const reducer = new SharpImageReducer();
const executar = (bytes: Buffer): Promise<ReduceOutcome> => reducer.reduce(new Uint8Array(bytes), { deadlineMs: 10_000 });

/** Cabecalho PNG valido (assinatura, IHDR com CRC e IEND) com dimensoes escolhidas; o corpo nao e decodificavel. */
function pngComDimensoes(largura: number, altura: number): Buffer {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dados = Buffer.alloc(13);
  dados.writeUInt32BE(largura, 0);
  dados.writeUInt32BE(altura, 4);
  dados[8] = 8;
  dados[9] = 2;
  const bloco = (tipo: string, corpo: Buffer): Buffer => {
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(corpo.length, 0);
    const tipoBuf = Buffer.from(tipo, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, corpo])) >>> 0, 0);
    return Buffer.concat([tam, tipoBuf, corpo, crc]);
  };
  // IDAT minimo: sem ele o libvips recusa o cabecalho antes de medir as dimensoes.
  const idat = deflateSync(Buffer.alloc(1));
  return Buffer.concat([assinatura, bloco('IHDR', dados), bloco('IDAT', idat), bloco('IEND', Buffer.alloc(0))]);
}

/** Bloco de pixels azul com um quadrado vermelho no canto superior esquerdo (para checar a orientacao). */
async function quadroOrientado(largura: number, altura: number): Promise<sharp.Sharp> {
  const fundo = sharp({ create: { width: largura, height: altura, channels: 3, background: { r: 20, g: 60, b: 200 } } });
  const quadrado = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png().toBuffer();
  return sharp(await fundo.composite([{ input: quadrado, top: 0, left: 0 }]).png().toBuffer());
}

async function pixel(jpegOuPng: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpegOuPng).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

interface Caso {
  readonly nome: string;
  readonly bytes: Buffer;
  readonly esperado: { readonly largura: number; readonly altura: number } | { readonly recusa: MediaRejectCode };
}

let conjunto: Caso[] = [];

beforeAll(async () => {
  const jpgFoto = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 51, g: 102, b: 153 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
  const pngFoto = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 51, g: 102, b: 153 } } })
    .png()
    .toBuffer();
  const ruido = await sharp({
    create: { width: 3000, height: 4000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
  const jpgGrande = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: { r: 90, g: 90, b: 90 } } })
    .jpeg({ quality: 85 })
    .toBuffer();
  const webp = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 10, g: 200, b: 90 } } })
    .webp()
    .toBuffer();
  const transparente = await sharp({
    create: { width: 800, height: 600, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const pequena = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
  const exifGps = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { ImageDescription: 'sentinela-exif' }, IFD3: { GPSLatitude: '1/1' } })
    .jpeg()
    .toBuffer();
  const p3 = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 240, g: 40, b: 40 } } })
    .withIccProfile('p3')
    .jpeg()
    .toBuffer();
  const truncado = jpgFoto.subarray(0, Math.floor(jpgFoto.length / 2));

  conjunto = [
    { nome: 'JPG 3000x4000', bytes: jpgFoto, esperado: { largura: 960, altura: 1280 } },
    { nome: 'PNG 3000x4000', bytes: pngFoto, esperado: { largura: 960, altura: 1280 } },
    { nome: 'ruido branco 3000x4000 (pior caso)', bytes: ruido, esperado: { largura: 960, altura: 1280 } },
    { nome: 'JPG 8000x6000 (48 MP)', bytes: jpgGrande, esperado: { largura: 1280, altura: 960 } },
    { nome: 'WebP 1600x1200', bytes: webp, esperado: { largura: 1280, altura: 960 } },
    { nome: 'PNG com transparencia 800x600', bytes: transparente, esperado: { largura: 800, altura: 600 } },
    { nome: 'foto menor 800x600 (nao ampliada)', bytes: pequena, esperado: { largura: 800, altura: 600 } },
    { nome: 'JPG com orientacao 6 e EXIF/GPS ficticio', bytes: exifGps, esperado: { largura: 960, altura: 1280 } },
    { nome: 'perfil Display P3', bytes: p3, esperado: { largura: 1200, altura: 900 } },
    { nome: 'texto renomeado .jpg', bytes: Buffer.from('isto nao e uma imagem\n'.repeat(40)), esperado: { recusa: 'imagem_invalida' } },
    { nome: 'cabecalho HEIC falso', bytes: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(64)]), esperado: { recusa: 'imagem_invalida' } },
    { nome: 'GIF', bytes: Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(24)]), esperado: { recusa: 'imagem_invalida' } },
    { nome: 'SVG', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'), esperado: { recusa: 'imagem_invalida' } },
    { nome: 'JPEG truncado', bytes: truncado, esperado: { recusa: 'imagem_invalida' } },
    { nome: 'PNG-bomba 15000x15000 (cabecalho)', bytes: pngComDimensoes(15000, 15000), esperado: { recusa: 'imagem_grande_demais' } },
    { nome: 'PNG 8001x8001 (64 MP + 1, cabecalho)', bytes: pngComDimensoes(8001, 8001), esperado: { recusa: 'imagem_grande_demais' } },
  ];
}, 180_000);

describe('H-027 | R-01: conjunto de imagens aceitas pelo redutor real', () => {
  const aceitos = (): Caso[] => conjunto.filter((c) => 'largura' in c.esperado);

  it('cada imagem aceita sai JPEG, com lado maior <= 1.280, <= 750.000 bytes e dimensoes que conferem', async () => {
    for (const c of aceitos()) {
      const r = await executar(c.bytes);
      expect(r.ok, c.nome).toBe(true);
      if (!r.ok) continue;
      expect(r.bytes.byteLength, c.nome).toBeLessThanOrEqual(750_000);
      expect(Math.max(r.width, r.height), c.nome).toBeLessThanOrEqual(1280);
      const meta = await sharp(Buffer.from(r.bytes)).metadata();
      expect(meta.format, c.nome).toBe('jpeg');
      expect(meta.width, c.nome).toBe(r.width);
      expect(meta.height, c.nome).toBe(r.height);
      const esp = c.esperado as { largura: number; altura: number };
      expect({ w: r.width, h: r.height }, c.nome).toEqual({ w: esp.largura, h: esp.altura });
    }
  }, 180_000);

  it('fotos comuns ficam em ate 500.000 bytes; ruido branco fica em ate 750.000', async () => {
    for (const c of aceitos()) {
      const r = await executar(c.bytes);
      if (!r.ok) continue;
      if (c.nome.startsWith('ruido')) expect(r.bytes.byteLength, c.nome).toBeLessThanOrEqual(750_000);
      else expect(r.bytes.byteLength, c.nome).toBeLessThanOrEqual(500_000);
    }
  }, 180_000);

  it('redutor falso de 800 KB no piso: nao_cabe_no_limite e tratado no dominio (ver media-reduce.test.ts)', () => {
    expect(planoDimensoes(4000, 3000)).toEqual({ width: 1280, height: 960 });
  });
});

describe('H-027 | R-04: recusas definitivas com codigo fixo', () => {
  it('cada recusa do conjunto devolve o codigo correto e nunca mensagem de biblioteca', async () => {
    for (const c of conjunto.filter((x) => 'recusa' in x.esperado)) {
      const r = await executar(c.bytes);
      expect(r.ok, c.nome).toBe(false);
      if (r.ok) continue;
      expect(r.kind, c.nome).toBe('definitive');
      if (r.kind !== 'definitive') continue;
      expect(r.code, c.nome).toBe((c.esperado as { recusa: MediaRejectCode }).recusa);
      expect(JSON.stringify(r)).not.toMatch(/vips|sharp|Input|buffer|Error/i);
    }
  }, 180_000);
});

describe('H-027 | R-08: orientacao EXIF aplicada antes da reducao', () => {
  it('orientacao 6 e 8 gera retrato 960x1280; orientacao 3 mantem paisagem 1280x960 (JPEG e PNG)', async () => {
    const base = await (await quadroOrientado(4000, 3000)).jpeg({ quality: 90 }).toBuffer();
    for (const [orientacao, esperado] of [
      [6, { w: 960, h: 1280 }],
      [8, { w: 960, h: 1280 }],
      [3, { w: 1280, h: 960 }],
    ] as const) {
      const com = await sharp(base).withMetadata({ orientation: orientacao }).jpeg().toBuffer();
      const r = await executar(com);
      expect(r.ok, `jpeg ${orientacao}`).toBe(true);
      if (r.ok) expect({ w: r.width, h: r.height }, `jpeg ${orientacao}`).toEqual(esperado);
    }
    const png = await sharp(base).withMetadata({ orientation: 6 }).png().toBuffer();
    const rp = await executar(png);
    expect(rp.ok).toBe(true);
    if (rp.ok) expect({ w: rp.width, h: rp.height }).toEqual({ w: 960, h: 1280 });
  }, 120_000);

  it('pixel de referencia: com orientacao 6, o quadrado vermelho (canto superior esquerdo do original) vai ao canto superior direito', async () => {
    const base = await (await quadroOrientado(4000, 3000)).jpeg({ quality: 95 }).toBuffer();
    const com = await sharp(base).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const r = await executar(com);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [vr, vg, vb] = await pixel(Buffer.from(r.bytes), r.width - 30, 30);
    expect(vr).toBeGreaterThan(160);
    expect(vg).toBeLessThan(110);
    expect(vb).toBeLessThan(110);
  }, 120_000);
});

describe('H-027 | R-09: saida sem metadado da entrada', () => {
  it('entrada com EXIF, GPS, XMP e ICC ficticios: a saida nao tem exif, xmp nem icc, nem marcadores APP1/APP2 ou textos de metadado', async () => {
    const entrada = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 80, g: 120, b: 160 } } })
      .withExif({ IFD0: { ImageDescription: 'sentinela-exif-h027' }, IFD3: { GPSLatitude: '9/1' } })
      .withIccProfile('srgb')
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>sentinela-xmp-h027</rdf:RDF></x:xmpmeta>')
      .jpeg()
      .toBuffer();
    const pre = await sharp(entrada).metadata();
    expect(pre.exif !== undefined || pre.xmp !== undefined || pre.icc !== undefined).toBe(true);
    const r = await executar(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saida = Buffer.from(r.bytes);
    const meta = await sharp(saida).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(saida.includes(Buffer.from('Exif'))).toBe(false);
    expect(saida.includes(Buffer.from('GPS'))).toBe(false);
    expect(saida.includes(Buffer.from('http://ns.adobe.com'))).toBe(false);
    expect(saida.includes(Buffer.from('sentinela-'))).toBe(false);
    for (let i = 0; i + 1 < saida.length; i++) {
      if (saida[i] === 0xff && (saida[i + 1] === 0xe1 || saida[i + 1] === 0xe2)) {
        throw new Error('marcador APP1/APP2 encontrado na saida');
      }
    }
  }, 120_000);

  it('teste estatico: o modulo do redutor nao chama withMetadata, keepMetadata, withExif, withIccProfile ou withXmp', () => {
    const fonte = readFileSync(join(__dirname, '..', 'src', 'media', 'image-reducer-sharp.ts'), 'utf8');
    expect(fonte).not.toMatch(/withMetadata|keepMetadata|withExif|withIccProfile|withXmp/);
  });
});
