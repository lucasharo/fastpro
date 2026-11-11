// H-092 | Ordem de prioridade do envio (docs/factory/35-DESENHO-H092.md, §7; CA-H092-20).
// auth(0) < critico(1) < digest(2) < lembrete(3); desempate por tempo de criacao (mais antigo primeiro).

import type { MailClass } from './policy.js';

export const CLASS_PRIORITY: Readonly<Record<MailClass, number>> = Object.freeze({
  auth: 0,
  critico: 1,
  digest: 2,
  lembrete: 3,
});

export interface PrioritizedMail {
  readonly mailClass: MailClass;
  /** Instante ISO 8601 de criacao da linha de envio. */
  readonly createdAt: string;
}

/** Negativo se a deve sair antes de b; positivo se depois; zero se empatam. */
export function comparePriority(a: PrioritizedMail, b: PrioritizedMail): number {
  const byClass = CLASS_PRIORITY[a.mailClass] - CLASS_PRIORITY[b.mailClass];
  if (byClass !== 0) return byClass;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}
