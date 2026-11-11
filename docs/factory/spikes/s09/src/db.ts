import { Pool } from 'pg';

// Cliente unico por instancia; consultas simples (sem prepared statements), para modo transacao do pooler.
let pool: Pool | undefined;

export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL_APP_API;
  if (!url) return null;
  pool ??= new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 2000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: true },
  });
  return pool;
}
