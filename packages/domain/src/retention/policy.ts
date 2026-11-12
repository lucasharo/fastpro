// H-109 (Issue 118) | Politica de retencao por classe (docs/factory/82-DESENHO-H109.md §1, §3, §5; 79-REFINO-H109).
// Logica pura. Nenhum prazo, base legal ou acao por classe entra no codigo: o periodo vem de
// app.retention_policy (dado, cadastrado por papel proprio com aprovacao dupla). O desenho proibe
// numero de dias, meses ou anos para RC-xx em fonte. Este modulo so decide o que a forma permite.
import type { RetentionAction, RetentionClass } from './types.js';

export { RETENTION_ACTIONS, RETENTION_CLASSES } from './types.js';
export type { RetentionAction, RetentionClass } from './types.js';

/**
 * Acoes aceitas por classe (82 §1 e §3). RC-06 e RC-07 so aceitam reter (RC-07: auditoria e logs de
 * acesso, sempre retidos; a guarda dura tambem existe como CHECK em app.retention_policy).
 * RC-02 nao aceita excluir: a conta e preservada por FK e so o e-mail e descaracterizado.
 */
export const ACOES_POR_CLASSE: Readonly<Record<RetentionClass, readonly RetentionAction[]>> = {
  'RC-01': ['excluir', 'anonimizar', 'reter'],
  'RC-02': ['anonimizar', 'reter'],
  'RC-03': ['excluir', 'anonimizar', 'reter'],
  'RC-04': ['excluir', 'anonimizar', 'reter'],
  'RC-05': ['anonimizar', 'reter'],
  'RC-06': ['reter'],
  'RC-07': ['reter'],
  'RC-10': ['excluir', 'reter'],
};

/** Referencia ao parecer (82 §5): codigo curto, nunca texto livre. */
const BASE_LEGAL_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Proposta de mudanca de politica (campos ja validados em forma pelo chamador). */
export interface PropostaPolitica {
  readonly dataClass: string;
  /** Periodo em segundos inteiros positivos, ou nulo (= politica nao definida, job desligado). */
  readonly periodSeconds: number | null;
  readonly action: string | null;
  readonly legalBasisRef: string | null;
  readonly effectiveFrom: string | null;
  readonly enabled: boolean;
  readonly dryRun: boolean;
  /** Ja existe uma simulacao registrada para a politica (app.retention_policy.last_dry_run_at). */
  readonly simulacaoRegistrada: boolean;
}

export type MotivoPolitica =
  | 'classe_invalida'
  | 'acao_nao_permitida'
  | 'periodo_invalido'
  | 'habilitacao_incompleta'
  | 'simulacao_pendente';

export type DecisaoPolitica = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoPolitica };

export function isRetentionClass(valor: unknown): valor is RetentionClass {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(ACOES_POR_CLASSE, valor);
}

export function acaoPermitida(classe: RetentionClass, acao: string): acao is RetentionAction {
  return (ACOES_POR_CLASSE[classe] as readonly string[]).includes(acao);
}

/** Periodo: inteiro seguro e positivo, em segundos. Nao contem prazo: so valida a forma. */
export function periodoValido(segundos: unknown): segundos is number {
  return typeof segundos === 'number' && Number.isSafeInteger(segundos) && segundos > 0;
}

/** Vigencia: instante ISO 8601 valido. */
export function vigenciaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length <= 40 && !Number.isNaN(Date.parse(valor));
}

/**
 * Decide uma proposta (CA-H109-02 e 11). Ordem: classe, acao da classe, periodo, habilitacao completa,
 * simulacao antes de executar. Habilitar sem periodo, acao, base legal ou vigencia e recusado.
 */
export function decidirPolitica(p: PropostaPolitica): DecisaoPolitica {
  if (!isRetentionClass(p.dataClass)) return { ok: false, motivo: 'classe_invalida' };
  if (p.action !== null && !acaoPermitida(p.dataClass, p.action)) {
    return { ok: false, motivo: 'acao_nao_permitida' };
  }
  if (p.periodSeconds !== null && !periodoValido(p.periodSeconds)) {
    return { ok: false, motivo: 'periodo_invalido' };
  }
  if (p.enabled) {
    const completa =
      p.periodSeconds !== null &&
      p.action !== null &&
      p.action !== 'reter' &&
      p.legalBasisRef !== null &&
      BASE_LEGAL_RE.test(p.legalBasisRef) &&
      p.effectiveFrom !== null &&
      vigenciaValida(p.effectiveFrom);
    if (!completa) return { ok: false, motivo: 'habilitacao_incompleta' };
  }
  if (!p.dryRun && !p.simulacaoRegistrada) return { ok: false, motivo: 'simulacao_pendente' };
  return { ok: true };
}

/** Mensagem fixa por motivo: a API nunca ecoa valor de entrada. */
export const MENSAGEM_POLITICA: Readonly<Record<MotivoPolitica, string>> = {
  classe_invalida: 'Classe de dado invalida.',
  acao_nao_permitida: 'Acao nao permitida para esta classe.',
  periodo_invalido: 'Periodo invalido.',
  habilitacao_incompleta: 'Habilitar exige periodo, acao, base legal e vigencia.',
  simulacao_pendente: 'Execute uma simulacao antes de desligar a simulacao.',
};
