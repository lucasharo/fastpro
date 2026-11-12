// H-073 (Issue 83) | Cliente SQL de runtime da funcao da API (pool Pg). Este e o unico modulo da API que importa o
// driver pg; a composicao recebe a fabrica por parametro. A string de conexao chega pelo chamador
// (DATABASE_URL_APP_SYSTEM) e nunca e registrada, nem em erro. Pool pequeno: a funcao da Vercel e curta.
import pg from 'pg';
import type { SqlClient } from '@fastpro/db';

/** Cliente do papel de quem o chamador indicar (app_system para o caso de acesso). Nao conecta ate a primeira consulta. */
export function abrirClienteSql(connectionString: string): SqlClient {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
    application_name: 'fastpro-api',
  });
  return {
    query: async (text: string, params?: unknown[]) => {
      const res = await pool.query(text, params);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}
