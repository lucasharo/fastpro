// Issue 52 (H-039) | Prazo-meta em dias uteis (124 §4.1; dec. 384 e 397). Espelho de
// private.verification_sla_target. Brasilia e UTC-3 sem horario de verao desde 2019; por isso o calculo
// usa deslocamento fixo, sem depender de Intl. Sabado e domingo contam como segunda 00:00 local;
// soma 2 dias uteis mantendo a hora; sem feriados.
const MS_DIA = 24 * 60 * 60 * 1000;
const DESLOCAMENTO_BRASILIA_MS = 3 * 60 * 60 * 1000;

/** Dia da semana ISO (1 segunda a 7 domingo) de um instante em horario local, como milissegundos. */
function diaIso(ms: number): number {
  return ((new Date(ms).getUTCDay() + 6) % 7) + 1;
}

export function prazoMeta(de: Date): Date {
  const local = de.getTime() - DESLOCAMENTO_BRASILIA_MS;
  const iso = diaIso(local);
  let t = local;
  if (iso >= 6) {
    const meiaNoite = Date.UTC(new Date(local).getUTCFullYear(), new Date(local).getUTCMonth(), new Date(local).getUTCDate());
    t = meiaNoite + (8 - iso) * MS_DIA;
  }
  for (let i = 0; i < 2; i += 1) {
    t += MS_DIA;
    while (diaIso(t) > 5) t += MS_DIA;
  }
  return new Date(t + DESLOCAMENTO_BRASILIA_MS);
}
