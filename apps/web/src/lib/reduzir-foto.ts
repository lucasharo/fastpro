// Reducao da foto no navegador antes do envio (mesma regra do dominio: maior lado 1.280 px, JPEG em escada de
// qualidade ate 500 KB). O servidor reencoda sempre; isto so diminui o envio. Falhou? Envia o original.
const LADO_MAX = 1280;
const ALVO_BYTES = 500_000;
const QUALIDADES = [80, 72, 65, 58, 50, 44, 38, 32];
export const FOTO_MAX_BYTES = 10_485_760;

export interface FotoPreparada {
  readonly blob: Blob;
  readonly tipo: string;
}

export async function prepararFoto(arquivo: File): Promise<FotoPreparada | 'grande'> {
  const original = (): FotoPreparada | 'grande' => (arquivo.size > FOTO_MAX_BYTES ? 'grande' : { blob: arquivo, tipo: arquivo.type });
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    return original();
  }
  try {
    const maior = Math.max(imagem.width, imagem.height);
    const fator = maior > LADO_MAX ? LADO_MAX / maior : 1;
    const largura = Math.max(1, Math.round(imagem.width * fator));
    const altura = Math.max(1, Math.round(imagem.height * fator));
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original();
    ctx.drawImage(imagem, 0, 0, largura, altura);
    let ultimo: Blob | null = null;
    for (const q of QUALIDADES) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q / 100));
      if (!blob) break;
      ultimo = blob;
      if (blob.size <= ALVO_BYTES) return { blob, tipo: 'image/jpeg' };
    }
    return ultimo && ultimo.size <= FOTO_MAX_BYTES ? { blob: ultimo, tipo: 'image/jpeg' } : original();
  } finally {
    imagem.close();
  }
}
