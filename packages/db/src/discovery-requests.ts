// Issue 36 (H-023) | Adaptador Pg da descoberta (docs/factory/97-DESENHO-H023.md, §4.1 e §6).
// So chama private.discover_requests, com o papel app_system. Erros do banco viram codigo fixo:
// nenhum texto do driver sai daqui (CA-11). O cursor (com distancia) e material interno: a rota da Issue 68
// transforma-o em token opaco antes de qualquer resposta.
import {
  DISCOVERY_PAGE_DEFAULT,
  isValidDiscoveryCursor,
  isValidDiscoveryLimit,
  type DiscoveryCursor,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export type DiscoveryStoreErrorCode =
  | 'discovery_parametro_invalido'
  | 'discovery_raio_invalido'
  | 'discovery_falhou';

/** Erro com texto fixo: o codigo e o unico detalhe que sai do adaptador. */
export class DiscoveryStoreError extends Error {
  readonly code: DiscoveryStoreErrorCode;

  constructor(code: DiscoveryStoreErrorCode) {
    super(code);
    this.name = 'DiscoveryStoreError';
    this.code = code;
  }
}

// Issue 55 (H-042): sexto argumento p_now, um instante por requisicao, usado pela guarda e pelo casamento.
const SQL_DISCOVER =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_requests($1::uuid, $2::integer, $3::smallint, $4::integer, $5::uuid, $6::timestamptz)';

const ERROS_BANCO = new Map<string, DiscoveryStoreErrorCode>([
  ['discover_parametro_invalido', 'discovery_parametro_invalido'],
  ['discover_raio_invalido', 'discovery_raio_invalido'],
]);

function traduzirErro(err: unknown): DiscoveryStoreErrorCode {
  const texto = err instanceof Error ? err.message : '';
  return ERROS_BANCO.get(texto) ?? 'discovery_falhou';
}

export interface DiscoveryPageInput {
  readonly professionalId: string;
  /** Instante unico da requisicao (Issue 55): a guarda e o casamento usam o mesmo valor. */
  readonly at: Date;
  readonly limit?: number;
  readonly after?: DiscoveryCursor | null;
}

export class PgDiscoveryStore {
  private readonly client: SqlClient;

  constructor(client: SqlClient) {
    this.client = client;
  }

  /** Uma pagina de pedidos visiveis ao profissional, em ordem de cursor. */
  async discover(input: DiscoveryPageInput): Promise<readonly DiscoveryCursor[]> {
    const limit = input.limit ?? DISCOVERY_PAGE_DEFAULT;
    const after = input.after ?? null;
    if (!isValidDiscoveryLimit(limit) || !isValidDiscoveryCursor(after)) {
      throw new DiscoveryStoreError('discovery_parametro_invalido');
    }
    try {
      const res = await this.client.query(SQL_DISCOVER, [
        input.professionalId,
        limit,
        after?.group ?? null,
        after?.key ?? null,
        after?.requestId ?? null,
        input.at.toISOString(),
      ]);
      return res.rows.map((r) => ({
        requestId: String(r.out_request_id),
        group: Number(r.out_cursor_group) === 1 ? 1 : 0,
        key: Number(r.out_cursor_key),
      }));
    } catch (err) {
      throw new DiscoveryStoreError(traduzirErro(err));
    }
  }
}
