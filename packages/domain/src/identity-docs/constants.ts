// H-037 (Issue #50) | Constantes dos documentos de identidade (docs/factory/107-DESENHO-H037.md, §2, §3, §5 e §6).
// Decisoes 173, 174, 175, 188, 189 (teto em bytes, 220), 213 (bucket proprio), 225 (MiB). Documento nao e foto:
// nada daqui reaproveita constante de bucket ou de chave de foto (R6, R7).

/** Imagem de entrada: ate 5 MiB (decisao 173; unidade MiB, decisao 225). */
export const IDOC_IMAGE_MAX_BYTES = 5_242_880;
/** PDF: ate 2 MiB (decisao 174). Tambem e o limite do objeto final (CA-07). */
export const IDOC_PDF_MAX_BYTES = 2_097_152;
/** Limite do bucket final `identity-docs` (CA-07). */
export const IDOC_FINAL_MAX_BYTES = 2_097_152;
/** Corpo de POST /uploads (JSON), em bytes. */
export const IDOC_BODY_LIMIT_BYTES = 2048;

/** Tipos declarados aceitos na emissao (HEIC, HEIF, GIF e SVG sao recusados). */
export const IDOC_DECLARED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type IdentityDocDeclaredType = (typeof IDOC_DECLARED_TYPES)[number];

/** Tipos gravados no bucket final: imagens viram JPEG; PDF segue sem alteracao (CA-17). */
export const IDOC_STORED_TYPES = ['image/jpeg', 'application/pdf'] as const;
export type IdentityDocStoredType = (typeof IDOC_STORED_TYPES)[number];

/** Bucket de entrada, separado da quarentena de fotos (decisao 213, D-1). Chave `s/<uuid>`. */
export const IDOC_INCOMING_BUCKET = 'identity-incoming' as const;
/** Bucket final dos documentos (decisao 213). Chave `i/<uuid>`. Sem politica de leitura pela API. */
export const IDOC_FINAL_BUCKET = 'identity-docs' as const;

/** Vida de um envio pendente (emissao + 30 min, 107 §5). */
export const IDOC_PENDING_TTL_MINUTES = 30;
/** Validade alvo da URL de envio (15 min, 107 §5). */
export const IDOC_UPLOAD_URL_TTL_S = 900;
/** Idade minima de um objeto de entrada sem linha viva para ser considerado orfao (3 h). */
export const IDOC_ORPHAN_AGE_MS = 3 * 60 * 60 * 1000;

/** Documentos vivos por profissional (decisao 175). */
export const IDOC_MAX_VIVOS = 5;
/** Teto global em bytes (decisao 220): 250 MB, com 2 MiB reservados por envio pendente. */
export const IDOC_GLOBAL_BYTES_CAP = 250_000_000;
/** Reserva, por linha `pendente_envio`, no teto global (pior caso gravado). */
export const IDOC_RESERVA_PENDENTE_BYTES = 2_097_152;

/** Lease e tentativas da finalizacao (igual a 93 §2.2; decisoes 84 a 86). */
export const IDOC_LEASE_S = 30;
export const IDOC_MAX_ATTEMPTS = 3;

/** Caminho da API (107 §3). */
export const IDOC_PATH = '/v1/professional/documents' as const;

/** Politica de cota (mesma forma de MEDIA_RATE_*; chave do balde = SHA-256 de `idoc:<politica>:<valor>`). */
export interface IdentityDocRatePolicy {
  readonly id: string;
  readonly spanS: number;
  readonly bucketS: number;
  readonly limit: number;
}

// Cotas de emissao (decisao 188, valores de H-026).
export const IDOC_RATE_EMISSAO_PROFISSIONAL_HORA: IdentityDocRatePolicy = {
  id: 'idoc_emissao_profissional_hora',
  spanS: 3600,
  bucketS: 300,
  limit: 12,
};
export const IDOC_RATE_EMISSAO_PROFISSIONAL_DIA: IdentityDocRatePolicy = {
  id: 'idoc_emissao_profissional_dia',
  spanS: 86400,
  bucketS: 3600,
  limit: 25,
};
export const IDOC_RATE_EMISSAO_IP_HORA: IdentityDocRatePolicy = {
  id: 'idoc_emissao_ip_hora',
  spanS: 3600,
  bucketS: 300,
  limit: 40,
};
export const IDOC_RATE_EMISSAO_IP_DIA: IdentityDocRatePolicy = {
  id: 'idoc_emissao_ip_dia',
  spanS: 86400,
  bucketS: 3600,
  limit: 150,
};
/** Finalizacao por profissional: 30 por hora (107 §5). */
export const IDOC_RATE_FINALIZA_PROFISSIONAL: IdentityDocRatePolicy = {
  id: 'idoc_finaliza_profissional',
  spanS: 3600,
  bucketS: 300,
  limit: 30,
};
/** Leitura da lista por IP-HMAC: 120 por minuto (107 §5). */
export const IDOC_RATE_LEITURA_IP: IdentityDocRatePolicy = {
  id: 'idoc_leitura_ip',
  spanS: 60,
  bucketS: 10,
  limit: 120,
};

/** Limite de tamanho declarado para o tipo (CA-03). Tipo desconhecido nao tem limite (recusado antes). */
export function limiteEmissaoBytes(tipo: IdentityDocDeclaredType): number {
  return tipo === 'application/pdf' ? IDOC_PDF_MAX_BYTES : IDOC_IMAGE_MAX_BYTES;
}
