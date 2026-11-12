// H-028 (Issue #41) | Construtores do conjunto de prova, SO para testes (docs/factory/96-DESENHO-H028.md, §2.4, §3, §5, §7).
// A entrada com metadado e montada byte a byte (segmentos APPn, chunks PNG, chunks RIFF) a partir de uma imagem-base
// gerada pelo sharp. Assim a entrada nao depende do gravador de metadado do sharp, que e justamente o que se testa.
// Sentinelas e coordenadas sao ficticias. Nenhum binario de foto real e versionado.
import sharp from 'sharp';
import { crc32, deflateSync } from 'node:zlib';
import { lerJpeg } from './estrutura-imagem.js';

export const SENTINELA = {
  exif: 'sentinela-exif-h028',
  xmp: 'sentinela-xmp-h028',
  iptc: 'sentinela-iptc-h028',
  com: 'sentinela-comentario-h028',
  cabecalho: 'sentinela-cabecalho-h028',
  nome: 'rua-das-flores-12.jpg',
} as const;

/** Coordenada ficticia: latitude 9/1 e longitude 20/1, em racionais EXIF. */
const LATITUDE: readonly [number, number][] = [
  [9, 1],
  [0, 1],
  [0, 1],
];
const LONGITUDE: readonly [number, number][] = [
  [20, 1],
  [0, 1],
  [0, 1],
];

// ---------- Imagens-base (sharp, sem metadado de proposito) ----------

