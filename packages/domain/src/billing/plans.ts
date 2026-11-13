// H-046 (Issue 59) | Planos e precos em centavos: tipos, porta e leitura do preco vigente (docs/factory/120-DESENHO-H046.md, §4).
// Logica pura, sem I/O. O preco vem do banco (private.plan_price_at) pela porta; o instante vem do relogio injetado
// (Clock, reaproveitado de commercial-access.ts). Erros viram codigos fixos, sem mensagem do banco.
import type { Clock } from './commercial-access.js';

/** Quatro planos fixos do MVP (decisao 343; CA-H046-01). Ordem crescente de meses. */
export const PLAN_CODES = ['mensal', 'trimestral', 'semestral', 'anual'] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

/** Moeda fixa do MVP (RN-H046-02). */
export const MOEDA_PLANOS = 'BRL' as const;

/** Preco vigente de um plano em um instante. Valor inteiro em centavos (RN-H046-01). */
export interface PlanPrice {
  readonly planCode: PlanCode;
  readonly months: number;
  /** Identificador da linha de preco; H-047 o grava no pagamento (RN-H046-06). */
  readonly planPriceId: string;
  readonly amountCents: number;
  readonly currency: typeof MOEDA_PLANOS;
}

/** Porta de leitura: a implementacao em banco fica em packages/db (createPgPlanPricing). */
export interface PlanPricingPort {
  listAt(at: Date): Promise<PlanPrice[]>;
  getAt(code: PlanCode, at: Date): Promise<PlanPrice>;
}

export type PlanPricingErrorCode = 'preco_indisponivel' | 'preco_invalido' | 'precos_indisponivel';

export class PlanPricingError extends Error {
  constructor(readonly code: PlanPricingErrorCode) {
    super(code);
    this.name = 'PlanPricingError';
  }
}

function instanteValido(valor: unknown): valor is Date {
  return valor instanceof Date && !Number.isNaN(valor.getTime());
}

/** Aceita so os quatro codigos do MVP. */
export function ehCodigoDePlano(valor: unknown): valor is PlanCode {
  return typeof valor === 'string' && (PLAN_CODES as readonly string[]).includes(valor);
}

/** Lista os precos vigentes dos quatro planos no instante do relogio injetado. */
export async function listarPrecosVigentes(port: PlanPricingPort, clock: Clock): Promise<PlanPrice[]> {
  const at = clock.now();
  if (!instanteValido(at)) {
    throw new PlanPricingError('precos_indisponivel');
  }
  return port.listAt(at);
}

/** Le o preco vigente de um plano no instante do relogio injetado. */
export async function lerPrecoVigente(port: PlanPricingPort, clock: Clock, code: PlanCode): Promise<PlanPrice> {
  if (!ehCodigoDePlano(code)) {
    throw new PlanPricingError('preco_invalido');
  }
  const at = clock.now();
  if (!instanteValido(at)) {
    throw new PlanPricingError('preco_indisponivel');
  }
  return port.getAt(code, at);
}
