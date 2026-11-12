// H-019 | Pool Pg real da busca de servico (desenho 64, §3.1, §3.3). So a borda de runtime abre o pool; a
// string de conexao chega por parametro (DATABASE_URL_APP_API, papel app_api) e nunca e registrada.
// Pool pequeno: a funcao da Vercel e curta. A transacao curta usa connect() para um cliente dedicado.
import pg from 'pg';
import type { CatalogPool, CatalogPoolClient } from './fabrica-pg.js';

export function abrirPoolCatalogo(connectionString: string): CatalogPool {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
    application_name: 'fastpro-api',
  });
  return {
    connect: async (): Promise<CatalogPoolClient> => {
      const cliente = await pool.connect();
      return {
        query: async (text: string, params?: unknown[]) => {
          const res = await cliente.query(text, params);
          return { rows: res.rows as Record<string, unknown>[] };
        },
        release: () => cliente.release(),
      };
    },
    query: async (text: string, params?: unknown[]) => {
      const res = await pool.query(text, params);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}
