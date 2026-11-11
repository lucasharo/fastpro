// H-092 | Cota de e-mail: cortes por classe e degraus de alerta (docs/factory/35-DESENHO-H092.md, §7).
// Funcao pura e deterministica. Os cortes desta constante sao a unica fonte; o SQL recebe-os por
// parametro (private.email_outbox_reservar_cota). Trocar um valor aqui nao exige migracao.

import type { MailClass } from './policy.js';

/** Limites do provedor de e-mail (S-11): 100 por dia UTC e 3.000 por mes. Fato do servico, nao ajuste. */
export const PROVIDER_LIMITS = Object.freeze({ dia: 100, mes: 3000 });

export interface QuotaCut {
  readonly dia: number;
  readonly mes: number;
}

/**
 * Corte por classe: a classe so envia enquanto o uso do dia e do mes esta abaixo do corte.
 * auth usa o teto inteiro (reserva de login e conta); critico para em 90/dia (decisao 3); digest e
 * lembrete param antes (propostas da 35 §7, ajustaveis).
 */
export const QUOTA_CUTS: Readonly<Record<MailClass, QuotaCut>> = Object.freeze({
  auth: { dia: 100, mes: 3000 },
  critico: { dia: 90, mes: 2700 },
  digest: { dia: 85, mes: 2550 },
  lembrete: { dia: 70, mes: 2100 },
});

export type QuotaBlock = 'dia' | 'mes' | null;

export interface QuotaDecision {
  readonly allow: boolean;
  /** Quando as duas barras estao cheias, vale 'mes' (dura mais e define o proximo horario). */
  readonly blockedBy: QuotaBlock;
}

export function decideQuota(
  mailClass: MailClass,
  usedDay: number,
  usedMonth: number,
  cuts: Readonly<Record<MailClass, QuotaCut>> = QUOTA_CUTS,
): QuotaDecision {
  const cut = cuts[mailClass];
  if (usedMonth >= cut.mes) return { allow: false, blockedBy: 'mes' };
  if (usedDay >= cut.dia) return { allow: false, blockedBy: 'dia' };
  return { allow: true, blockedBy: null };
}

export type AlertLevel = 0 | 1 | 2 | 3;

/**
 * Nivel de alerta de um contador: 1 ao chegar a 70%, 2 a 85%, 3 a 95% do limite, e 3 tambem ao
 * chegar ao degrau critico absoluto (90 no dia, 2.700 no mes; 35 §7).
 */
export function alertLevelFor(used: number, limit: number, criticalAt: number): AlertLevel {
  if (used >= criticalAt || used * 100 >= limit * 95) return 3;
  if (used * 100 >= limit * 85) return 2;
  if (used * 100 >= limit * 70) return 1;
  return 0;
}
