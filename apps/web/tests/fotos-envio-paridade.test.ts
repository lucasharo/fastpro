// E3 (Issue 141, CA-15) | Paridade da reducao: executa o BUNDLE gerado (public/fotos-envio.js) em um contexto vm com
// createImageBitmap e OffscreenCanvas falsos e compara, para varias dimensoes e curvas de tamanho, as dimensoes
// pedidas ao canvas, as qualidades tentadas e o tamanho enviado, com o que as funcoes do dominio (planoDimensoes e
// escolherSaidaJpeg, a mesma regra do servidor) devolvem. Falha se o bundle divergir do dominio.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MEDIA_MAX_BYTES, MEDIA_REDUCE_QUALITY_STEPS, escolherSaidaJpeg, planoDimensoes } from '@fastpro/domain';

const SCRIPT_GERADOR = fileURLToPath(new URL('../scripts/build-fotos-envio.mjs', import.meta.url));
const BUNDLE_CAMINHO = fileURLToPath(new URL('../public/fotos-envio.js', import.meta.url));

interface Curva {
  readonly nome: string;
  /** Bytes produzidos por uma qualidade (0-100). */
  readonly bytes: (qualidade: number) => number;
}

const CURVAS: readonly Curva[] = [
  // Os degraus de 80 a 65 passam de 750.000; q58 fica em 620.000 (acima do alvo); q50 em 400.000: para em q50.
  { nome: 'para em q50', bytes: (q) => (q >= 65 ? 900_000 - q * 1000 : q >= 58 ? 620_000 : 400_000) },
  // Nenhum degrau chega a 500.000, mas o piso (q32) fica em ate 750.000: aceita o piso.
  { nome: 'aceita o piso', bytes: () => 600_000 },
  // Piso acima de 750.000: nao cabe no limite; o original segue.
  { nome: 'nao cabe', bytes: () => 800_000 },
  // Passa em q80 logo na primeira tentativa.
  { nome: 'primeiro degrau', bytes: () => 300_000 },
];

const DIMENSOES: ReadonlyArray<readonly [number, number]> = [
  [4000, 3000],
  [1280, 720],
  [640, 480],
  [10000, 500],
  [1, 1],
  [900, 1600],
  [1281, 1281],
];

interface Gravacao {
  readonly dimensoes: Array<{ width: number; height: number }>;
  readonly qualidades: number[];
  readonly emitidos: Array<{ content_type: string; size_bytes: number }>;
  readonly enviados: number[];
}

interface EnvioNavegador {
  enviar(
    arquivo: Blob,
    tipo: string,
    ganchos: {
      emitir: (corpo: { content_type: string; size_bytes: number }) => Promise<unknown>;
      enviar: (blob: Blob) => Promise<unknown>;
    },
  ): Promise<unknown>;
}

/** Executa o bundle num contexto isolado e devolve o que ele pediu ao canvas e o que enviou. */
async function executarBundle(largura: number, altura: number, curva: Curva, tamanhoOriginal: number): Promise<Gravacao> {
  const bundle = readFileSync(BUNDLE_CAMINHO, 'utf8');
  const gravacao: Gravacao = { dimensoes: [], qualidades: [], emitidos: [], enviados: [] };
  class TelaFalsa {
    constructor(
      public width: number,
      public height: number,
    ) {
      gravacao.dimensoes.push({ width, height });
    }
    getContext() {
      return { fillStyle: '', fillRect() {}, drawImage() {} };
    }
    async convertToBlob(opcoes: { type: string; quality: number }) {
      const q = Math.round(opcoes.quality * 100);
      gravacao.qualidades.push(q);
      if (opcoes.type !== 'image/jpeg') throw new Error('tipo inesperado');
      return new Blob([new Uint8Array(curva.bytes(q))], { type: 'image/jpeg' });
    }
  }
  const sandbox: Record<string, unknown> = {
    Blob,
    createImageBitmap: async () => ({ width: largura, height: altura, close() {} }),
    OffscreenCanvas: TelaFalsa,
  };
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);
  const envio = (sandbox as { FastProFotosEnvio?: EnvioNavegador }).FastProFotosEnvio;
  if (!envio) throw new Error('FastProFotosEnvio ausente no bundle');
  await envio.enviar(new Blob([new Uint8Array(tamanhoOriginal)], { type: 'image/jpeg' }), 'image/jpeg', {
    emitir: async (corpo: { content_type: string; size_bytes: number }) => {
      gravacao.emitidos.push(corpo);
    },
    enviar: async (blob: Blob) => {
      gravacao.enviados.push(blob.size);
    },
  });
  return gravacao;
}

