// .env.example somente com NOMES (19 §7; B-39, B-40).
//  - toda linha de variavel e NOME= sem valor; sem duplicados;
//  - NEXT_PUBLIC_* nao pode ter nome de segredo;
//  - .gitignore cobre .env e .env.*, com excecao de .env.example;
//  - nenhum .env* versionavel alem de .env.example;
//  - variavel lida no codigo (process.env.X) precisa existir no .env.example.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles, readText, hasExt, startsWithAny, report } from './lib/files.mjs';

const root = process.cwd();
const violations = [];
const names = new Set();

const examplePath = join(root, '.env.example');
if (!existsSync(examplePath)) {
  violations.push('.env.example nao existe');
} else {
  readFileSync(examplePath, 'utf8')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!m) return violations.push(`.env.example:${i + 1} linha invalida (use NOME=)`);
      if (m[2].trim() !== '') violations.push(`.env.example:${i + 1} ${m[1]} tem valor (so nomes)`);
      if (names.has(m[1])) violations.push(`.env.example:${i + 1} ${m[1]} duplicado`);
      names.add(m[1]);
      if (/^NEXT_PUBLIC_.*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PEPPER|JWT)/.test(m[1])) {
        violations.push(`.env.example:${i + 1} ${m[1]} publico com nome de segredo`);
      }
    });
}

const gitignore = existsSync(join(root, '.gitignore'))
  ? readFileSync(join(root, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
  : [];
for (const need of ['.env', '.env.*', '!.env.example']) {
  if (!gitignore.includes(need)) violations.push(`.gitignore sem a linha "${need}"`);
}

const files = listFiles(root);
for (const f of files) {
  const base = f.split('/').pop();
  if (/^\.env(\..*)?$/.test(base) && base !== '.env.example') {
    violations.push(`${f} nao pode ficar versionavel (somente .env.example)`);
  }
}

// Variaveis do proprio sistema operacional/runtime: nao sao configuracao do app.
const ALLOWED_RUNTIME = new Set([
  'NODE_ENV',
  'CI',
  'PORT',
  'npm_package_version',
  'PATH',
  'SystemRoot',
]);
for (const f of files) {
  if (
    !hasExt(f, ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) ||
    startsWithAny(f, ['docs/', 'scripts/'])
  ) {
    continue;
  }
  const text = readText(root, f);
  if (text === null) continue;
  for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!names.has(m[1]) && !ALLOWED_RUNTIME.has(m[1])) {
      violations.push(`${f} le ${m[1]}, ausente de .env.example`);
    }
  }
}
report('check-env-example', violations, `${names.size} nomes`);
