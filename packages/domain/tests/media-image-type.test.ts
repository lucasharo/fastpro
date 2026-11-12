// H-028 (Issue #41) | Assinatura do tipo da imagem (docs/factory/96-DESENHO-H028.md, §2.2, §5 e X-01; CA-05, CA-06,
// CA-07). Vetores aceitos, vetores da lista fechada de recusa e buffers pseudoaleatorios com semente fixa.
// O teste estatico de que a funcao e pura (sem imports) fica em apps/api/tests/media-tipo-h028.test.ts, porque
// packages/domain nao pode importar I/O nem nos testes (scripts/check-module-boundaries.mjs). Dados sinteticos.
import { describe, expect, it } from 'vitest';
import { detectarTipoImagem } from '../src/index.js';

const hex = (s: string): Uint8Array => Uint8Array.from(s.split(' ').map((h) => parseInt(h, 16)));
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const bytes = (...partes: (number[] | Uint8Array)[]): Uint8Array => {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};
const zeros = (n: number): Uint8Array => new Uint8Array(n);
const PNG_CABECALHO = hex('89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52');
/** RIFF <tam> WEBP <chunk> (o tamanho do RIFF nao e checado pela assinatura). */
const webp = (chunk: string): Uint8Array =>
  bytes(ascii('RIFF'), zeros(4), ascii('WEBP'), ascii(chunk), zeros(8));

describe('H-028 | X-01 detectarTipoImagem: aceita JPEG, PNG e WebP pelo conteudo (CA-04)', () => {
  const aceitos: [string, Uint8Array, 'jpeg' | 'png' | 'webp'][] = [
    ['JPEG JFIF (FF D8 FF E0)', bytes(hex('FF D8 FF E0'), zeros(20)), 'jpeg'],
    ['JPEG Exif (FF D8 FF E1)', bytes(hex('FF D8 FF E1'), zeros(20)), 'jpeg'],
    ['JPEG tabela de quantizacao (FF D8 FF DB)', bytes(hex('FF D8 FF DB'), zeros(20)), 'jpeg'],
    ['PNG com IHDR', bytes(PNG_CABECALHO, zeros(9)), 'png'],
    ['WebP VP8 com dimensoes', webp('VP8 '), 'webp'],
    ['WebP VP8L (sem perda)', webp('VP8L'), 'webp'],
    ['WebP VP8X (extendido)', webp('VP8X'), 'webp'],
  ];
  it.each(aceitos)('%s', (_nome, entrada, esperado) => {
    expect(detectarTipoImagem(entrada)).toBe(esperado);
  });
});

describe('H-028 | X-01 detectarTipoImagem: null para tudo que nao casa com a lista fechada (CA-05, CA-06, CA-07)', () => {
  const recusados: [string, Uint8Array][] = [
    ['vazio (0 byte)', new Uint8Array(0)],
    ['1 byte', hex('FF')],
    ['3 bytes FF D8 FF', hex('FF D8 FF')],
    ['FF D8 FF 00 (marcador invalido)', hex('FF D8 FF 00 00 00')],
    ['FF D8 FF FF (marcador invalido)', hex('FF D8 FF FF 00 00')],
    ['PNG sem IHDR', bytes(hex('89 50 4E 47 0D 0A 1A 0A'), zeros(8))],
    [
      'PNG com comprimento errado',
      bytes(hex('89 50 4E 47 0D 0A 1A 0A 00 00 00 0E 49 48 44 52'), zeros(4)),
    ],
    ['PNG de 15 bytes (menos que o minimo)', bytes(PNG_CABECALHO.subarray(0, 15))],
    [
      'RIFF sem WEBP (WAVE)',
      bytes(ascii('RIFF'), zeros(4), ascii('WAVE'), ascii('fmt '), zeros(8)),
    ],
    ['RIFF WEBP com chunk XXXX', webp('XXXX')],
    ['HEIC (ftyp heic)', bytes(hex('00 00 00 18'), ascii('ftypheic'), zeros(20))],
    ['HEIF (ftyp mif1)', bytes(hex('00 00 00 18'), ascii('ftypmif1'), zeros(20))],
    ['AVIF (ftyp avif)', bytes(hex('00 00 00 18'), ascii('ftypavif'), zeros(20))],
    ['GIF89a', bytes(ascii('GIF89a'), zeros(20))],
    ['TIFF little endian', hex('49 49 2A 00 08 00 00 00 00 00')],
    ['TIFF big endian', hex('4D 4D 00 2A 00 00 00 08 00 00')],
    ['BMP', bytes(ascii('BM'), zeros(52))],
    ['PDF', bytes(ascii('%PDF-1.7\n'), zeros(10))],
    ['SVG', bytes(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))],
    ['HTML', bytes(ascii('<!doctype html><script>x</script>'))],
    ['executavel MZ', bytes(ascii('MZ'), zeros(62))],
    ['executavel ELF', bytes(hex('7F 45 4C 46'), zeros(60))],
    ['JPEG 2000 (FF 4F FF 51)', hex('FF 4F FF 51 00 2F 00 00')],
    ['texto renomeado .jpg', bytes(ascii('isto nao e uma imagem\n'.repeat(4)))],
  ];

  it.each(recusados)('%s -> null', (_nome, entrada) => {
    expect(detectarTipoImagem(entrada)).toBeNull();
  });

  it('nunca lanca excecao e nunca devolve tipo para 2.000 buffers pseudoaleatorios de 0 a 64 bytes (semente fixa)', () => {
    // Gerador linear congruencial de semente fixa: o mesmo conjunto em todas as execucoes.
    let semente = 0x2d_28_00_41;
    const proximo = (): number => {
      semente = (Math.imul(semente, 1103515245) + 12345) >>> 0;
      return (semente >>> 16) & 0xff;
    };
    const validos = new Set(['jpeg', 'png', 'webp', null]);
    for (let i = 0; i < 2000; i++) {
      const tam = i % 65;
      const entrada = new Uint8Array(tam);
      for (let j = 0; j < tam; j++) entrada[j] = proximo();
      let resultado: unknown;
      expect(() => {
        resultado = detectarTipoImagem(entrada);
      }).not.toThrow();
      expect(validos.has(resultado as string | null)).toBe(true);
    }
  });
});
