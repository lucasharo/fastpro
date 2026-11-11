// H-019 | Adaptador da busca no banco (docs/factory/64-DESENHO-H019.md, §2, §3.3, §5.1 T-H019-05).
// Transacao curta: marca o principal como anonimo (local a transacao) e chama a funcao de busca com
// parametro ligado ($1). Qualquer excecao vira codigo fixo; a mensagem do banco nunca sai daqui.
// O cliente de banco e injetado: este modulo nao abre conexao nem le variavel de ambiente.
import { CATALOG_SEARCH_DB_TIMEOUT_MS } from '@fastpro/domain';
import type { CatalogSearchPort, CatalogSearchPortResult } from './ports.js';

export interface CatalogSqlTx {
  query(text: string, params: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface CatalogSqlRunner {
  /** Executa fn numa transacao curta, como app_api; faz commit ou rollback. */
  transaction<T>(fn: (tx: CatalogSqlTx) => Promise<T>): Promise<T>;
}

/** Principal anonimo local a transacao (mesmo GUC lido por private.* e pelo catalogo). */
export const CATALOG_PRINCIPAL_SQL =
  "select set_config('app.principal_type', 'anonymous', true)";

/** Colunas da projecao publica, na ordem de CATALOG_SEARCH_FIELDS. Nunca select *. */
export const CATALOG_SEARCH_SQL =
  'select group_id, group_name, group_position, service_id, service_name, modality, regulated ' +
  'from private.catalog_search($1)';

const TEMPO_ESGOTADO = Symbol('tempo_esgotado');

export function createCatalogSearchAdapter(
  runner: CatalogSqlRunner,
  timeoutMs: number = CATALOG_SEARCH_DB_TIMEOUT_MS,
): CatalogSearchPort {
  return {
    async search(q: string): Promise<CatalogSearchPortResult> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const prazo = new Promise<typeof TEMPO_ESGOTADO>((resolve) => {
        timer = setTimeout(() => resolve(TEMPO_ESGOTADO), timeoutMs);
      });
      // A falha e convertida em valor (sem repassar a excecao): nada de mensagem sai daqui.
      const consulta = runner
        .transaction(async (tx) => {
          await tx.query(CATALOG_PRINCIPAL_SQL, []);
          return tx.query(CATALOG_SEARCH_SQL, [q]);
        })
        .then(
          (rows): CatalogSearchPortResult => ({ ok: true, rows }),
          (): CatalogSearchPortResult => ({ ok: false, code: 'db_error' }),
        );
      try {
        const r = await Promise.race([consulta, prazo]);
        if (r === TEMPO_ESGOTADO) return { ok: false, code: 'db_timeout' };
        return r;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
