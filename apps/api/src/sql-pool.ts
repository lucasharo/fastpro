// H-073 (Issue 83) | Cliente SQL de runtime da funcao da API (pool Pg). Este e o unico modulo da API que importa o
// driver pg; a composicao recebe a fabrica por parametro. A string de conexao chega pelo chamador
// (DATABASE_URL_APP_SYSTEM) e nunca e registrada, nem em erro. Pool pequeno: a funcao da Vercel e curta.
import pg, { type Pool } from 'pg';
import type { AcceptanceConnection, SqlClient } from '@fastpro/db';

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

/** Um pool por URL, reaproveitado entre chamadas da funcao (as conexoes dedicadas do aceite saem dele). */
const poolsDedicados = new Map<string, Pool>();

/**
 * Issue 71 (H-058) | Fabrica da conexao dedicada da transacao do aceite: BEGIN, travas, idempotencia, aceite e COMMIT
 * usam a mesma conexao. Cada chamada do resultado pega uma conexao do pool e a libera ao final (release).
 * A string de conexao chega por parametro e nunca e registrada, nem em erro.
 */
export function abrirConexaoDedicadaSql(connectionString: string): () => Promise<AcceptanceConnection> {
  let pool = poolsDedicados.get(connectionString);
  if (pool === undefined) {
    pool = new pg.Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 15000,
      application_name: 'fastpro-api-aceite',
    });
    poolsDedicados.set(connectionString, pool);
  }
  const reservatorio = pool;
  return async (): Promise<AcceptanceConnection> => {
    const conexao = await reservatorio.connect();
    return {
      query: async (text: string, params?: unknown[]) => {
        const res = await conexao.query(text, params);
        return { rows: res.rows as Record<string, unknown>[] };
      },
      release: () => conexao.release(),
    };
  };
}
