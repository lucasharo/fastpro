// H-019 | Fabrica real das portas da busca sobre um pool Pg injetado (docs/factory/64-DESENHO-H019.md, §3.1,
// §3.3). Liga os adaptadores de @fastpro/db (transacao curta e limite de taxa) ao contrato de montarCatalogo.
// Este modulo nao abre conexao, nao le variavel de ambiente e nao importa o driver pg: o pool chega por
// parametro (abrirPool), decidido na borda da aplicacao. Sem pool, a rota continua 404.
import { PgCatalogRateLimit, PgCatalogSqlRunner } from '@fastpro/db';
import type { CatalogPortsFactory } from './compose.js';
import { createCatalogSearchAdapter } from './db-adapter.js';

/** Interface minima de um pool Pg usada pelos adaptadores (o pool real do driver atende a esta forma). */
export interface CatalogPoolClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface CatalogPool {
  connect(): Promise<CatalogPoolClient>;
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Cria a fabrica de portas. O pool e aberto uma vez por URL (memoizado), para cada pedido nao abrir
 * conexao nova. O relogio e injetado para o limite de taxa (padrao: Date.now).
 */
export function criarFabricaCatalogo(
  abrirPool: (databaseUrl: string) => CatalogPool,
  nowMs: () => number = Date.now,
): CatalogPortsFactory {
  const pools = new Map<string, CatalogPool>();
  return {
    criar({ databaseUrl, rateKey }) {
      let pool = pools.get(databaseUrl);
      if (pool === undefined) {
        pool = abrirPool(databaseUrl);
        pools.set(databaseUrl, pool);
      }
      const conexao = pool;
      const runner = new PgCatalogSqlRunner(() => conexao.connect());
      return {
        search: createCatalogSearchAdapter(runner),
        rate: new PgCatalogRateLimit(conexao, rateKey, nowMs),
      };
    },
  };
}
