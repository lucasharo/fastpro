// H-028 (Issue #41) | Prova de ausencia de metadado na saida, com o redutor real (docs/factory/96-DESENHO-H028.md, §3,
// §4, §7 e X-02 a X-06; CA-01, CA-02, CA-03). Entradas montadas byte a byte (helpers/construtores-imagem.ts) e lidas
// por um leitor estrutural proprio (helpers/estrutura-imagem.ts), sem sharp. Cada caso tem controle positivo na
// entrada (o portador esta la) e so depois a conferencia da saida. Sem foto real e sem binario versionado.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-028');
};

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SharpImageReducer } from '../src/media/image-reducer-sharp.js';
import {
  listarPortadores,
  lerJpeg,
  marcadoresJpeg,
  verificarSaidaJpegLimpa,
} from './helpers/estrutura-imagem.js';
import {
  SENTINELA,
  fotoJpeg,
  fotoPng,
  fotoWebp,
  jpegComPortadores,
  perfilIcc,
  pngComPortadores,
  webpAnimadoCurto,
  webpComPortadores,
  type PortadoresJpeg,
  type PortadoresPng,
  type PortadoresWebp,
} from './helpers/construtores-imagem.js';

const reducer = new SharpImageReducer();
const AZUL = { r: 20, g: 60, b: 200 };
const VERMELHO = { r: 230, g: 20, b: 20 };
const VERDE = { r: 20, g: 200, b: 60 };

/** Reducao real; recusa do redutor derruba o caso (nenhum resultado e inventado). */
async function reduzir(entrada: Buffer): Promise<Buffer> {
  const r = await reducer.reduce(new Uint8Array(entrada), { deadlineMs: 10_000 });
  if (!r.ok) throw new Error(`reducao_recusada:${r.kind === 'definitive' ? r.code : r.cause}`);
  return Buffer.from(r.bytes);
}

