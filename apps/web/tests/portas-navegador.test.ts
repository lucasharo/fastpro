// E3 (Issue 141, CA-15 e CA-16) | Portas reais do navegador (src/media/portas-navegador.ts) com ambiente falso:
// decodificacao com orientacao EXIF, codificacao JPEG com fundo branco (OffscreenCanvas e canvas do documento),
// fallback para null em qualquer falha e liberacao do bitmap ao fim da reducao.
import { describe, it, expect } from 'vitest';
import { criarPortasNavegador, type AmbienteNavegador } from '../src/media/portas-navegador.js';
import { prepararEnvio } from '../src/media/reduzir-foto.js';

interface Registro {
  opcoesDecodificacao?: unknown;
  operacoes: string[];
  fecharChamado: number;
  tamanhosCanvas: Array<[number, number]>;
  qualidades: number[];
}

function ambienteCompleto(reg: Registro, larguraImagem = 4000, alturaImagem = 3000): AmbienteNavegador {
  const recurso = {
    width: larguraImagem,
    height: alturaImagem,
    close() {
      reg.fecharChamado++;
    },
  };
  class TelaOffscreen {
    constructor(
      public width: number,
      public height: number,
    ) {
      reg.tamanhosCanvas.push([width, height]);
    }
    getContext() {
      const ctx = {
        fillStyle: '',
        fillRect: (x: number, y: number, w: number, h: number) =>
          reg.operacoes.push(`preencher:${ctx.fillStyle}:${x},${y},${w},${h}`),
        drawImage: () => reg.operacoes.push('desenhar'),
      };
      return ctx;
    }
    async convertToBlob(opcoes: { type: string; quality: number }) {
      reg.qualidades.push(opcoes.quality);
      return new Blob(['jpeg'], { type: opcoes.type });
    }
  }
  return {
    createImageBitmap: async (_arquivo, opcoes) => {
      reg.opcoesDecodificacao = opcoes;
      return recurso;
    },
    OffscreenCanvas: TelaOffscreen as unknown as AmbienteNavegador['OffscreenCanvas'],
  };
}

const novo = (): Registro => ({ operacoes: [], fecharChamado: 0, tamanhosCanvas: [], qualidades: [] });
const arquivoJpeg = (tamanho = 5000) => new Blob([new Uint8Array(tamanho)], { type: 'image/jpeg' });

describe('E3 (Issue 141) portas do navegador: decodificar', () => {
  it('pede a orientacao EXIF aplicada (imageOrientation from-image) e devolve as dimensoes reais', async () => {
    const reg = novo();
    const portas = criarPortasNavegador(ambienteCompleto(reg, 4000, 3000));
    const img = await portas.decodificar(arquivoJpeg());
    expect(reg.opcoesDecodificacao).toEqual({ imageOrientation: 'from-image' });
    expect(img).toMatchObject({ width: 4000, height: 3000 });
  });

  it('sem createImageBitmap devolve null (o original segue e o servidor reduz)', async () => {
    const portas = criarPortasNavegador({});
    expect(await portas.decodificar(arquivoJpeg())).toBeNull();
  });

  it('quando o navegador recusa a opcao de orientacao (lanca) devolve null, sem propagar', async () => {
    const portas = criarPortasNavegador({
      createImageBitmap: async () => {
        throw new TypeError('imageOrientation nao suportado');
      },
    });
    expect(await portas.decodificar(arquivoJpeg())).toBeNull();
  });

  it('dimensoes zeradas devolvem null', async () => {
    const reg = novo();
    const portas = criarPortasNavegador(ambienteCompleto(reg, 0, 3000));
    expect(await portas.decodificar(arquivoJpeg())).toBeNull();
  });
});