export async function fotoJpeg(
  largura: number,
  altura: number,
  cor: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function fotoPng(
  largura: number,
  altura: number,
  cor: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .png()
    .toBuffer();
}

export async function fotoWebp(
  largura: number,
  altura: number,
  cor: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .webp({ quality: 80 })
    .toBuffer();
}

let perfilCache: Buffer | null = null;

/** Perfil ICC real (P3) extraido de um JPEG gerado pelo sharp; reusado nos tres formatos. */
export async function perfilIcc(): Promise<Buffer> {
  if (perfilCache !== null) return perfilCache;
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .withIccProfile('p3')
    .jpeg()
    .toBuffer();
  const seg = lerJpeg(jpeg).segmentos.find(
    (s) => s.marcador === 0xe2 && s.dados.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0',
  );
  if (seg === undefined) throw new Error('perfil_icc_nao_gerado');
  perfilCache = Buffer.from(seg.dados.subarray(14));
  return perfilCache;
}

// ---------- TIFF (EXIF) ----------

export interface CampoTiff {
  readonly tag: number;
  readonly tipo: 2 | 3 | 4 | 5;
  readonly count: number;
  readonly dados: Buffer;
}

function tamanhoIfd(campos: readonly CampoTiff[]): number {
  let fim = 2 + 12 * campos.length + 4;
  for (const c of campos) if (c.dados.length > 4) fim += c.dados.length + (c.dados.length % 2);
  return fim;
}

/** Escreve um IFD em little endian a partir de `inicio` (relativo ao cabecalho TIFF). */
function escreverIfd(campos: readonly CampoTiff[], inicio: number, proximo: number): Buffer {
  const tabela = Buffer.alloc(2 + 12 * campos.length + 4);
  tabela.writeUInt16LE(campos.length, 0);
  const extras: Buffer[] = [];
  let deslocamento = inicio + tabela.length;
  campos.forEach((c, i) => {
    const e = 2 + 12 * i;
    tabela.writeUInt16LE(c.tag, e);
    tabela.writeUInt16LE(c.tipo, e + 2);
    tabela.writeUInt32LE(c.count, e + 4);
    if (c.dados.length <= 4) {
      c.dados.copy(tabela, e + 8);
    } else {
      tabela.writeUInt32LE(deslocamento, e + 8);
      const pad = Buffer.alloc(c.dados.length % 2);
      extras.push(c.dados, pad);
      deslocamento += c.dados.length + pad.length;
    }
  });
  tabela.writeUInt32LE(proximo, 2 + 12 * campos.length);
  return Buffer.concat([tabela, ...extras]);
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
const u32Be = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
};
const ascii = (s: string): Buffer => Buffer.from(`${s}\0`, 'ascii');
const racionais = (r: readonly (readonly [number, number])[]): Buffer =>
  Buffer.concat(r.flatMap(([n, d]) => [u32(n), u32(d)]));

/**
 * TIFF EXIF com IFD0 (descricao sentinela, data), GPS opcional (sub-IFD apontado pela tag 0x8825) e IFD1 com
 * miniatura opcional (tags 0x0201 e 0x0202 apontando para o JPEG dentro deste mesmo bloco).
 */
export function tiffExif(opcoes: { gps: boolean; miniatura?: Buffer }): Buffer {
  const ifd0 = (ptrGps: number): CampoTiff[] => [
    { tag: 0x010e, tipo: 2, count: SENTINELA.exif.length + 1, dados: ascii(SENTINELA.exif) },
    { tag: 0x0132, tipo: 2, count: 20, dados: ascii('2026:11:12 10:00:00') },
    ...(opcoes.gps ? [{ tag: 0x8825, tipo: 4 as const, count: 1, dados: u32(ptrGps) }] : []),
  ];
  const gpsCampos: CampoTiff[] = [
    { tag: 0x0001, tipo: 2, count: 2, dados: ascii('N') },
    { tag: 0x0002, tipo: 5, count: 3, dados: racionais(LATITUDE) },
    { tag: 0x0003, tipo: 2, count: 2, dados: ascii('E') },
    { tag: 0x0004, tipo: 5, count: 3, dados: racionais(LONGITUDE) },
  ];
  const miniatura = opcoes.miniatura;
  const ifd1Campos = (inicioMini: number): CampoTiff[] =>
    miniatura === undefined
      ? []
      : [
          { tag: 0x0201, tipo: 4, count: 1, dados: u32(inicioMini) },
          { tag: 0x0202, tipo: 4, count: 1, dados: u32(miniatura.length) },
        ];

  // Tamanhos independentes dos ponteiros (ponteiros sao sempre LONG de 4 bytes): calcula primeiro, escreve depois.
  const inicioIfd0 = 8;
  const tamIfd0 = tamanhoIfd(ifd0(0));
  const inicioGps = inicioIfd0 + tamIfd0;
  const tamGps = opcoes.gps ? tamanhoIfd(gpsCampos) : 0;
  const inicioIfd1 = inicioGps + tamGps;
  const tamIfd1 = miniatura === undefined ? 0 : tamanhoIfd(ifd1Campos(0));
  const inicioMini = inicioIfd1 + tamIfd1;

  const partes: Buffer[] = [
    Buffer.from('II*\0', 'latin1'),
    u32(inicioIfd0),
    escreverIfd(ifd0(inicioGps), inicioIfd0, miniatura === undefined ? 0 : inicioIfd1),
  ];
  if (opcoes.gps) partes.push(escreverIfd(gpsCampos, inicioGps, 0));
  if (miniatura !== undefined) {
    partes.push(escreverIfd(ifd1Campos(inicioMini), inicioIfd1, 0), miniatura);
  }
  return Buffer.concat(partes);
}

// ---------- JPEG ----------

function segmentoJpeg(marcador: number, dados: Buffer): Buffer {
  const cab = Buffer.alloc(4);
  cab[0] = 0xff;
  cab[1] = marcador;
  cab.writeUInt16BE(dados.length + 2, 2);
  return Buffer.concat([cab, dados]);
}

function pad(b: Buffer): Buffer {
  return b.length % 2 === 0 ? b : Buffer.concat([b, Buffer.alloc(1)]);
}

/** Bloco 8BIM de IPTC (recurso 0x0404 com a legenda sentinela), dentro de APP13 "Photoshop 3.0". */
function iptcApp13(): Buffer {
  const dados = pad(Buffer.from(SENTINELA.iptc, 'ascii'));
  const recurso = Buffer.concat([
    Buffer.from('8BIM', 'ascii'),
    Buffer.from([0x04, 0x04]),
    Buffer.from([0x00, 0x00]),
    u32Be(dados.length),
    dados,
  ]);
  return Buffer.concat([Buffer.from('Photoshop 3.0\0', 'ascii'), recurso]);
}

function xmpXml(): string {
  return (
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    `<rdf:Description><dc:description xmlns:dc="http://purl.org/dc/elements/1.1/">${SENTINELA.xmp}</dc:description>` +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

/** MPF minimo: cabecalho TIFF e IFD vazio (um portador de metadado; a segunda imagem vai depois do EOI). */
function mpfApp2(): Buffer {
  const tiff = Buffer.concat([
    Buffer.from('II*\0', 'latin1'),
    u32(8),
    Buffer.from([0, 0, 0, 0, 0, 0]),
  ]);
  return Buffer.concat([Buffer.from('MPF\0', 'ascii'), tiff]);
}

export interface PortadoresJpeg {
  readonly exif?: { readonly gps: boolean; readonly miniatura?: Buffer };
  readonly xmp?: boolean;
  readonly iptc?: boolean;
  readonly icc?: Buffer;
  readonly com?: boolean;
  /** JFIF com extensao JFXX e miniatura JPEG (APP0 proprio). */
  readonly jfxx?: Buffer;
  readonly mpf?: boolean;
  /** Bytes depois do EOI (rabo de fabricante, ZIP anexado, segunda imagem). */
  readonly depoisDoEoi?: Buffer;
}

/** Insere os portadores pedidos logo depois do SOI de uma imagem-base JPEG. */
export function jpegComPortadores(base: Buffer, p: PortadoresJpeg): Buffer {
  const segs: Buffer[] = [];
  if (p.exif !== undefined) {
    const tiff = tiffExif({ gps: p.exif.gps, miniatura: p.exif.miniatura });
    segs.push(segmentoJpeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])));
  }
  if (p.xmp)
    segs.push(
      segmentoJpeg(
        0xe1,
        Buffer.concat([
          Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'),
          Buffer.from(xmpXml(), 'utf8'),
        ]),
      ),
    );
  if (p.iptc) segs.push(segmentoJpeg(0xed, iptcApp13()));
  if (p.icc !== undefined)
    segs.push(
      segmentoJpeg(
        0xe2,
        Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([1, 1]), p.icc]),
      ),
    );
  if (p.com) segs.push(segmentoJpeg(0xfe, Buffer.from(SENTINELA.com, 'ascii')));
  if (p.mpf) segs.push(segmentoJpeg(0xe2, mpfApp2()));
  if (p.jfxx !== undefined)
    segs.push(
      segmentoJpeg(
        0xe0,
        Buffer.concat([Buffer.from('JFXX\0', 'ascii'), Buffer.from([0x10]), p.jfxx]),
      ),
    );
  // A base do sharp tem SOI no inicio; os portadores entram logo depois dele.
  const restante = base.subarray(2);
  const corpo = Buffer.concat([base.subarray(0, 2), ...segs, restante]);
  return p.depoisDoEoi === undefined ? corpo : Buffer.concat([corpo, p.depoisDoEoi]);
}

