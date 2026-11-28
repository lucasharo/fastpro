// H-046 (Issue 59) | Adaptador Pg de planos e precos (docs/factory/120-DESENHO-H046.md, §4 e §6).
// So chama private.plan_price_at (papeis app_api e app_system, migracao 20261113190000). Parametros posicionais:
// o SQL nao e montado com dado de entrada. O instante vem do chamador (relogio injetado).
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao nem le variavel de ambiente.
//   - Erro do banco nunca e repassado: vira o codigo fixo precos_indisponivel.
//   - Linha fora do contrato (codigo, meses, valor, moeda) vira preco_invalido (contrato quebrado, nao dado de usuario).
//   - Instante invalido (Date nao valida) vira preco_invalido antes de ir ao banco.
import {
  MOEDA_PLANOS,
  PlanPricingError,
  ehCodigoDePlano,
  type PlanPrice,
  type PlanPricingPort,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_PLAN_PRICE_AT =
  'select plan_code, months, plan_price_id, amount_cents, currency from private.plan_price_at($1::timestamptz, $2::text)';

function instanteValido(valor: unknown): valor is Date {
  return valor instanceof Date && !Number.isNaN(valor.getTime());
}

function comoPreco(linha: Record<string, unknown>): PlanPrice {
  const planCode = linha.plan_code;
  const months = Number(linha.months);
  const amountCents = Number(linha.amount_cents);
  const planPriceId = linha.plan_price_id;
  if (
    !ehCodigoDePlano(planCode) ||
    !Number.isSafeInteger(months) ||
    months <= 0 ||
    typeof planPriceId !== 'string' ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    linha.currency !== MOEDA_PLANOS
  ) {
    throw new PlanPricingError('preco_invalido');
  }
  return { planCode, months, planPriceId, amountCents, currency: MOEDA_PLANOS };
}

async function consultar(
  client: SqlClient,
  code: string | null,
  at: Date,
): Promise<Record<string, unknown>[]> {
  try {
    const res = await client.query(SQL_PLAN_PRICE_AT, [at.toISOString(), code]);
    return res.rows;
  } catch {
    throw new PlanPricingError('precos_indisponivel');
  }
}

export function createPgPlanPricing(client: SqlClient): PlanPricingPort {
  return {
    async listAt(at: Date): Promise<PlanPrice[]> {
      if (!instanteValido(at)) {
        throw new PlanPricingError('preco_invalido');
      }
      const linhas = await consultar(client, null, at);
      return linhas.map((linha) => comoPreco(linha));
    },
    async getAt(code, at: Date): Promise<PlanPrice> {
      if (!ehCodigoDePlano(code) || !instanteValido(at)) {
        throw new PlanPricingError('preco_invalido');
      }
      const linhas = await consultar(client, code, at);
      const linha = linhas[0];
      if (!linha) {
        throw new PlanPricingError('preco_indisponivel');
      }
      return comoPreco(linha);
    },
  };
}
