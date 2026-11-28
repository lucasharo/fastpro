// Issue 52 (H-039) | Tipos e constantes da fila de verificacao (docs/factory/124-DESENHO-H039.md §5.1).
// Espelham os CHECKs de app.verification_case e as listas aceitas pelas funcoes private (migracao 20261113200000).

export const ESTADOS_CASO = [
  'pendente',
  'em_revisao',
  'retida_duplicidade',
  'aprovada',
  'recusada',
  'suspensa',
] as const;
export type EstadoCaso = (typeof ESTADOS_CASO)[number];

export const DECISOES = ['aprovada', 'recusada', 'retida_duplicidade'] as const;
export type Decisao = (typeof DECISOES)[number];

export const MOTIVOS_DECISAO = [
  'aprovado',
  'documento_ilegivel',
  'documento_divergente',
  'tipo_nao_aceito',
  'duplicidade_suspeita',
  'certificacao_insuficiente',
  'outro',
] as const;
export type MotivoDecisao = (typeof MOTIVOS_DECISAO)[number];

export const MOTIVOS_LEITURA = ['analise_inicial', 'conferencia_duvida', 'reanalise_recurso'] as const;
export type MotivoLeitura = (typeof MOTIVOS_LEITURA)[number];

export const ESCOPOS_FILA = ['pendentes', 'minhas', 'recursos', 'retidas'] as const;
export type EscopoFila = (typeof ESCOPOS_FILA)[number];

export type EstadoRecurso = 'nenhum' | 'pendente' | 'decidido';

/** Limite tecnico do complemento livre da decisao (dec. 375). */
export const COMPLEMENTO_MAX = 500;
/** Tamanho maximo de pagina da fila. */
export const LIMITE_FILA_MAX = 50;

/** Linha da fila: so dados nao sensiveis (dec. 385 a 387). */
export interface LinhaFila {
  readonly id: string;
  readonly shortId: string;
  readonly status: EstadoCaso;
  readonly appealStatus: EstadoRecurso;
  readonly slaTargetAt: Date;
  readonly receivedAt: Date | null;
  readonly services: readonly string[];
  /** E-mail do profissional; so a fila traz. */
  readonly professionalEmail?: string | null;
  readonly overdue: boolean;
  readonly assignedToMe: boolean;
  readonly version: number;
}

export interface CertificacaoCaso {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly documentId: string | null;
  readonly receivedAt: Date | null;
}

/** Detalhe do caso: a linha da fila mais o resultado da decisao e o identificador opaco do documento (124 §4.6). */
export interface DetalheCaso extends LinhaFila {
  /** Um item por servico regulamentado; documentId nulo = certificacao nao enviada. */
  readonly certifications?: readonly CertificacaoCaso[];
  readonly reasonCode: MotivoDecisao | null;
  readonly explanation: string | null;
  readonly decidedAt: Date | null;
  readonly documentAvailable: boolean;
  readonly documentId: string | null;
  readonly documentReceivedAt: Date | null;
}

/** Codigos de erro do dominio. A API traduz cada um para HTTP (124 §5.3). */
export type CodigoErroVerificacao =
  | 'permissao_negada'
  | 'caso_conflito'
  | 'motivo_invalido'
  | 'explicacao_invalida'
  | 'identidade_nao_analisada'
  | 'certificacao_pendente'
  | 'perfil_suspenso'
  | 'original_vivo'
  | 'documento_indisponivel'
  | 'entrada_invalida';