describe('E3 (Issue 141) portas do navegador: codificar', () => {
  it('OffscreenCanvas: pinta de branco antes de desenhar (PNG com transparencia nao vira preto) e codifica JPEG com a qualidade 0-1', async () => {
    const reg = novo();
    const portas = criarPortasNavegador(ambienteCompleto(reg));
    const img = (await portas.decodificar(arquivoJpeg()))!;
    const blob = await portas.codificar(img, 1280, 960, 0.8);
    expect(blob?.type).toBe('image/jpeg');
    expect(reg.tamanhosCanvas).toEqual([[1280, 960]]);
    expect(reg.operacoes).toEqual(['preencher:white:0,0,1280,960', 'desenhar']);
    expect(reg.qualidades).toEqual([0.8]);
  });

  it('canvas do documento: usa o mesmo fundo e toBlob com image/jpeg', async () => {
    const chamadas: Array<{ tipo: string; qualidade: number }> = [];
    const operacoes: string[] = [];
    const portas = criarPortasNavegador({
      createImageBitmap: async () => ({ width: 10, height: 10 }),
      document: {
        createElement: () => {
          const tela = {
            width: 0,
            height: 0,
            getContext: () => ({
              fillStyle: '',
              fillRect: () => operacoes.push('preencher'),
              drawImage: () => operacoes.push('desenhar'),
            }),
            toBlob: (retorno: (b: Blob | null) => void, tipo: string, qualidade: number) => {
              chamadas.push({ tipo, qualidade });
              retorno(new Blob(['x'], { type: tipo }));
            },
          };
          return tela;
        },
      },
    });
    const img = (await portas.decodificar(arquivoJpeg()))!;
    const blob = await portas.codificar(img, 640, 480, 0.5);
    expect(blob).not.toBeNull();
    expect(chamadas).toEqual([{ tipo: 'image/jpeg', qualidade: 0.5 }]);
    expect(operacoes).toEqual(['preencher', 'desenhar']);
  });

  it('toBlob devolvendo null, contexto ausente ou sem nenhum canvas: devolve null', async () => {
    const semBlob = criarPortasNavegador({
      createImageBitmap: async () => ({ width: 10, height: 10 }),
      document: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
          toBlob: (retorno: (b: Blob | null) => void) => retorno(null),
        }),
      },
    });
    const img = (await semBlob.decodificar(arquivoJpeg()))!;
    expect(await semBlob.codificar(img, 10, 10, 0.8)).toBeNull();

    const semContexto = criarPortasNavegador({
      OffscreenCanvas: class {
        getContext() {
          return null;
        }
        async convertToBlob(): Promise<Blob> {
          return new Blob(['x']);
        }
      } as unknown as AmbienteNavegador['OffscreenCanvas'],
    });
    expect(await semContexto.codificar({ width: 10, height: 10, recurso: {} }, 10, 10, 0.8)).toBeNull();

    const semCanvas = criarPortasNavegador({});
    expect(await semCanvas.codificar({ width: 10, height: 10, recurso: {} }, 10, 10, 0.8)).toBeNull();
  });

  it('falha ao desenhar (lanca) vira null, sem propagar', async () => {
    const portas = criarPortasNavegador({
      OffscreenCanvas: class {
        getContext() {
          throw new Error('sem memoria');
        }
        async convertToBlob(): Promise<Blob> {
          return new Blob(['x']);
        }
      } as unknown as AmbienteNavegador['OffscreenCanvas'],
    });
    expect(await portas.codificar({ width: 10, height: 10, recurso: {} }, 10, 10, 0.8)).toBeNull();
  });
});

describe('E3 (Issue 141) portas do navegador com a reducao (prepararEnvio)', () => {
  it('libera o bitmap ao fim da reducao, mesmo quando a codificacao falha, e cai no original', async () => {
    const reg = novo();
    const ambiente = ambienteCompleto(reg);
    ambiente.OffscreenCanvas = class {
      getContext() {
        return null;
      }
      async convertToBlob(): Promise<Blob> {
        return new Blob(['x']);
      }
    } as unknown as AmbienteNavegador['OffscreenCanvas'];
    const portas = criarPortasNavegador(ambiente);
    const r = await prepararEnvio(arquivoJpeg(5000), 'image/jpeg', portas);
    expect(r).toEqual({ reduzida: false, contentType: 'image/jpeg', blob: expect.any(Blob) });
    expect(reg.fecharChamado).toBe(1);
  });

  it('com a reducao, o JPEG reduzido e o tipo image/jpeg; o bitmap e fechado uma vez', async () => {
    const reg = novo();
    const portas = criarPortasNavegador(ambienteCompleto(reg));
    const r = await prepararEnvio(arquivoJpeg(), 'image/png', portas);
    expect(r).toMatchObject({ reduzida: true, contentType: 'image/jpeg' });
    expect(reg.tamanhosCanvas[0]).toEqual([1280, 960]);
    expect(reg.fecharChamado).toBe(1);
  });
});
