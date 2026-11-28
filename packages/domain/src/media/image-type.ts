// H-028 (Issue #41) | Tipo da imagem pelo conteudo (docs/factory/96-DESENHO-H028.md, §2.2; CA-04, CA-05, CA-06,
// CA-07; decisoes 93, 96). Funcao pura: so compara os primeiros bytes. Nunca lanca excecao, aceita qualquer
// comprimento (inclusive zero) e nao importa nenhum modulo. Lista fechada: o que nao casa devolve null.
// A assinatura prova so que o arquivo comeca como um dos tres formatos; o decodificador e o reencode cuidam do resto.

export type ImageKind = 'jpeg' | 'png' | 'webp';

const PNG_ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IHDR_TAM = [0x00, 0x00, 0x00, 0x0d] as const;
const WEBP_VP8 = ['VP8 ', 'VP8L', 'VP8X'] as const;

function casa(bytes: Uint8Array, deslocamento: number, esperado: readonly number[]): boolean {
  if (bytes.length < deslocamento + esperado.length) return false;
  for (let i = 0; i < esperado.length; i++) {
    if (bytes[deslocamento + i] !== esperado[i]) return false;
  }
  return true;
}

function casaTexto(bytes: Uint8Array, deslocamento: number, texto: string): boolean {
  const ascii: number[] = [];
  for (let i = 0; i < texto.length; i++) ascii.push(texto.charCodeAt(i));
  return casa(bytes, deslocamento, ascii);
}

/**
 * Detecta JPEG, PNG ou WebP pelos bytes iniciais. Devolve null para qualquer outra coisa (HEIC, HEIF, AVIF, GIF,
 * TIFF, BMP, PDF, SVG, HTML, executavel, texto, vazio). O resultado nunca carrega o tipo recusado.
 */
export function detectarTipoImagem(bytes: Uint8Array): ImageKind | null {
  // JPEG: FF D8 FF seguido de byte de marcador (diferente de 00 e de FF).
  if (bytes.length >= 4 && casa(bytes, 0, [0xff, 0xd8, 0xff])) {
    const marcador = bytes[3];
    if (marcador !== undefined && marcador !== 0x00 && marcador !== 0xff) return 'jpeg';
  }

  // PNG: assinatura de 8 bytes, depois o bloco IHDR de 13 bytes (comprimento 0x0D e tipo IHDR).
  if (
    bytes.length >= 16 &&
    casa(bytes, 0, PNG_ASSINATURA) &&
    casa(bytes, 8, PNG_IHDR_TAM) &&
    casaTexto(bytes, 12, 'IHDR')
  ) {
    return 'png';
  }

  // WebP: contêiner RIFF com marca WEBP e primeiro chunk VP8 , VP8L ou VP8X.
  if (bytes.length >= 16 && casaTexto(bytes, 0, 'RIFF') && casaTexto(bytes, 8, 'WEBP')) {
    for (const chunk of WEBP_VP8) {
      if (casaTexto(bytes, 12, chunk)) return 'webp';
    }
  }

  return null;
}