/** Pixel central da saida decodificada (canais RGB). */
async function centro(jpeg: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

/** Metadado que o proprio sharp ainda enxerga na saida (segunda leitura, independente do leitor proprio). */
async function metadadoSharp(jpeg: Buffer): Promise<string[]> {
  const meta = await sharp(jpeg).metadata();
  return (['exif', 'xmp', 'icc', 'iptc'] as const).filter((k) => meta[k] !== undefined);
}

/** Bytes que nao podem aparecer em saida nenhuma (reforco; CA-02 pede estrutura, nao busca de bytes). */
const PROIBIDOS = [
  'Exif',
  'GPS',
  'http://ns.adobe.com',
  'Photoshop',
  '8BIM',
  'ICC_PROFILE',
  'sentinela-',
] as const;
function bytesProibidos(saida: Buffer): string[] {
  return PROIBIDOS.filter((p) => saida.includes(Buffer.from(p, 'latin1')));
}

/** Marcadores observados em todas as saidas (registro para a Issue #41). */
const observados = new Set<string>();

/** Conferencia completa de uma saida: estrutura limpa, sem metadado no sharp e sem bytes proibidos. */
async function conferirSaida(saida: Buffer): Promise<void> {
  for (const m of marcadoresJpeg(saida)) observados.add(m);
  expect(verificarSaidaJpegLimpa(saida)).toEqual([]);
  expect(await metadadoSharp(saida)).toEqual([]);
  expect(bytesProibidos(saida)).toEqual([]);
}

describe('H-028 | X-02 JPEG: metadado de entrada some na saida (CA-01, CA-03)', () => {
  let base: Buffer | null = null;
  const jpegBase = async (): Promise<Buffer> => {
    base ??= await fotoJpeg(1600, 1200, AZUL);
    return base;
  };

  // Os perfis ICC sao obtidos dentro do teste (await nao existe na montagem do describe).
  const casos: [string, (icc: Buffer) => PortadoresJpeg, string[]][] = [
    ['EXIF sem GPS', () => ({ exif: { gps: false } }), ['exif']],
    ['EXIF com GPS ficticio', () => ({ exif: { gps: true } }), ['exif', 'gps']],
    ['XMP', () => ({ xmp: true }), ['xmp']],
    ['IPTC', () => ({ iptc: true }), ['iptc']],
    ['ICC (perfil P3)', (icc) => ({ icc }), ['icc']],
    ['COM (comentario)', () => ({ com: true }), ['com']],
    [
      'todos juntos',
      (icc) => ({ exif: { gps: true }, xmp: true, iptc: true, icc, com: true }),
      ['exif', 'gps', 'xmp', 'iptc', 'icc', 'com'],
    ],
  ];

  it.each(casos)(
    '%s: controle positivo na entrada, reducao real e saida sem metadado',
    async (_nome, montarPortadores, esperados) => {
      const entrada = jpegComPortadores(await jpegBase(), montarPortadores(await perfilIcc()));
      const achados = listarPortadores(entrada);
      for (const e of esperados) expect(achados).toContain(e);

      await conferirSaida(await reduzir(entrada));
    },
  );
});

describe('H-028 | X-03 PNG e WebP: portadores de metadado somem na saida JPEG (CA-01, CA-03)', () => {
  const pngCasos: [string, (icc: Buffer) => PortadoresPng, string[]][] = [
    ['PNG eXIf com GPS', () => ({ exif: { gps: true } }), ['exif', 'gps']],
    ['PNG iCCP', (icc) => ({ icc }), ['icc']],
    ['PNG tEXt (texto livre)', () => ({ texto: true }), ['texto']],
    ['PNG iTXt com XMP', () => ({ xmp: true }), ['xmp']],
    ['PNG zTXt com perfil IPTC', () => ({ iptc: true }), ['iptc']],
    ['PNG tIME', () => ({ tempo: true }), ['data']],
    [
      'PNG todos juntos',
      (icc) => ({ exif: { gps: true }, icc, texto: true, xmp: true, iptc: true, tempo: true }),
      ['exif', 'gps', 'icc', 'texto', 'xmp', 'iptc', 'data'],
    ],
  ];

  it.each(pngCasos)('%s', async (_nome, montarPortadores, esperados) => {
    const entrada = pngComPortadores(
      await fotoPng(1600, 1200, AZUL),
      montarPortadores(await perfilIcc()),
    );
    const achados = listarPortadores(entrada);
    for (const e of esperados) expect(achados).toContain(e);

    await conferirSaida(await reduzir(entrada));
  });

  const webpCasos: [string, (icc: Buffer) => PortadoresWebp, string[]][] = [
    ['WebP EXIF com GPS (VP8X)', () => ({ vp8x: true, exif: { gps: true } }), ['exif', 'gps']],
    ['WebP XMP (VP8X)', () => ({ vp8x: true, xmp: true }), ['xmp']],
    ['WebP ICCP (VP8X)', (icc) => ({ vp8x: true, icc }), ['icc']],
    ['WebP EXIF sem VP8X', () => ({ vp8x: false, exif: { gps: true } }), ['exif', 'gps']],
    [
      'WebP todos juntos (VP8X)',
      (icc) => ({ vp8x: true, exif: { gps: true }, xmp: true, icc }),
      ['exif', 'gps', 'xmp', 'icc'],
    ],
  ];

  it.each(webpCasos)('%s', async (_nome, montarPortadores, esperados) => {
    const entrada = await webpComPortadores(
      await fotoWebp(1600, 1200, AZUL),
      montarPortadores(await perfilIcc()),
    );
    const achados = listarPortadores(entrada);
    for (const e of esperados) expect(achados).toContain(e);

    await conferirSaida(await reduzir(entrada));
  });

  it('WebP animado curto: so o primeiro quadro entra (vermelho), e a saida e uma imagem JPEG limpa (93 §5.1)', async () => {
    const entrada = await webpAnimadoCurto(
      await fotoWebp(200, 150, VERMELHO),
      await fotoWebp(200, 150, VERDE),
    );
    const achados = listarPortadores(entrada);
    expect(achados).toContain('animado');
    expect(achados.filter((x) => x === 'quadro')).toHaveLength(2);

    const saida = await reduzir(entrada);
    await conferirSaida(saida);
    const [r, , b] = await centro(saida);
    expect(r).toBeGreaterThan(b); // primeiro quadro (vermelho), nao o verde
  });
});

describe('H-028 | X-04 miniatura e segunda imagem da entrada nao sobrevivem (CA-02)', () => {
  it('JPEG com EXIF e miniatura vermelha 160x120 (principal azul 2000x1500): saida com uma unica imagem azul', async () => {
    const principal = await fotoJpeg(2000, 1500, AZUL);
    const miniatura = await fotoJpeg(160, 120, VERMELHO);
    const entrada = jpegComPortadores(principal, { exif: { gps: true, miniatura } });
    expect(listarPortadores(entrada)).toEqual(expect.arrayContaining(['exif', 'gps', 'miniatura']));

    const saida = await reduzir(entrada);
    await conferirSaida(saida);
    expect(lerJpeg(saida).segmentos.filter((s) => s.marcador === 0xd8)).toHaveLength(1);
    expect(saida.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    const [r, , b] = await centro(saida);
    expect(b).toBeGreaterThan(r); // azul: a miniatura vermelha nao substituiu a imagem
    expect((await sharp(saida).metadata()).pages ?? 1).toBe(1);
  });

  const variantes: [string, () => Promise<Buffer>, string[]][] = [
    [
      'JFIF com miniatura JFXX',
      async () =>
        jpegComPortadores(await fotoJpeg(2000, 1500, AZUL), {
          jfxx: await fotoJpeg(160, 120, VERMELHO),
        }),
      ['miniatura_jfxx'],
    ],
    [
      'MPF com segunda imagem depois do EOI',
      async () =>
        jpegComPortadores(await fotoJpeg(2000, 1500, AZUL), {
          mpf: true,
          depoisDoEoi: await fotoJpeg(160, 120, VERMELHO),
        }),
      ['mpf', 'anexo'],
    ],
    [
      'ZIP anexado depois do EOI',
      async () =>
        jpegComPortadores(await fotoJpeg(2000, 1500, AZUL), {
          depoisDoEoi: Buffer.concat([
            Buffer.from('PK\x03\x04', 'latin1'),
            Buffer.from(SENTINELA.nome, 'ascii'),
          ]),
        }),
      ['anexo'],
    ],
  ];

  it.each(variantes)('%s', async (_nome, montar, esperados) => {
    const entrada = await montar();
    const achados = listarPortadores(entrada);
    for (const e of esperados) expect(achados).toContain(e);

    const saida = await reduzir(entrada);
    await conferirSaida(saida);
    expect(lerJpeg(saida).segmentos.filter((s) => s.marcador === 0xd8)).toHaveLength(1);
    expect(saida.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    const [r, , b] = await centro(saida);
    expect(b).toBeGreaterThan(r);
  });
});

describe('H-028 | X-05 reforco: busca de bytes e teste estatico do redutor (CA-01)', () => {
  it('a saida de uma entrada com todos os portadores nao contem Exif, GPS, XMP, Photoshop, 8BIM, ICC_PROFILE ou sentinela', async () => {
    const entrada = jpegComPortadores(await fotoJpeg(1600, 1200, AZUL), {
      exif: { gps: true, miniatura: await fotoJpeg(160, 120, VERMELHO) },
      xmp: true,
      iptc: true,
      icc: await perfilIcc(),
      com: true,
    });
    expect(bytesProibidos(await reduzir(entrada))).toEqual([]);
  });

  it('image-reducer-sharp.ts nao chama funcoes que copiam metadado (R-09 de 93, reaproveitado)', () => {
    const fonte = readFileSync(
      fileURLToPath(new URL('../src/media/image-reducer-sharp.ts', import.meta.url)),
      'utf8',
    );
    for (const proibida of [
      'withMetadata',
      'keepMetadata',
      'withExif',
      'withIccProfile',
      'withXmp',
    ]) {
      expect(fonte).not.toContain(proibida);
    }
  });
});

describe('H-028 | X-06 o leitor e confiavel: controle negativo e falha fechada (CA-03)', () => {
  it('o verificador aprova uma saida JPEG limpa (controle positivo do leitor)', async () => {
    const limpo = await fotoJpeg(800, 600, AZUL);
    expect(verificarSaidaJpegLimpa(limpo)).toEqual([]);
    expect(listarPortadores(limpo)).toEqual([]);
  });

  const sujas: [string, () => Promise<Buffer>, string][] = [
    [
      'APP1 (EXIF)',
      async () => jpegComPortadores(await fotoJpeg(800, 600, AZUL), { exif: { gps: false } }),
      'APP1',
    ],
    [
      'APP1 (XMP)',
      async () => jpegComPortadores(await fotoJpeg(800, 600, AZUL), { xmp: true }),
      'APP1',
    ],
    [
      'APP13 (IPTC)',
      async () => jpegComPortadores(await fotoJpeg(800, 600, AZUL), { iptc: true }),
      'APP13',
    ],
    [
      'APP2 (ICC)',
      async () => jpegComPortadores(await fotoJpeg(800, 600, AZUL), { icc: await perfilIcc() }),
      'APP2',
    ],
    ['COM', async () => jpegComPortadores(await fotoJpeg(800, 600, AZUL), { com: true }), 'COM'],
    [
      'APP0 com JFXX',
      async () =>
        jpegComPortadores(await fotoJpeg(800, 600, AZUL), {
          jfxx: await fotoJpeg(40, 30, VERMELHO),
        }),
      'APP0',
    ],
    [
      'bytes depois do EOI',
      async () =>
        jpegComPortadores(await fotoJpeg(800, 600, AZUL), {
          depoisDoEoi: Buffer.from('lixo-depois-do-eoi', 'ascii'),
        }),
      'bytes_depois_do_eoi',
    ],
    [
      'SOI duplicado',
      async () => {
        const j = await fotoJpeg(800, 600, AZUL);
        return Buffer.concat([j.subarray(0, 2), Buffer.from([0xff, 0xd8]), j.subarray(2)]);
      },
      'soi_2',
    ],
    [
      'marcador desconhecido (FF 02)',
      async () => {
        const j = await fotoJpeg(800, 600, AZUL);
        return Buffer.concat([
          j.subarray(0, 2),
          Buffer.from([0xff, 0x02, 0x00, 0x04, 0x00, 0x00]),
          j.subarray(2),
        ]);
      },
      'FF02',
    ],
  ];

  it.each(sujas)('acusa %s', async (_nome, montar, esperado) => {
    expect(verificarSaidaJpegLimpa(await montar())).toContain(esperado);
  });

  it('falha fechada: JPEG truncado e comprimento que passa do fim sao acusados', async () => {
    const j = await fotoJpeg(800, 600, AZUL);
    const cortado = j.subarray(0, Math.floor(j.length / 2));
    expect(verificarSaidaJpegLimpa(cortado).length).toBeGreaterThan(0);
    expect(lerJpeg(cortado).erros.length).toBeGreaterThan(0);

    const comAPP1 = jpegComPortadores(j, { exif: { gps: false } });
    const estragado = Buffer.from(comAPP1);
    estragado.writeUInt16BE(0xffff, comAPP1.indexOf(Buffer.from([0xff, 0xe1])) + 2);
    expect(verificarSaidaJpegLimpa(estragado)).toContain('comprimento_passa_do_fim');
  });

  it('marcadores observados nas saidas ficam no conjunto permitido (registro para a Issue #41)', () => {
    expect(observados.size).toBeGreaterThan(0);
    for (const m of observados) {
      expect(m).toMatch(/^(SOI|EOI|APP0|DQT|DHT|SOS|DRI|SOF\d+|RST[0-7])$/);
    }
  });
});
