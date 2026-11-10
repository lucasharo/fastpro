// Leitura de .env.local por codigo e conexao ao banco. Nunca imprime valores: erros de conexao
// sao reduzidos a um codigo, porque mensagens do driver podem conter host ou endereco.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

/** Interpreta linhas NOME=valor (aspas opcionais; comentarios com #). Retorna um objeto simples. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value) && value.length >= 2) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

export function loadConnectionString(root = REPO_ROOT, env = process.env) {
  if (env.DATABASE_URL_MIGRATIONS) return env.DATABASE_URL_MIGRATIONS;
  const file = join(root, '.env.local');
  if (existsSync(file)) {
    const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL_MIGRATIONS;
    if (value) return value;
  }
  throw new Error('DATABASE_URL_MIGRATIONS nao definida (ambiente ou .env.local)');
}

/**
 * Descricao segura de um erro: so codigo SQLSTATE/rede e, para erros do servidor, a mensagem.
 * Erros de autenticacao (SQLSTATE classe 28) mostram apenas o codigo: a mensagem original pode
 * conter o usuario do projeto.
 */
export function safeError(err) {
  if (err && typeof err === 'object' && 'severity' in err) {
    if (/^28/.test(String(err.code ?? ''))) return `${err.code}: falha de autenticacao`;
    return `${err.code ?? 'erro'}: ${String(err.message)}`;
  }
  if (err && typeof err === 'object' && 'code' in err && err.code) {
    return `falha de conexao (${String(err.code)})`;
  }
  return err instanceof Error && !/postgres/i.test(err.message) ? err.message : 'erro inesperado';
}

export async function connect() {
  const client = new pg.Client({
    connectionString: loadConnectionString(),
    connectionTimeoutMillis: 15000,
    application_name: 'fastpro-db-tools',
  });
  await client.connect();
  return client;
}
