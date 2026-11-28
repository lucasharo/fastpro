// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §4.5 e §5.2) | Transacao unica do papel app_system para a
// leitura do documento: a funcao do banco trava o caso e o documento, grava o registro e a auditoria, e so
// depois o storage entrega os bytes. Se qualquer passo falhar, a transacao inteira e desfeita (CA-H039-08).
// A string de conexao chega por parametro e nunca e registrada. Pool minimo: a funcao da Vercel e curta.
import pg from 'pg';
import type { SqlClient } from '@fastpro/db';

export interface TransacaoSql {
  executar<T>(fn: (cliente: SqlClient) => Promise<T>): Promise<T>;
}

/** Abre um pool do papel indicado. Nao conecta ate a primeira transacao. */
export function abrirTransacaoSql(connectionString: string): TransacaoSql {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
    application_name: 'fastpro-api-verificacao',
  });
  return {
    async executar<T>(fn: (cliente: SqlClient) => Promise<T>): Promise<T> {
      const conexao = await pool.connect();
      try {
        await conexao.query('begin');
        const cliente: SqlClient = {
          query: async (text: string, params?: unknown[]) => {
            const res = await conexao.query(text, params);
            return { rows: res.rows as Record<string, unknown>[] };
          },
        };
        try {
          const resultado = await fn(cliente);
          await conexao.query('commit');
          return resultado;
        } catch (err) {
          await conexao.query('rollback');
          throw err;
        }
      } finally {
        conexao.release();
      }
    },
  };
}
