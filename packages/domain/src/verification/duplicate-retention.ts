// Issue 53 (H-040) | Retencao por duplicidade: visao da Verificacao sobre o original (CA-H040-16) e regra
// de aprovacao de cadastro retido (RN-H040-05, dec. 477). So logica pura. A barreira real e o banco (VRF08).

export const ORIGINAL_STATUS = ['vivo', 'recusado', 'nenhum'] as const;
export type OriginalStatus = (typeof ORIGINAL_STATUS)[number];

/** Visao da duplicidade para a Verificacao: vocabulario fixo, sem nome, e-mail, documento ou HMAC do outro perfil. */
export interface DuplicateView {
  readonly duplicada: boolean;
  /** Oito caracteres do identificador do original (dec. 529); nulo quando nao ha original. */
  readonly originalId: string | null;
  readonly originalStatus: OriginalStatus;
  readonly podeAprovar: boolean;
}

export function ehOriginalStatus(valor: string): valor is OriginalStatus {
  return (ORIGINAL_STATUS as readonly string[]).includes(valor);
}

/** Aprovar retido so quando o original nao esta vivo (dec. 477). Falha fechada se o banco disser o contrario. */
export function podeAprovarRetido(view: DuplicateView): boolean {
  return view.podeAprovar && view.originalStatus !== 'vivo';
}

/** Monta a visao a partir da linha do banco; vocabulario fora da lista falha fechado. */
export function visaoDuplicidade(linha: {
  readonly duplicada: boolean;
  readonly originalShortId: string | null;
  readonly originalStatus: string;
  readonly canApprove: boolean;
}): DuplicateView {
  if (!ehOriginalStatus(linha.originalStatus)) {
    throw new Error('vocabulario_duplicidade_invalido');
  }
  return {
    duplicada: linha.duplicada,
    originalId: linha.originalShortId,
    originalStatus: linha.originalStatus,
    podeAprovar: linha.canApprove,
  };
}
