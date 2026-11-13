// Issue 37 (H-024) | Adaptador Pg da cobertura booleana (docs/factory/99-DESENHO-H024.md, §2.2 e §5).
// So chama private.coverage_for_request, com o papel app_system. Erros do banco viram codigo fixo: nenhum texto
// do driver sai daqui (CA-12). O resultado e so 'com', 'sem', 'limite' ou 'indisponivel': nunca ha contagem,
// lista, identificador, distancia ou coordenada na resposta desta funcao (CA-01, CA-02).
import {
  COVERAGE_LIMIT_CUSTOMER_HOUR,
  COVERAGE_LIMIT_IP_HOUR,
  COVERAGE_LIMIT_REQUEST_HOUR,
  isCoverageResult,
  isValidCoverageIpKey,
  isValidCoverageLimit,
  type CoverageResult,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export type CoverageStoreErrorCode = 'coverage_parametro_invalido' | 'coverage_falhou';

/** Erro com texto fixo: o codigo e o unico detalhe que sai do adaptador. */
export class CoverageStoreError extends Error {
  readonly code: CoverageStoreErrorCode;

  constructor(code: CoverageStoreErrorCode) {
    super(code);
    this.name = 'CoverageStoreError';
    this.code = code;
  }
}

const SQL_COBERTURA =
  'select out_result from private.coverage_for_request($1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::integer, $6::integer, $7::integer)';

export interface CoverageInput {
  /** Pedido do cliente (identificador interno; nunca sai na resposta). */
  readonly requestId: string;
  /** Dono do pedido, vindo da sessao do cliente (nunca do corpo da requisicao). */
  readonly customerId: string;
  /** HMAC do IP em hexadecimal minusculo (64 caracteres), calculado na API (ADR-014). */
  readonly ipKey: string;
  /** Relogio injetado para teste; padrao: agora. */
  readonly now?: Date;
  readonly limitIp?: number;
  readonly limitCustomer?: number;
  readonly limitRequest?: number;
}

function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

export class PgCoverageStore {
  private readonly client: SqlClient;

  constructor(client: SqlClient) {
    this.client = client;
  }

  /** Resultado da cobertura de um pedido publicado do dono: 'com', 'sem', 'limite' ou 'indisponivel'. */
  async coverageFor(input: CoverageInput): Promise<CoverageResult> {
    const limitIp = input.limitIp ?? COVERAGE_LIMIT_IP_HOUR;
    const limitCustomer = input.limitCustomer ?? COVERAGE_LIMIT_CUSTOMER_HOUR;
    const limitRequest = input.limitRequest ?? COVERAGE_LIMIT_REQUEST_HOUR;
    if (
      !ehUuid(input.requestId) ||
      !ehUuid(input.customerId) ||
      !isValidCoverageIpKey(input.ipKey) ||
      !isValidCoverageLimit(limitIp) ||
      !isValidCoverageLimit(limitCustomer) ||
      !isValidCoverageLimit(limitRequest)
    ) {
      throw new CoverageStoreError('coverage_parametro_invalido');
    }
    const agora = (input.now ?? new Date()).toISOString();
    try {
      const res = await this.client.query(SQL_COBERTURA, [
        input.requestId,
        input.customerId,
        input.ipKey,
        agora,
        limitIp,
        limitCustomer,
        limitRequest,
      ]);
      const valor = res.rows[0]?.out_result;
      if (!isCoverageResult(valor)) {
        throw new CoverageStoreError('coverage_falhou');
      }
      return valor;
    } catch (err) {
      if (err instanceof CoverageStoreError) throw err;
      const texto = err instanceof Error ? err.message : '';
      throw new CoverageStoreError(texto === 'coverage_parametro_invalido' ? 'coverage_parametro_invalido' : 'coverage_falhou');
    }
  }
}