// ---------- PNG ----------

function pngChunk(tipo: string, dados: Buffer): Buffer {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length, 0);
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, dados])) >>> 0, 0);
  return Buffer.concat([tam, tipoBuf, dados, crc]);
}

function tIme(): Buffer {
  const b = Buffer.alloc(7);
  b.writeUInt16BE(2026, 0);
  b[2] = 11;
  b[3] = 12;
  b[4] = 10;
  b[5] = 0;
  b[6] = 0;
  return b;
}

export interface PortadoresPng {
  readonly exif?: { readonly gps: boolean };
  readonly icc?: Buffer;
  readonly texto?: boolean;
  readonly xmp?: boolean;
  readonly iptc?: boolean;
  readonly tempo?: boolean;
}

/** Insere chunks de metadado logo depois do IHDR de uma imagem-base PNG. */
export function pngComPortadores(base: Buffer, p: PortadoresPng): Buffer {
  const chunks: Buffer[] = [];
  if (p.exif !== undefined) chunks.push(pngChunk('eXIf', tiffExif({ gps: p.exif.gps })));
  if (p.icc !== undefined)
    chunks.push(
      pngChunk('iCCP', Buffer.concat([Buffer.from('ICC\0\0', 'ascii'), deflateSync(p.icc)])),
    );
  if (p.texto) chunks.push(pngChunk('tEXt', Buffer.from(`Comment\0${SENTINELA.com}`, 'ascii')));
  if (p.xmp) {
    chunks.push(
      pngChunk(
        'iTXt',
        Buffer.concat([
          Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'ascii'),
          Buffer.from(xmpXml(), 'utf8'),
        ]),
      ),
    );
  }
  if (p.iptc) {
    chunks.push(
      pngChunk(
        'zTXt',
        Buffer.concat([
          Buffer.from('Raw profile type iptc\0\0', 'ascii'),
          deflateSync(Buffer.from(SENTINELA.iptc, 'ascii')),
        ]),
      ),
    );
  }
  if (p.tempo) chunks.push(pngChunk('tIME', tIme()));
  // IHDR: assinatura (8) + bloco de 25 bytes (4 + 4 + 13 + 4).
  const fimIhdr = 33;
  return Buffer.concat([base.subarray(0, fimIhdr), ...chunks, base.subarray(fimIhdr)]);
}

