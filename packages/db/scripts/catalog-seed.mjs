// Aplica a semente do catalogo (H-018, 53 §4.2) no banco. COMANDO EXPLICITO: nunca roda sozinho.
//   pnpm db:seed:catalog -- --dry-run   valida e aplica numa transacao que e DESFEITA (nada fica gravado)
//   pnpm db:seed:catalog                aplica numa transacao (commit). Reexecucao e no-op.
// Conexao: DATABASE_URL_MIGRATIONS (ambiente ou .env.local). Nenhum valor de conexao e impresso.
// Imprime apenas versao e contagens. A semente e PROVISORIA (sem aceite do conteudo).
import { readFileSync } from 'node:fs';
import { connect, safeError } from './lib/env.mjs';
import { validateSeed } from './lib/catalog-seed.mjs';
import { SEED_PATH } from './catalog-build-seed.mjs';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const errors = validateSeed(seed);
  if (errors.length > 0) {
    out(`Semente reprovada na validacao (${errors.length} erro(s)); nada foi aplicado.`);
    return 1;
  }
  const client = await connect();
  try {
    await client.query('begin');
    let result;
    try {
      const res = await client.query('select private.catalog_seed_apply($1::jsonb) as r', [JSON.stringify(seed)]);
      result = res.rows[0].r;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
    await client.query(dryRun ? 'rollback' : 'commit');
    out(`versao ${seed.version}: ${result.status}${dryRun ? ' (dry-run, DESFEITO)' : ''}`);
    out(
      `grupos inseridos ${result.groups_inserted} de ${result.groups_total}; ` +
        `servicos inseridos ${result.services_inserted} de ${result.services_total}; ` +
        `sinonimos inseridos ${result.synonyms_inserted}; pulados por conflito ${result.skipped_conflict}`,
    );
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`catalog-seed: ${safeError(err)}\n`);
    process.exitCode = 1;
  },
);
