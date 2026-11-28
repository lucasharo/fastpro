// H-045 (Issue 58) | Tipos do acesso comercial derivado (docs/factory/114-DESENHO-H045.md, §4 e §6).
// Sete estados da 08 §6. Sem regra de negacao aqui: quem consome (H-042, H-055, H-074) decide o que cada estado permite
// (RN-H045-06). Sem I/O.

export const ESTADOS_ACESSO_COMERCIAL = [
  'ativa',
  'cancelada_com_acesso_ate_fim_do_periodo',
  'em_carencia',
  'expirada',
  'trial_ativo',
  'trial_expirado',
  'sem_acesso',
] as const;

export type EstadoAcessoComercial = (typeof ESTADOS_ACESSO_COMERCIAL)[number];

/** Resultado da leitura: estado e ate quando o acesso vale (nulo quando nao ha mais acesso a datar, decisao 283). */
export interface AcessoComercial {
  readonly estado: EstadoAcessoComercial;
  readonly accessUntil: Date | null;
}

/** Carencia de 72 h a partir do fim do periodo pago, sem cancelamento (RF-059, 08 §8.5). */
export const CARENCIA_HORAS = 72;

/** Duracao do trial em dias corridos (decisao 268, 08 §8.2). */
export const TRIAL_DIAS = 14;
