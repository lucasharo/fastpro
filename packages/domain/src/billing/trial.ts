// Issue 57 (H-044) | Ativacao do trial de 14 dias: porta, erro e servico de dominio, sem I/O (docs/factory/135-DESENHO-H044.md, §5.2).
// A decisao (aprovacao, unicidade por identidade, acesso pago vigente) fica no banco (private.trial_activate).
// Aqui so valida a entrada, obtem o instante do relogio injetado e confere o formato do resultado.
// Negacoes de negocio sao resultados (codigos), nao excecoes. Falha tecnica vira trial_indisponivel.
import { TRIAL_DIAS } from './types.js';
import type { Clock } from './commercial-access.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DURACAO_MS = TRIAL_DIAS * 24 * 60 * 60 * 1000;

/** Resultado da ativacao. Os quatro codigos sao os da funcao de banco; nenhum traz identidade ou documento. */
export type TrialActivationOutcome =
  | { readonly code: 'ok'; readonly startsAt: Date; readonly endsAt: Date }
  | { readonly code: 'not_verified' }
  | { readonly code: 'trial_used' }
  | { readonly code: 'paid_access_active' };

export const CODIGOS_ATIVACAO_TRIAL = ['ok', 'not_verified', 'trial_used', 'paid_access_active'] as const;

/** Porta de ativacao: a implementacao em banco fica em packages/db (createPgTrialActivation). */
export interface TrialActivationPort {
  activate(professionalId: string, at: Date): Promise<TrialActivationOutcome>;
}

export type TrialActivationErrorCode =
  | 'trial_profissional_invalido'
  | 'trial_relogio_invalido'
  | 'trial_indisponivel';

export class TrialActivationError extends Error {
  constructor(readonly code: TrialActivationErrorCode) {
    super(code);
    this.name = 'TrialActivationError';
  }
}

/** Texto da tela e da resposta (CA-H044-18). Sem termos de cobranca futura nem de pedidos. Revisao do lider pendente. */
export const TEXTO_ATIVACAO_TRIAL =
  `Sem cartão. Ao fim de ${TRIAL_DIAS} dias o acesso termina e não vira assinatura sozinho.`;

/**
 * Ativa o trial do profissional. O instante vem do relogio injetado (nunca do cliente). O resultado e
 * conferido: codigo fora dos quatro valores, ou trial com duracao diferente de TRIAL_DIAS, e contrato quebrado.
 */
export async function ativarTrial(
  port: TrialActivationPort,
  clock: Clock,
  professionalId: string,
): Promise<TrialActivationOutcome> {
  if (typeof professionalId !== 'string' || !UUID.test(professionalId)) {
    throw new TrialActivationError('trial_profissional_invalido');
  }
  const at = clock.now();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new TrialActivationError('trial_relogio_invalido');
  }
  const resultado = await port.activate(professionalId, at);
  if (!resultado || !(CODIGOS_ATIVACAO_TRIAL as readonly string[]).includes(resultado.code)) {
    throw new TrialActivationError('trial_indisponivel');
  }
  if (resultado.code === 'ok') {
    const { startsAt, endsAt } = resultado;
    if (
      !(startsAt instanceof Date) ||
      !(endsAt instanceof Date) ||
      endsAt.getTime() - startsAt.getTime() !== DURACAO_MS
    ) {
      throw new TrialActivationError('trial_indisponivel');
    }
  }
  return resultado;
}
