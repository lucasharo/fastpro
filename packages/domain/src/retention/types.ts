// H-109 (Issue 118) | Tipos e constantes da retencao (docs/factory/82-DESENHO-H109.md §1 e §4).
// Classes RC-08, RC-09 e RC-11 ficam fora de proposito (TTL tecnico e backup, H-110 e operacao).

export const RETENTION_CLASSES = [
  'RC-01',
  'RC-02',
  'RC-03',
  'RC-04',
  'RC-05',
  'RC-06',
  'RC-07',
  'RC-10',
] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export const RETENTION_ACTIONS = ['excluir', 'anonimizar', 'reter'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

/** Buckets conhecidos do Storage (82 §4). Qualquer outro nome e recusado antes de chamar a API. */
export const RETENTION_BUCKETS = ['identity-docs', 'request-photos'] as const;
export type RetentionBucket = (typeof RETENTION_BUCKETS)[number];

/** Objeto no Storage: so o caminho, nunca conteudo ou dado pessoal. */
export interface RetentionObjectRef {
  readonly bucket: RetentionBucket;
  readonly path: string;
}

/** Tamanho do lote e teto de lotes por execucao do job (82 §2). Quantidades de processamento, nao prazos. */
export const RETENTION_BATCH_SIZE = 100;
export const RETENTION_MAX_BATCHES_PER_RUN = 50;
/** Limite de objetos removidos por lote (fase B). */
export const RETENTION_OBJECTS_PER_BATCH = 500;

export function isRetentionBucket(valor: unknown): valor is RetentionBucket {
  return typeof valor === 'string' && (RETENTION_BUCKETS as readonly string[]).includes(valor);
}

/** Caminho de objeto: relativo, sem barra inicial, sem '..' e sem caractere de controle. */
export function caminhoDeObjetoValido(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length >= 1 &&
    path.length <= 512 &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(path)
  );
}
