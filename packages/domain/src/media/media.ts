// H-026 (Issue #39) | Upload de fotos em quarentena: constantes, validacao do corpo e chave do objeto
// (docs/factory/88-DESENHO-H026.md, §1 a §3; CA-01 a CA-06, CA-13; D-H026-3, D-H026-4).
// Logica pura. A API nunca le os bytes do arquivo: so valida o que o navegador declara.
import type { DraftRatePolicy } from '../draft/request-draft.js';

/** Corpo do POST de emissao: JSON pequeno, sem arquivo (CA-13). */
export const MEDIA_BODY_LIMIT_BYTES = 2048;
/** Limite do arquivo: 10 MB (decisao de bucket e de banco). */
export const MEDIA_MAX_BYTES = 10_485_760;
/** Tipos aceitos nesta historia. HEIC/HEIF recusados com 415 ate H-027 ligar a conversao (D-H026-3). */
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
/** Vagas vivas por rascunho (I-29; banco e API). */
export const MEDIA_PHOTOS_PER_DRAFT = 5;
/** TTL do pendente sem confirmacao (decisao do lider: 30 min). A funcao SQL usa o mesmo valor. */
export const MEDIA_PENDING_TTL_MINUTES = 30;
/** Validade-alvo da URL de envio (88 §3). [NAO VERIFICADO] o Storage pode fixar o token em outro prazo. */
export const MEDIA_UPLOAD_URL_TTL_S = 900;
/** Varredura de orfaos: objeto sem linha com mais de 3 h. */
export const MEDIA_ORPHAN_AGE_MS = 3 * 60 * 60 * 1000;
/** Teto global de vagas vivas na quarentena (proteção do Storage gratuito ate H-027). */
export const MEDIA_GLOBAL_CAP = 150;
/** Lote por execucao do expurgo. */
export const MEDIA_SWEEP_BATCH = 200;
/** Lote de objetos listados para a varredura de orfaos. */
export const MEDIA_ORPHAN_LIST_LIMIT = 500;
/** Bucket privado de quarentena (migracao 20261112120000). */
export const MEDIA_BUCKET = 'quarantine' as const;

export const MEDIA_PATH = '/v1/media/uploads' as const;
export const MEDIA_ITEM_PREFIX = '/v1/media/' as const;

// Cotas (88 §3). Emissao por rascunho e por IP-HMAC; confirmacao por rascunho; leitura por IP-HMAC.
export const MEDIA_RATE_EMISSAO_RASCUNHO_HORA: DraftRatePolicy = {
  id: 'media_emissao_rascunho_hora',
  spanS: 3600,
  bucketS: 300,
  limit: 12,
};
export const MEDIA_RATE_EMISSAO_RASCUNHO_DIA: DraftRatePolicy = {
  id: 'media_emissao_rascunho_dia',
  spanS: 86400,
  bucketS: 3600,
  limit: 25,
};
export const MEDIA_RATE_EMISSAO_IP_HORA: DraftRatePolicy = {
  id: 'media_emissao_ip_hora',
  spanS: 3600,
  bucketS: 300,
  limit: 40,
};
export const MEDIA_RATE_EMISSAO_IP_DIA: DraftRatePolicy = {
  id: 'media_emissao_ip_dia',
  spanS: 86400,
  bucketS: 3600,
  limit: 150,
};
export const MEDIA_RATE_CONFIRMA_RASCUNHO: DraftRatePolicy = {
  id: 'media_confirma_rascunho',
  spanS: 3600,
  bucketS: 300,
  limit: 30,
};
export const MEDIA_RATE_LEITURA_IP: DraftRatePolicy = {
  id: 'media_leitura_ip',
  spanS: 60,
  bucketS: 10,
  limit: 120,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVES_CORPO = ['client_upload_id', 'content_type', 'size_bytes'] as const;

/** Forma canonica de uuid (minusculas). Qualquer outra coisa nao e id e nao toca o banco. */
export function isMediaId(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

export function isMediaType(valor: unknown): valor is MediaType {
  return typeof valor === 'string' && (MEDIA_TYPES as readonly string[]).includes(valor);
}

/**
 * Chave do objeto no bucket: so 'd/<uuid>', sem extensao, sem nome original (CA-13, T-10).
 * Recusa qualquer valor que nao seja uuid, para que nenhum caminho livre chegue ao Storage.
 */
export function mediaObjectKey(id: string): string {
  if (!isMediaId(id)) throw new Error('chave_midia_invalida');
  return `d/${id.toLowerCase()}`;
}

/** Id a partir da chave 'd/<uuid>'; null quando a chave nao tem esse formato (varredura de orfaos). */
export function mediaIdFromKey(key: string): string | null {
  const m = /^d\/([^/]+)$/.exec(key);
  return m && isMediaId(m[1]) ? m[1].toLowerCase() : null;
}

export type MediaBodyErrorCode =
  | 'corpo_grande'
  | 'vazio'
  | 'corpo_invalido'
  | 'campo_desconhecido'
  | 'campo_ausente'
  | 'client_upload_id_invalido'
  | 'tamanho_invalido'
  | 'tipo_nao_aceito'
  | 'arquivo_grande';

export interface MediaEmissaoCorpo {
  readonly clientUploadId: string;
  readonly type: MediaType;
  readonly bytes: number;
}

export type MediaBodyResult =
  | { readonly ok: true; readonly corpo: MediaEmissaoCorpo }
  | { readonly ok: false; readonly status: 413 | 415 | 422; readonly code: MediaBodyErrorCode };

/**
 * Valida o corpo de POST /v1/media/uploads. Ordem: tamanho -> vazio -> JSON -> chaves -> tipo (415) ->
 * id -> tamanho (422 e 413). So as tres chaves; nome do arquivo e qualquer outro campo sao recusados (CA-13).
 * Erro sempre com codigo fixo: nenhum eco da entrada.
 */
export function parseMediaEmissaoBody(text: string, byteLength: number): MediaBodyResult {
  if (byteLength > MEDIA_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  if (text.trim() === '') return { ok: false, status: 422, code: 'vazio' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const obj = json as Record<string, unknown>;
  for (const chave of Object.keys(obj)) {
    if (!(CHAVES_CORPO as readonly string[]).includes(chave)) {
      return { ok: false, status: 422, code: 'campo_desconhecido' };
    }
  }
  if (!('content_type' in obj)) return { ok: false, status: 415, code: 'tipo_nao_aceito' };
  if (!isMediaType(obj['content_type'])) return { ok: false, status: 415, code: 'tipo_nao_aceito' };
  if (!('client_upload_id' in obj) || !('size_bytes' in obj)) {
    return { ok: false, status: 422, code: 'campo_ausente' };
  }

  const cuid = obj['client_upload_id'];
  if (!isMediaId(cuid)) return { ok: false, status: 422, code: 'client_upload_id_invalido' };

  const bytes = obj['size_bytes'];
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1) {
    return { ok: false, status: 422, code: 'tamanho_invalido' };
  }
  if (bytes > MEDIA_MAX_BYTES) return { ok: false, status: 413, code: 'arquivo_grande' };

  return {
    ok: true,
    corpo: { clientUploadId: cuid.toLowerCase(), type: obj['content_type'] as MediaType, bytes },
  };
}
