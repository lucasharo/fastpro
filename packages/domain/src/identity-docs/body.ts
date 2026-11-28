// H-037 (Issue #50) | Corpo de POST /v1/professional/documents/uploads (107-DESENHO-H037.md, §3; CA-03, CA-04, CA-10).
// Ordem: tamanho -> vazio -> JSON -> chaves -> tipo (415) -> id -> tamanho (422 e 413). So as tres chaves; nenhum
// nome de arquivo, caminho ou identificador de profissional. Erro sempre com codigo fixo: nada e ecoado.
import { IDOC_BODY_LIMIT_BYTES, IDOC_DECLARED_TYPES, IDOC_KINDS, limiteEmissaoBytes } from './constants.js';
import type { IdentityDocDeclaredType, IdentityDocKind } from './constants.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// H-038 (Issue 51): kind e service_id sao opcionais; kind ausente = identidade (compatibilidade com a Issue 50).
const CHAVES_CORPO: readonly string[] = ['client_upload_id', 'content_type', 'size_bytes', 'kind', 'service_id'];

export type IdentityDocBodyErrorCode =
  | 'corpo_grande'
  | 'vazio'
  | 'corpo_invalido'
  | 'campo_desconhecido'
  | 'campo_ausente'
  | 'client_upload_id_invalido'
  | 'tamanho_invalido'
  | 'tipo_nao_aceito'
  | 'arquivo_grande'
  | 'kind_invalido'
  | 'service_id_ausente'
  | 'service_id_incoerente'
  | 'service_id_invalido';

export interface IdentityDocEmissaoCorpo {
  readonly clientUploadId: string;
  readonly contentType: IdentityDocDeclaredType;
  readonly sizeBytes: number;
  readonly kind: IdentityDocKind;
  /** Servico (uuid) quando kind = certificacao; null para identidade. */
  readonly serviceId: string | null;
}

function ehKind(valor: unknown): valor is IdentityDocKind {
  return typeof valor === 'string' && (IDOC_KINDS as readonly string[]).includes(valor);
}

export type IdentityDocBodyResult =
  | { readonly ok: true; readonly corpo: IdentityDocEmissaoCorpo }
  | { readonly ok: false; readonly status: 413 | 415 | 422; readonly code: IdentityDocBodyErrorCode };

export function ehIdentityDocUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

function ehTipoDeclarado(valor: unknown): valor is IdentityDocDeclaredType {
  return typeof valor === 'string' && (IDOC_DECLARED_TYPES as readonly string[]).includes(valor);
}

/** Valida o corpo de emissao. `byteLength` e o tamanho em bytes da requisicao, medido antes de decodificar. */
export function parseIdentityDocEmissaoBody(texto: string, byteLength: number): IdentityDocBodyResult {
  if (byteLength > IDOC_BODY_LIMIT_BYTES) return { ok: false, status: 413, code: 'corpo_grande' };
  if (texto.trim() === '') return { ok: false, status: 422, code: 'vazio' };

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, status: 422, code: 'corpo_invalido' };
  }
  const obj = json as Record<string, unknown>;
  for (const chave of Object.keys(obj)) {
    if (!CHAVES_CORPO.includes(chave)) return { ok: false, status: 422, code: 'campo_desconhecido' };
  }
  const tipo = obj['content_type'];
  if (!ehTipoDeclarado(tipo)) {
    return { ok: false, status: 415, code: 'tipo_nao_aceito' };
  }
  if (!('client_upload_id' in obj) || !('size_bytes' in obj)) {
    return { ok: false, status: 422, code: 'campo_ausente' };
  }
  const cuid = obj['client_upload_id'];
  if (!ehIdentityDocUuid(cuid)) return { ok: false, status: 422, code: 'client_upload_id_invalido' };

  const bytes = obj['size_bytes'];
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1) {
    return { ok: false, status: 422, code: 'tamanho_invalido' };
  }
  if (bytes > limiteEmissaoBytes(tipo)) return { ok: false, status: 413, code: 'arquivo_grande' };

  // H-038: kind ausente = identidade; certificacao exige service_id (uuid); identidade nao aceita service_id.
  const kindBruto = 'kind' in obj ? obj['kind'] : 'identidade';
  if (!ehKind(kindBruto)) return { ok: false, status: 422, code: 'kind_invalido' };
  const temServico = 'service_id' in obj;
  if (kindBruto === 'identidade' && temServico) return { ok: false, status: 422, code: 'service_id_incoerente' };
  if (kindBruto === 'certificacao' && !temServico) return { ok: false, status: 422, code: 'service_id_ausente' };
  let servico: string | null = null;
  if (kindBruto === 'certificacao') {
    const bruto = obj['service_id'];
    if (!ehIdentityDocUuid(bruto)) return { ok: false, status: 422, code: 'service_id_invalido' };
    servico = bruto.toLowerCase();
  }

  return {
    ok: true,
    corpo: { clientUploadId: cuid.toLowerCase(), contentType: tipo, sizeBytes: bytes, kind: kindBruto, serviceId: servico },
  };
}
