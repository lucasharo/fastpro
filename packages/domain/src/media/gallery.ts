// H-029 (Issue #42) | Galeria do dono: listagem, exclusao, reordenacao e leitura da versao reduzida
// (docs/factory/98-DESENHO-H029.md, §2 e §3). Logica pura: banco e Storage ficam nos adaptadores.
import type { DraftRatePolicy } from '../draft/request-draft.js';
import { isMediaId } from './media.js';
import { isMediaRejectCode, type MediaRejectCode } from './reduce.js';

export const MEDIA_PHOTOS_PATH = '/v1/media/photos' as const;
export const MEDIA_ORDER_PATH = '/v1/media/photos/order' as const;
/** Teto do corpo da reordenacao (98 §2.4). */
export const MEDIA_ORDER_BODY_LIMIT_BYTES = 1024;
/** Teto da leitura da versao reduzida (igual ao bucket request-photos). */
export const MEDIA_IMAGE_MAX_BYTES = 750_000;
/** Orcamento da remocao fisica inline do DELETE (98 §2.3). */
export const MEDIA_DELETE_PHYSICAL_BUDGET_MS = 2000;
/** Maximo de fotos vivas por pedido (decisao 117 e 93 §2.2). */
export const MEDIA_GALLERY_MAX_ITEMS = 5;

// Cotas da galeria (98 §2.2 a §2.4). Mesmo balde de rl_check/rl_hit, prefixo proprio.
export const MEDIA_RATE_IMAGEM_IP: DraftRatePolicy = {
  id: 'media_imagem_ip',
  spanS: 60,
  bucketS: 10,
  limit: 120,
};
export const MEDIA_RATE_EXCLUI_RASCUNHO: DraftRatePolicy = {
  id: 'media_exclui_rascunho',
  spanS: 3600,
  bucketS: 300,
  limit: 30,
};
export const MEDIA_RATE_ORDEM_RASCUNHO: DraftRatePolicy = {
  id: 'media_ordem_rascunho',
  spanS: 3600,
  bucketS: 300,
  limit: 120,
};

export type GaleriaEstado = 'enviando' | 'aguardando' | 'processando' | 'pronta' | 'recusada';
const ESTADOS: readonly string[] = ['enviando', 'aguardando', 'processando', 'pronta', 'recusada'];

/** Linha como a funcao media_list a devolve (sem id quando o rascunho nao tem foto). */
export interface GaleriaLinha {
  readonly id: string | null;
  readonly estado: string;
  readonly motivo: string | null;
  readonly posicao: number | null;
}

/** Foto da lista: so as chaves da 98 §2.1. Motivo so em recusada; posicao so nas nao recusadas. */
export type GaleriaFoto =
  | { readonly id: string; readonly estado: 'recusada'; readonly motivo: MediaRejectCode }
  | { readonly id: string; readonly estado: Exclude<GaleriaEstado, 'recusada'>; readonly posicao: number };

/** Converte a linha do banco na forma publica; estado ou motivo fora da lista fixa viram erro interno. */
export function galeriaDeLinha(linha: GaleriaLinha): GaleriaFoto | null {
  if (linha.id === null) return null;
  if (!ESTADOS.includes(linha.estado)) throw new Error('galeria_resposta_invalida');
  if (linha.estado === 'recusada') {
    if (linha.motivo === null || !isMediaRejectCode(linha.motivo)) throw new Error('galeria_resposta_invalida');
    return { id: linha.id, estado: 'recusada', motivo: linha.motivo };
  }
  if (linha.posicao === null) throw new Error('galeria_resposta_invalida');
  return { id: linha.id, estado: linha.estado as Exclude<GaleriaEstado, 'recusada'>, posicao: linha.posicao };
}

/** Corpo 200/409 de listagem e reordenacao: { fotos: [...] } com lista fechada de chaves. */
export function visaoGaleria(linhas: readonly GaleriaLinha[]): { readonly fotos: readonly GaleriaFoto[] } {
  const fotos: GaleriaFoto[] = [];
  for (const linha of linhas) {
    const foto = galeriaDeLinha(linha);
    if (foto !== null) fotos.push(foto);
  }
  return { fotos };
}

export type MediaOrderParse =
  | { readonly ok: true; readonly atual: readonly string[]; readonly nova: readonly string[] }
  | { readonly ok: false; readonly status: 413 | 422; readonly code: string };

