// Tipos minimos do driver pg usados pela borda da API (sql-pool.ts). O store local nao traz @types/pg.
// Somente o subconjunto em uso: Pool (query, connect, end) e PoolClient (query, release). Sem efeito em tempo de execucao.
declare module 'pg' {
  export interface PoolConfig {
    connectionString?: string;
    max?: number;
    connectionTimeoutMillis?: number;
    application_name?: string;
  }

  export interface QueryResult {
    rows: Record<string, unknown>[];
  }

  export interface PoolClient {
    query(text: string, params?: unknown[]): Promise<QueryResult>;
    release(): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query(text: string, params?: unknown[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}
