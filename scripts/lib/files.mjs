// Utilitarios compartilhados pelos scripts de verificacao (H-004).
// Lista arquivos versionados ou nao ignorados (git ls-files -co --exclude-standard),
// portanto nunca le .env.local, node_modules, dist etc.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(root = process.cwd()) {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)));
}

export function readText(root, file) {
  const buf = readFileSync(join(root, file));
  if (buf.includes(0)) return null; // binario
  return buf.toString('utf8');
}

export function hasExt(file, exts) {
  const m = /\.([^./]+)$/.exec(file);
  return m ? exts.includes(m[1].toLowerCase()) : false;
}

export function startsWithAny(file, prefixes) {
  return prefixes.some((p) => file === p || file.startsWith(p));
}

export function report(name, violations, extra = '') {
  if (violations.length > 0) {
    console.error(`${name}: ${violations.length} violacao(oes)`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`${name} ok${extra ? ` (${extra})` : ''}`);
}
