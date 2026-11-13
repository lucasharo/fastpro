// E3 (Issue 141) | Portas reais do navegador para reduzir-foto.ts (docs/factory/104-DESENHO-MIDIA-COMPOSICAO.md,
// §4.2; CA-15, CA-16). Decodifica com createImageBitmap (orientacao EXIF aplicada) e codifica JPEG com
// OffscreenCanvas ou canvas do documento. Qualquer falha devolve null: o fluxo envia o original e o servidor decide
// (fallback de 93 §4.4). Sem import de DOM: os tipos sao estruturais, para nao exigir a lib DOM no tsconfig do web.
import type { ImagemDecodificada, PortasNavegador } from './reduzir-foto.js';

interface RecursoDesenhavel {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

interface ContextoDesenho {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(recurso: unknown, x: number, y: number, w: number, h: number): void;
}

interface TelaOffscreen {
  getContext(tipo: '2d'): ContextoDesenho | null;
  convertToBlob(opcoes: { type: string; quality: number }): Promise<Blob>;
}

interface TelaDocumento {
  width: number;
  height: number;
  getContext(tipo: '2d'): ContextoDesenho | null;
  toBlob(retorno: (blob: Blob | null) => void, tipo: string, qualidade: number): void;
}

/** Subconjunto do ambiente global usado aqui (injetado nos testes). */
export interface AmbienteNavegador {
  createImageBitmap?: (arquivo: Blob, opcoes?: { imageOrientation?: string }) => Promise<RecursoDesenhavel>;
  OffscreenCanvas?: new (largura: number, altura: number) => TelaOffscreen;
  document?: { createElement(tag: 'canvas'): TelaDocumento };
}

/** Fundo branco antes do desenho: PNG e WebP com transparencia nao viram preto ao virar JPEG (R-9). */
const FUNDO = 'white';

function desenhar(ctx: ContextoDesenho | null, recurso: unknown, largura: number, altura: number): boolean {
  if (ctx === null) return false;
  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(recurso, 0, 0, largura, altura);
  return true;
}

export function criarPortasNavegador(ambiente: AmbienteNavegador = globalThis as unknown as AmbienteNavegador): PortasNavegador {
  return {
    async decodificar(arquivo: Blob): Promise<ImagemDecodificada | null> {
      if (typeof ambiente.createImageBitmap !== 'function') return null;
      try {
        const recurso = await ambiente.createImageBitmap(arquivo, { imageOrientation: 'from-image' });
        if (!(recurso.width > 0 && recurso.height > 0)) return null;
        return { width: recurso.width, height: recurso.height, recurso };
      } catch {
        return null;
      }
    },

    async codificar(imagem: ImagemDecodificada, largura: number, altura: number, qualidade: number): Promise<Blob | null> {
      try {
        if (typeof ambiente.OffscreenCanvas === 'function') {
          const tela = new ambiente.OffscreenCanvas(largura, altura);
          if (!desenhar(tela.getContext('2d'), imagem.recurso, largura, altura)) return null;
          return await tela.convertToBlob({ type: 'image/jpeg', quality: qualidade });
        }
        if (ambiente.document === undefined) return null;
        const tela = ambiente.document.createElement('canvas');
        tela.width = largura;
        tela.height = altura;
        if (!desenhar(tela.getContext('2d'), imagem.recurso, largura, altura)) return null;
        return await new Promise<Blob | null>((resolver) => tela.toBlob(resolver, 'image/jpeg', qualidade));
      } catch {
        return null;
      }
    },

    liberar(imagem: ImagemDecodificada): void {
      const recurso = imagem.recurso as RecursoDesenhavel | null;
      if (recurso && typeof recurso.close === 'function') recurso.close();
    },
  };
}