// ---------- WebP ----------

function riffChunk(fourcc: string, dados: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.write(fourcc, 0, 'latin1');
  cab.writeUInt32LE(dados.length, 4);
  return Buffer.concat([cab, dados, Buffer.alloc(dados.length % 2)]);
}

function riffArquivo(corpo: Buffer): Buffer {
  const cab = Buffer.alloc(12);
  cab.write('RIFF', 0, 'latin1');
  cab.writeUInt32LE(corpo.length + 4, 4);
  cab.write('WEBP', 8, 'latin1');
  return Buffer.concat([cab, corpo]);
}

/** Primeiro chunk de imagem (VP8 ou VP8L) de um WebP simples, com o cabecalho RIFF do chunk. */
function chunkImagemWebp(base: Buffer): Buffer {
  let pos = 12;
  while (pos + 8 <= base.length) {
    const tipo = base.subarray(pos, pos + 4).toString('latin1');
    const tam = base.readUInt32LE(pos + 4);
    if (tipo === 'VP8 ' || tipo === 'VP8L') return base.subarray(pos, pos + 8 + tam + (tam % 2));
    pos += 8 + tam + (tam % 2);
  }
  throw new Error('imagem_webp_sem_chunk_vp8');
}

/** VP8X: flags (0x20 ICC, 0x10 alfa, 0x08 EXIF, 0x04 XMP, 0x02 animacao) e tamanho do canvas. */
function vp8x(flags: number, largura: number, altura: number): Buffer {
  const dados = Buffer.alloc(10);
  dados[0] = flags;
  dados.writeUIntLE(largura - 1, 4, 3);
  dados.writeUIntLE(altura - 1, 7, 3);
  return riffChunk('VP8X', dados);
}

export interface PortadoresWebp {
  readonly vp8x: boolean;
  readonly exif?: { readonly gps: boolean };
  readonly xmp?: boolean;
  readonly icc?: Buffer;
}

