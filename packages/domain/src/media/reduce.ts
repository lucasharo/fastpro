// H-027 (Issue #40) | Reducao e reencode das fotos (docs/factory/93-DESENHO-H027.md, §2 a §4; CA-01 a CA-08,
// CA-12; decisoes 79 a 86). Logica pura: constantes, plano de dimensoes e escada de qualidade. O navegador e o
// servidor usam estas mesmas funcoes (uma so regra; teste de paridade em R-12). Sem banco, sem Storage, sem sharp.

/** Maior lado da foto reduzida (CA-01). Foto menor nao e ampliada. */
export const MEDIA_REDUCE_MAX_SIDE = 1280;
/** Alvo de tamanho da saida (decisao 83): primeiro degrau que fica abaixo disto para. */
export const MEDIA_REDUCE_TARGET_BYTES = 500_000;
/** Teto da saida (decisao 83): acima disto, no piso de qualidade, a foto e recusada. */
export const MEDIA_REDUCE_CEILING_BYTES = 750_000;
/** Area maxima da entrada, em pixels (CA-07, §4.2). Acima disto: imagem_grande_demais. */
export const MEDIA_REDUCE_MAX_PIXELS = 64_000_000;
/** Prazo do reencode por foto (CA-07). Estourado: transitorio (decisao 84). */
export const MEDIA_REDUCE_DEADLINE_MS = 10_000;
/** Reducoes simultaneas por instancia (CA-07). */
export const MEDIA_REDUCE_MAX_CONCURRENT = 4;
/** Orcamento de pixels em voo por instancia (§4.3): soma das areas lidas nas reducoes em curso. */
export const MEDIA_REDUCE_PIXEL_BUDGET = 128_000_000;
/** Espera maxima por vaga ou por orcamento antes de 503 sem tocar o banco (§2.3). */
export const MEDIA_REDUCE_WAIT_MS = 2_000;
/** Lease do banco por tentativa (§2.2). */
export const MEDIA_REDUCE_LEASE_S = 30;
/** Tentativas contadas antes de nao_processavel (decisao 86). */
export const MEDIA_REDUCE_MAX_ATTEMPTS = 3;
/** Bucket da versao reduzida (88, 93 §3, decisao 88). Criado pela migracao 20261112140000. */
export const MEDIA_REDUCED_BUCKET = 'request-photos' as const;
/** Escada de qualidade do JPEG, do maior para o menor (S-06 §4). */
export const MEDIA_REDUCE_QUALITY_STEPS: readonly number[] = [80, 72, 65, 58, 50, 44, 38, 32];

/** Codigos fixos de recusa definitiva (decisao 84). Sem texto livre. */
export const MEDIA_REJECT_CODES = [
  'imagem_invalida',
  'imagem_grande_demais',
  'nao_cabe_no_limite',
  'nao_processavel',
] as const;
export type MediaRejectCode = (typeof MEDIA_REJECT_CODES)[number];

export function isMediaRejectCode(valor: unknown): valor is MediaRejectCode {
  return typeof valor === 'string' && (MEDIA_REJECT_CODES as readonly string[]).includes(valor);
}

/** Chave da versao reduzida: 'p/<uuid>', sem extensao e sem nome original (CA-02, CA-13). */
export function mediaReducedKey(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('chave_midia_invalida');
  }
  return `p/${id}`;
}

export interface PlanoDimensoes {
  readonly width: number;
  readonly height: number;
}

/**
 * Dimensoes finais: maior lado no maximo 1.280 px, proporcao preservada, sem ampliar. Recebe as dimensoes
 * ja no eixo real (a rotacao EXIF e aplicada antes; CA-08).
 */
export function planoDimensoes(largura: number, altura: number): PlanoDimensoes {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1) {
    throw new Error('dimensoes_invalidas');
  }
  const maior = Math.max(largura, altura);
  if (maior <= MEDIA_REDUCE_MAX_SIDE) return { width: largura, height: altura };
  const fator = MEDIA_REDUCE_MAX_SIDE / maior;
  return {
    width: Math.max(1, Math.round(largura * fator)),
    height: Math.max(1, Math.round(altura * fator)),
  };
}

export type EscolhaSaida<T> =
  | { readonly ok: true; readonly saida: T; readonly qualidade: number }
  | { readonly ok: false; readonly code: 'nao_cabe_no_limite' };

/**
 * Escada de qualidade (decisao 83): codifica do degrau mais alto para o mais baixo e para no primeiro que fica
 * em ate 500.000 bytes. Se o piso (q32) passa de 500.000 mas fica em ate 750.000, aceita o piso. Acima de
 * 750.000 no piso: nao_cabe_no_limite. O codificador e injetado (sharp no servidor, canvas no navegador).
 */
export async function escolherSaidaJpeg<T extends { readonly bytes: number }>(
  codificar: (qualidade: number) => Promise<T>,
): Promise<EscolhaSaida<T>> {
  let ultimo: T | null = null;
  let qualidadeUltimo = 0;
  for (const qualidade of MEDIA_REDUCE_QUALITY_STEPS) {
    const saida = await codificar(qualidade);
    ultimo = saida;
    qualidadeUltimo = qualidade;
    if (saida.bytes <= MEDIA_REDUCE_TARGET_BYTES) return { ok: true, saida, qualidade };
  }
  if (ultimo !== null && ultimo.bytes <= MEDIA_REDUCE_CEILING_BYTES) {
    return { ok: true, saida: ultimo, qualidade: qualidadeUltimo };
  }
  return { ok: false, code: 'nao_cabe_no_limite' };
}
