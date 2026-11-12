// H-027 (Issue #40) | Redutor real com sharp (docs/factory/93-DESENHO-H027.md, §4.2 e §8). Unico modulo que importa
// sharp. A carga e preguicosa: se a biblioteca nao carregar no ambiente, a porta devolve transitorio 'unavailable'
// (503, sem consumir tentativa e sem rejeitar a foto; decisao 85). Nenhuma mensagem de biblioteca sai daqui.
import {
  MEDIA_REDUCE_MAX_PIXELS,
  MEDIA_REDUCE_MAX_SIDE,
  escolherSaidaJpeg,
  type ImageReducerPort,
  type ReduceBudgetPort,
  type ReduceOutcome,
} from '@fastpro/domain';

type SharpFn = typeof import('sharp').default;

let carga: Promise<SharpFn | null> | null = null;

/** Carrega sharp uma vez por instancia, com uma thread e sem cache de operacoes (decisao 85, §4.2 passo 1). */
function carregarSharp(): Promise<SharpFn | null> {
  carga ??= import('sharp').then(
    (m) => {
      const s = m.default;
      s.concurrency(1);
      s.cache(false);
      return s;
    },
    () => null,
  );
  return carga;
}

/** Prazo estourado no meio do reencode: vira transitorio 'timeout'. */
class PrazoEstourado extends Error {}

/** Falha de memoria da biblioteca: transitoria 'memory' (conta tentativa). Nao copia a mensagem. */
function ehMemoria(erro: unknown): boolean {
  const texto = erro instanceof Error ? erro.message : '';
  return /memory|alloc|ENOMEM/i.test(texto);
}

export interface SharpReducerOpcoes {
  /** Relogio em ms; injetavel para o teste de prazo (R-05). */
  readonly agora?: () => number;
}

export class SharpImageReducer implements ImageReducerPort {
  constructor(private readonly opts: SharpReducerOpcoes = {}) {}

  async reduce(
    bytes: Uint8Array,
    opts: { readonly deadlineMs: number; readonly orcamento?: ReduceBudgetPort },
  ): Promise<ReduceOutcome> {
    const sharp = await carregarSharp();
    if (sharp === null) return { ok: false, kind: 'transient', cause: 'unavailable' };

    const agora = this.opts.agora ?? (() => Date.now());
    const inicio = agora();
    const prazoEstourado = (): boolean => agora() - inicio > opts.deadlineMs;
    const entrada = Buffer.from(bytes);

    // Cabecalho apenas: formato e dimensoes antes de qualquer decodificacao (§4.2 passo 2).
    const meta = await sharp(entrada, { failOn: 'error', limitInputPixels: false })
      .metadata()
      .catch(() => null);
    if (meta === null || (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp')) {
      return { ok: false, kind: 'definitive', code: 'imagem_invalida' };
    }
    const largura = meta.width ?? 0;
    const altura = meta.height ?? 0;
    if (!(largura >= 1 && altura >= 1)) return { ok: false, kind: 'definitive', code: 'imagem_invalida' };
    const area = largura * altura;
    if (area > MEDIA_REDUCE_MAX_PIXELS) return { ok: false, kind: 'definitive', code: 'imagem_grande_demais' };

    const reserva = opts.orcamento === undefined ? { liberar: (): void => undefined } : await opts.orcamento.reservar(area);
    if (reserva === null) return { ok: false, kind: 'transient', cause: 'ocupado' };
    try {
      return await this.reduzir(sharp, entrada, prazoEstourado);
    } finally {
      reserva.liberar();
    }
  }

  private async reduzir(sharp: SharpFn, entrada: Buffer, prazoEstourado: () => boolean): Promise<ReduceOutcome> {
    if (prazoEstourado()) return { ok: false, kind: 'transient', cause: 'timeout' };

    // Decodifica, aplica a orientacao EXIF, reduz (sem ampliar), converte para sRGB e tira o alfa (CA-08, CA-09).
    let raw: { readonly data: Buffer; readonly info: { readonly width: number; readonly height: number; readonly channels: number } };
    try {
      raw = await sharp(entrada, { failOn: 'truncated', limitInputPixels: MEDIA_REDUCE_MAX_PIXELS })
        .rotate()
        .resize(MEDIA_REDUCE_MAX_SIDE, MEDIA_REDUCE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch (erro) {
      return ehMemoria(erro)
        ? { ok: false, kind: 'transient', cause: 'memory' }
        : { ok: false, kind: 'definitive', code: 'imagem_invalida' };
    }
    if (prazoEstourado()) return { ok: false, kind: 'transient', cause: 'timeout' };

    const { width, height } = raw.info;
    const canais: 3 | 4 = raw.info.channels === 4 ? 4 : 3;
    try {
      const escolha = await escolherSaidaJpeg(async (qualidade) => {
        if (prazoEstourado()) throw new PrazoEstourado();
        // Saida a partir do bruto: nenhum metadado de entrada e copiado (CA-09). Nenhuma opcao de metadado e usada aqui.
        const out = await sharp(raw.data, { raw: { width, height, channels: canais } })
          .jpeg({ quality: qualidade, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        return { bytes: out.data.length, data: out.data, width: out.info.width, height: out.info.height };
      });
      if (!escolha.ok) return { ok: false, kind: 'definitive', code: escolha.code };
      const saida = escolha.saida;
      return { ok: true, bytes: new Uint8Array(saida.data), width: saida.width, height: saida.height };
    } catch (erro) {
      if (erro instanceof PrazoEstourado) return { ok: false, kind: 'transient', cause: 'timeout' };
      return { ok: false, kind: 'transient', cause: ehMemoria(erro) ? 'memory' : 'unavailable' };
    }
  }
}
