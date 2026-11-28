// Gera supabase/seed/catalog/catalog.v1.json a partir de docs/factory/06-CATALOGO-PROPOSTO.md (H-018,
// 53 §4.1). Uma vez por versao; a revisao humana e o diff do JSON. Uso (raiz do repositorio):
//   node packages/db/scripts/catalog-build-seed.mjs           grava o JSON
//   node packages/db/scripts/catalog-build-seed.mjs --check   so compara (sai com 1 se divergir)
// Sem banco e sem rede. Falha (sem gravar) se a validacao reprovar a semente.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { buildSeed, serializeSeed, validateSeed, SEED_VERSION } from './lib/catalog-seed.mjs';

export const SOURCE_PATH = join(REPO_ROOT, 'docs', 'factory', '06-CATALOGO-PROPOSTO.md');
export const SEED_PATH = join(REPO_ROOT, 'supabase', 'seed', 'catalog', 'catalog.v1.json');

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

export function generate() {
  const markdown = readFileSync(SOURCE_PATH, 'utf8');
  const { seed, stats } = buildSeed(markdown, SEED_VERSION);
  const errors = validateSeed(seed);
  return { text: serializeSeed(seed), stats, errors };
}

function main() {
  const check = process.argv.includes('--check');
  const { text, stats, errors } = generate();
  if (errors.length > 0) {
    for (const e of errors) out(`ERRO: ${e}`);
    out('Semente reprovada na validacao; nada foi gravado.');
    return 1;
  }
  out(`Medido em 06: ${JSON.stringify(stats)}`);
  if (check) {
    const current = existsSync(SEED_PATH) ? readFileSync(SEED_PATH, 'utf8') : '';
    if (current !== text) {
      out('DIVERGE: catalog.v1.json nao corresponde a regeracao do 06.');
      return 1;
    }
    out('OK: catalog.v1.json corresponde a regeracao do 06 (mesmo checksum de texto).');
    return 0;
  }
  writeFileSync(SEED_PATH, text, 'utf8');
  out(`Gravado: ${SEED_PATH}`);
  return 0;
}

if (process.argv[1]?.endsWith('catalog-build-seed.mjs')) {
  process.exitCode = main();
}