/** Monta um WebP com os portadores pedidos, com ou sem o cabecalho VP8X. */
export async function webpComPortadores(base: Buffer, p: PortadoresWebp): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const largura = meta.width ?? 1;
  const altura = meta.height ?? 1;
  const imagem = chunkImagemWebp(base);
  const flags =
    (p.icc !== undefined ? 0x20 : 0) | (p.exif !== undefined ? 0x08 : 0) | (p.xmp ? 0x04 : 0);
  const partes: Buffer[] = [];
  if (p.vp8x) partes.push(vp8x(flags, largura, altura));
  if (p.icc !== undefined) partes.push(riffChunk('ICCP', p.icc));
  partes.push(imagem);
  if (p.exif !== undefined) {
    const tiff = tiffExif({ gps: p.exif.gps });
    partes.push(riffChunk('EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])));
  }
  if (p.xmp) partes.push(riffChunk('XMP ', Buffer.from(xmpXml(), 'utf8')));
  return riffArquivo(Buffer.concat(partes));
}

/** WebP animado curto: dois quadros (o primeiro e o que a reducao deve usar). */
export async function webpAnimadoCurto(quadroA: Buffer, quadroB: Buffer): Promise<Buffer> {
  const anmf = (quadro: Buffer): Buffer => {
    const cab = Buffer.alloc(16);
    cab.writeUIntLE(0, 0, 3);
    cab.writeUIntLE(0, 3, 3);
    cab.writeUIntLE(199, 6, 3);
    cab.writeUIntLE(149, 9, 3);
    cab.writeUIntLE(100, 12, 3);
    cab[15] = 0;
    return riffChunk('ANMF', Buffer.concat([cab, chunkImagemWebp(quadro)]));
  };
  const anim = riffChunk('ANIM', Buffer.alloc(6));
  return riffArquivo(Buffer.concat([vp8x(0x02, 200, 150), anim, anmf(quadroA), anmf(quadroB)]));
}

// ---------- Vetores recusados (96 §5), escritos a mao ----------

export interface Vetor {
  readonly nome: string;
  readonly bytes: Buffer;
}

function ftyp(marca: string, compatveis: string[]): Buffer {
  const tam = 16 + 4 * compatveis.length;
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(tam, 0);
  cab.write('ftyp', 4, 'latin1');
  return Buffer.concat([
    cab,
    Buffer.from(marca, 'latin1'),
    Buffer.alloc(4),
    ...compatveis.map((c) => Buffer.from(c, 'latin1')),
  ]);
}

/** Vetores da lista fechada de tipos recusados (96 §5). Nenhum e JPEG, PNG ou WebP. */
export function vetoresNaoAceitos(): Vetor[] {
  const riff = (tipo: string): Buffer => {
    const b = Buffer.alloc(12 + 16);
    b.write('RIFF', 0, 'latin1');
    b.writeUInt32LE(20, 4);
    b.write(tipo, 8, 'latin1');
    b.write('fmt ', 12, 'latin1');
    return b;
  };
  return [
    {
      nome: 'HEIC (heic)',
      bytes: Buffer.concat([ftyp('heic', ['mif1', 'heic']), Buffer.alloc(40)]),
    },
    {
      nome: 'HEIC (heix)',
      bytes: Buffer.concat([ftyp('heix', ['mif1', 'heix']), Buffer.alloc(40)]),
    },
    {
      nome: 'HEIC (hevc)',
      bytes: Buffer.concat([ftyp('hevc', ['mif1', 'hevc']), Buffer.alloc(40)]),
    },
    {
      nome: 'HEIF (mif1)',
      bytes: Buffer.concat([ftyp('mif1', ['mif1', 'heic']), Buffer.alloc(40)]),
    },
    {
      nome: 'HEIF (msf1)',
      bytes: Buffer.concat([ftyp('msf1', ['msf1', 'mif1']), Buffer.alloc(40)]),
    },
    { nome: 'AVIF (avif)', bytes: Buffer.concat([ftyp('avif', ['avif']), Buffer.alloc(40)]) },
    { nome: 'AVIF (avis)', bytes: Buffer.concat([ftyp('avis', ['avis']), Buffer.alloc(40)]) },
    { nome: 'GIF87a', bytes: Buffer.concat([Buffer.from('GIF87a', 'ascii'), Buffer.alloc(24)]) },
    { nome: 'GIF89a', bytes: Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(24)]) },
    {
      nome: 'SVG',
      bytes: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        'utf8',
      ),
    },
    {
      nome: 'SVG com cabecalho XML',
      bytes: Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8',
      ),
    },
    {
      nome: 'TIFF little endian',
      bytes: Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
    },
    {
      nome: 'TIFF big endian',
      bytes: Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00]),
    },
    { nome: 'BMP', bytes: Buffer.concat([Buffer.from('BM', 'ascii'), Buffer.alloc(52)]) },
    { nome: 'PDF', bytes: Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1') },
    { nome: 'HTML', bytes: Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8') },
    {
      nome: 'executavel Windows (MZ)',
      bytes: Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(62)]),
    },
    {
      nome: 'executavel ELF',
      bytes: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]),
    },
    {
      nome: 'JPEG 2000 (FF 4F FF 51)',
      bytes: Buffer.from([0xff, 0x4f, 0xff, 0x51, 0, 0x2f, 0, 0, 0, 0]),
    },
    {
      nome: 'texto renomeado .jpg',
      bytes: Buffer.from('isto nao e uma imagem\n'.repeat(40), 'utf8'),
    },
    { nome: 'arquivo vazio', bytes: Buffer.alloc(0) },
    { nome: '1 byte', bytes: Buffer.from([0xff]) },
    { nome: '2 bytes (FF D8)', bytes: Buffer.from([0xff, 0xd8]) },
    { nome: '3 bytes (FF D8 FF, sem o quarto)', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
    {
      nome: 'JPEG com marcador 00 no quarto byte',
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]),
    },
    {
      nome: 'PNG sem IHDR',
      bytes: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('IEND', 'ascii'),
        Buffer.alloc(4),
      ]),
    },
    { nome: 'RIFF WAVE', bytes: riff('WAVE') },
    { nome: 'RIFF AVI', bytes: riff('AVI ') },
    {
      nome: 'RIFF WEBP com chunk desconhecido',
      bytes: riffArquivo(riffChunk('XXXX', Buffer.alloc(8))),
    },
  ];
}
