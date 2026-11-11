// CLI simples de migracoes (H-003). Uso (a partir da raiz do repositorio):
//   pnpm db:migrate -- --dry-run   valida as pendentes numa transacao e desfaz (nada fica gravado)
//   pnpm db:migrate                aplica as pendentes, na ordem, uma transacao por migracao
//   pnpm db:status                 mostra aplicadas, pendentes e problemas (somente leitura)
// A conexao vem de DATABASE_URL_MIGRATIONS (ambiente ou .env.local). Nenhum valor e impresso.
import { connect, safeError, MIGRATIONS_DIR } from './lib/env.mjs';
import { listMigrations, plan } from './lib/migrations.mjs';

const CONTROL_TABLE = 'ops.schema_migration';
const LOCK_KEY = 'fastpro_migrations';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

async function readApplied(client) {
  const reg = await client.query('select to_regclass($1) as t', [CONTROL_TABLE]);
  if (!reg.rows[0].t) return [];
  const res = await client.query(`select version, checksum from ${CONTROL_TABLE} order by version`);
  return res.rows;
}

async function lock(client) {
  const res = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [LOCK_KEY]);
  if (!res.rows[0].ok) throw new Error('outra execucao de migracao esta em andamento');
}

async function runOne(client, m) {
  await client.query(m.sql);
  await client.query(`insert into ${CONTROL_TABLE} (version, name, checksum) values ($1, $2, $3)`, [
    m.version,
    m.name,
    m.checksum,
  ]);
}

function report(files, applied, { pending, problems }) {
  const done = new Set(applied.map((a) => a.version));
  for (const f of files) out(`  ${done.has(f.version) ? '[aplicada]' : '[pendente]'} ${f.file}`);
  out(`Resumo: ${applied.length} aplicada(s), ${pending.length} pendente(s).`);
  for (const p of problems) out(`PROBLEMA: ${p}`);
}

async function status(client, files) {
  const applied = await readApplied(client);
  const result = plan(files, applied);
  report(files, applied, result);
  return result.problems.length === 0 ? 0 : 1;
}

async function migrate(client, files, dryRun) {
  await lock(client);
  const applied = await readApplied(client);
  const result = plan(files, applied);
  report(files, applied, result);
  if (result.problems.length > 0) return 1;
  if (result.pending.length === 0) {
    out('Nada a aplicar.');
    return 0;
  }
  if (dryRun) {
    // Executa todas as pendentes numa unica transacao e desfaz: valida o SQL de verdade
    // (extensoes, papeis, permissoes) sem deixar nada gravado.
    await client.query('begin');
    try {
      for (const m of result.pending) {
        await runOne(client, m);
        out(`[dry-run] ok: ${m.file}`);
      }
    } finally {
      await client.query('rollback');
    }
    out('[dry-run] tudo validado e DESFEITO (rollback). Nada foi gravado.');
    return 0;
  }
  for (const m of result.pending) {
    await client.query('begin');
    try {
      await runOne(client, m);
      await client.query('commit');
      out(`aplicada: ${m.file}`);
    } catch (err) {
      await client.query('rollback');
      out(`FALHOU (desfeita): ${m.file}`);
      throw err;
    }
  }
  out('Migracoes aplicadas com sucesso.');
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');
  if (!['migrate', 'status'].includes(command)) {
    out('Uso: db.mjs <migrate|status> [--dry-run]');
    return 2;
  }
  const files = listMigrations(MIGRATIONS_DIR);
  const client = await connect();
  try {
    return command === 'status'
      ? await status(client, files)
      : await migrate(client, files, args.includes('--dry-run'));
  } finally {
    await client.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`db: ${safeError(err)}\n`);
    process.exitCode = 1;
  },
);