const CHAVES_ORDEM = ['ordem_atual', 'ordem_nova'] as const;

/**
 * Corpo do PUT /v1/media/photos/order (98 §2.4). So as chaves ordem_atual e ordem_nova; vazio, mais de 5,
 * nao uuid, repetido ou nova que nao e permutacao da atual sao recusados antes de qualquer banco.
 */
export function parseMediaOrderBody(texto: string, bytes: number): MediaOrderParse {
  if (bytes > MEDIA_ORDER_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const registro = corpo as Record<string, unknown>;
  if (Object.keys(registro).some((chave) => !(CHAVES_ORDEM as readonly string[]).includes(chave))) {
    return { ok: false, status: 422, code: 'campo_desconhecido' };
  }
  const atual = registro.ordem_atual;
  const nova = registro.ordem_nova;
  if (!Array.isArray(atual) || !Array.isArray(nova)) return { ok: false, status: 422, code: 'corpo_invalido' };
  if (atual.length === 0 || nova.length === 0) return { ok: false, status: 422, code: 'vazio' };
  if (atual.length > MEDIA_GALLERY_MAX_ITEMS || nova.length !== atual.length) {
    return { ok: false, status: 422, code: 'ordem_invalida' };
  }
  const ids = (lista: readonly unknown[]): string[] | null => {
    const saida: string[] = [];
    for (const item of lista) {
      if (!isMediaId(item)) return null;
      saida.push(item);
    }
    return saida;
  };
  const idsAtual = ids(atual);
  const idsNova = ids(nova);
  if (idsAtual === null || idsNova === null) return { ok: false, status: 422, code: 'ordem_invalida' };
  if (new Set(idsAtual).size !== idsAtual.length || new Set(idsNova).size !== idsNova.length) {
    return { ok: false, status: 422, code: 'ordem_invalida' };
  }
  const conjuntoAtual = new Set(idsAtual);
  if (!idsNova.every((id) => conjuntoAtual.has(id))) return { ok: false, status: 422, code: 'ordem_invalida' };
  return { ok: true, atual: idsAtual, nova: idsNova };
}

/** Teste de imagem entregue pela leitura: tamanho exato, teto e assinatura JPEG (conferencia antes de servir). */
export function fotoReduzidaValida(bytes: Uint8Array, bytesDeclarados: number): boolean {
  return (
    bytes.byteLength === bytesDeclarados &&
    bytes.byteLength > 0 &&
    bytes.byteLength <= MEDIA_IMAGE_MAX_BYTES &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

export type MediaDeleteCode = 'deleted' | 'already' | 'not_found';
export type MediaReorderCode = 'ok' | 'unchanged' | 'changed' | 'invalid' | 'not_found';

/** Porta do banco da galeria (funcoes private.media_list, media_delete, media_reorder, media_read_target). */
export interface MediaGalleryStorePort {
  /** Lista do rascunho do hash; null = rascunho inexistente, vencido ou descartado (404 uniforme). */
  list(secretHash: string, nowMs: number): Promise<readonly GaleriaLinha[] | null>;
  /** Marca a foto do dono para remocao (soma photo_rev so em 'deleted'). */
  remove(secretHash: string, id: string, nowMs: number): Promise<MediaDeleteCode>;
  /** Compara-e-troca da ordem (CA-08). */
  reorder(secretHash: string, atual: readonly string[], nova: readonly string[], nowMs: number): Promise<MediaReorderCode>;
  /** Bytes da versao reduzida quando a foto e do dono, viva e pronta; null caso contrario. */
  readTarget(secretHash: string, id: string, nowMs: number): Promise<number | null>;
}

/** Porta estreita de leitura da versao reduzida 'p/<id>'. Nao existe leitura do original por este tipo (G-04). */
export interface ReducedPhotoReaderPort {
  readReduced(id: string): Promise<Uint8Array | null>;
}

/** Contadores de operacao com nomes fixos (98 §5): nunca identificador, cookie ou linha. */
export type GaleriaContador =
  | 'lista_ok'
  | 'imagem_ok'
  | 'imagem_404'
  | 'exclusao_ok'
  | 'exclusao_repetida'
  | 'ordem_ok'
  | 'ordem_conflito'
  | 'leitura_divergente'
  | 'remocao_fisica_falhou';
