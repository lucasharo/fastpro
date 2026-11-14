// Issue 55 (H-042), parte A | Guarda de elegibilidade do profissional, lado do dominio (docs/factory/142-DESENHO-H042.md, D-02, D-03, D-09).
// Aqui ficam so os nomes dos modos e a porta. A regra (aprovacao, conta ativa, e-mail verificado e acesso vigente)
// mora somente no banco: nao ha lista de estados nem condicao de verificacao neste modulo.
// Fail closed: modo desconhecido, erro da porta ou erro do relogio = negado.

export const MODOS_GUARDA = ['descoberta_aceite', 'participacao'] as const;

export type ModoGuarda = (typeof MODOS_GUARDA)[number];

/** Porta: a resposta do banco e so um booleano (true apenas quando a guarda aprova). */
export interface ProfessionalAccessPort {
  allowed(professionalId: string, mode: ModoGuarda, at: Date): Promise<boolean>;
}

/** Relogio injetado: um instante por requisicao. */
export interface RelogioGuarda {
  now(): Date;
}

export function modoGuardaValido(valor: unknown): valor is ModoGuarda {
  return typeof valor === 'string' && (MODOS_GUARDA as readonly string[]).includes(valor);
}

/** Consulta a guarda com um unico instante. Qualquer rejeicao ou modo invalido vira false. */
export async function profissionalPermitido(
  porta: ProfessionalAccessPort,
  relogio: RelogioGuarda,
  professionalId: string,
  modo: ModoGuarda,
): Promise<boolean> {
  try {
    if (!modoGuardaValido(modo)) return false;
    const at = relogio.now();
    return (await porta.allowed(professionalId, modo, at)) === true;
  } catch {
    return false;
  }
}
