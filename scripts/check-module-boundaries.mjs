// Fronteiras de modulo (19 §1.1; 08 §2). Versao inicial (H-004), sem analise de AST:
//  - em apps/api/src/modules/<A>/, import de outro modulo <B> so pelo index;
//  - billing nunca importa requests, distribution, selection nem chat;
//  - packages/* nunca importam apps/*; packages/domain nao importa nada de I/O.
// Ainda nao ha modulos em apps/api; o script passa vazio e passa a valer quando existirem.
import { listFiles, readText, hasExt, report } from './lib/files.mjs';

const root = process.cwd();
const violations = [];
const BILLING_FORBIDDEN = ['requests', 'distribution', 'selection', 'chat'];
const IO_MODULES =
  /^(node:)?(fs|net|http|https|child_process|dns|tls|dgram)(\/.*)?$|^(pg|kysely|@supabase\/.*|axios|undici)$/;
let scanned = 0;

function importsOf(text) {
  const specs = [];
  for (const m of text.matchAll(
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g,
  )) {
    specs.push(m[1]);
  }
  return specs;
}

for (const file of listFiles(root)) {
  if (!hasExt(file, ['ts', 'tsx', 'js', 'jsx', 'mjs'])) continue;
  const text = readText(root, file);
  if (text === null) continue;
  const specs = importsOf(text);

  const mod = /^apps\/api\/src\/modules\/([^/]+)\//.exec(file);
  if (mod) {
    scanned++;
    for (const spec of specs) {
      const deep =
        /(?:^|\/)modules\/([^/]+)\/(.+)$/.exec(spec) ??
        /^(?:\.\.\/)+([^./][^/]*)\/(.+)$/.exec(spec);
      if (deep && deep[1] !== mod[1] && deep[2] !== 'index' && deep[2] !== 'index.js') {
        violations.push(`${file}: import profundo no modulo "${deep[1]}" (use o index): ${spec}`);
      }
      const target = /(?:modules\/|^(?:\.\.\/)+)([^/]+)/.exec(spec)?.[1];
      if (mod[1] === 'billing' && target && BILLING_FORBIDDEN.includes(target)) {
        violations.push(`${file}: billing nao pode importar ${target}`);
      }
    }
  }

  const pkg = /^packages\/([^/]+)\//.exec(file);
  if (pkg) {
    scanned++;
    for (const spec of specs) {
      if (/^@fastpro\/(web|admin|api)(\/|$)/.test(spec) || /(?:^|\/)apps\//.test(spec)) {
        violations.push(`${file}: package nao pode importar apps (${spec})`);
      }
      if (pkg[1] === 'domain' && IO_MODULES.test(spec)) {
        violations.push(`${file}: packages/domain nao pode importar I/O (${spec})`);
      }
    }
  }
}
report('check-module-boundaries', violations, `${scanned} arquivos de modulo/pacote`);