/** A mesma regra, calculada direto no dominio, com o mesmo codificador falso. */
async function esperadoDoDominio(largura: number, altura: number, curva: Curva) {
  const plano = planoDimensoes(largura, altura);
  const qualidades: number[] = [];
  const escolha = await escolherSaidaJpeg(async (qualidade) => {
    qualidades.push(qualidade);
    return { bytes: curva.bytes(qualidade) };
  });
  return { plano, qualidades, escolha };
}

describe('E3 (Issue 141, CA-15) paridade entre o bundle do navegador e o dominio', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [SCRIPT_GERADOR], { stdio: 'pipe' });
  });

  it('a escada de qualidade do bundle e a do dominio', () => {
    expect(MEDIA_REDUCE_QUALITY_STEPS).toEqual([80, 72, 65, 58, 50, 44, 38, 32]);
  });

  for (const curva of CURVAS) {
    for (const [largura, altura] of DIMENSOES) {
      it(`${largura}x${altura} com curva "${curva.nome}": dimensoes, qualidades e envio iguais ao dominio`, async () => {
        const original = 2_000_000;
        const grav = await executarBundle(largura, altura, curva, original);
        const esp = await esperadoDoDominio(largura, altura, curva);

        // Dimensoes pedidas ao canvas: uma por tentativa de qualidade, todas iguais ao plano do dominio.
        expect(grav.dimensoes.length).toBe(esp.qualidades.length);
        for (const d of grav.dimensoes) expect(d).toEqual({ width: esp.plano.width, height: esp.plano.height });
        // Escada de qualidade na mesma ordem e com o mesmo corte.
        expect(grav.qualidades).toEqual(esp.qualidades);
        // O que e enviado: o JPEG reduzido (escolhido) ou o original, com o tamanho certo no emitir.
        if (esp.escolha.ok) {
          const bytesEscolhidos = curva.bytes(esp.escolha.qualidade);
          expect(grav.emitidos).toEqual([{ content_type: 'image/jpeg', size_bytes: bytesEscolhidos }]);
          expect(grav.enviados).toEqual([bytesEscolhidos]);
        } else {
          expect(grav.emitidos).toEqual([{ content_type: 'image/jpeg', size_bytes: original }]);
          expect(grav.enviados).toEqual([original]);
        }
      });
    }
  }

  it('original acima do teto de 10 MB sem reducao: o bundle recusa com arquivo_grande e nao emite', async () => {
    const enviosChamados: number[] = [];
    const sandbox: Record<string, unknown> = { Blob, createImageBitmap: async () => null };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(BUNDLE_CAMINHO, 'utf8'), sandbox);
    const envio = (sandbox as { FastProFotosEnvio: EnvioNavegador }).FastProFotosEnvio;
    const r = await envio.enviar(new Blob([new Uint8Array(MEDIA_MAX_BYTES + 1)], { type: 'image/jpeg' }), 'image/jpeg', {
      emitir: async () => enviosChamados.push(-1),
      enviar: async () => enviosChamados.push(-2),
    });
    expect(r).toEqual({ code: 'arquivo_grande' });
    expect(enviosChamados).toEqual([]);
  });
});
