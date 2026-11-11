// Fronteiras de modulo (19 §1.1; 08 §2). Versao inicial (H-004), sem analise de AST:
//  - em apps/api/src/modules/<A>/, import de outro modulo <B> so pelo index;
//    imports relativos sao resolvidos contra o diretorio do arquivo antes de comparar o modulo
//    (import dentro do proprio modulo, ex. ../domain/entity, e livre);
//  - billing nunca importa requests, distribution, selection nem chat;
//  - packages/* nunca importam apps/*; packages/domain nao importa nada de I/O.
// Ainda nao ha modulos em apps/api; o script passa vazio e passa a valer quando existirem.
import { posix } from 'node:path';
import { listFiles, readText, hasExt, report } from './lib/files.mjs';

const root = process.cwd();
const violations = [];
const BILLING_FORBIDDEN = ['requests', 'distribution', 'selection', 'chat'];
const SRC_DIR = 'apps/api/src/';
const MODULES_DIR = 'apps/api/src/modules/';
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

// Devolve { target, rest } do modulo alvo do import, ou null se nao aponta para modules/.
// rest = caminho dentro do modulo alvo ('' para o proprio diretorio do modulo).
function moduleTarget(file, spec) {
  let path;
  if (spec.startsWith('.')) {
    path = posix.join(posix.dirname(file), spec);
    if (path.startsWith(MODULES_DIR)) {
      path = path.slice(MODULES_DIR.length);
    } else if (path.startsWith(SRC_DIR)) {
      // Sobe ate src/ fora de modules/ (ex.: ../../chat a partir de billing/a.ts): so para billing.
      const [target] = path.slice(SRC_DIR.length).split('/');
      return { target, rest: '', outside: true };
    } else {
      return null;
    }
  } else {
    const m = /(?:^|\/)modules\/(.+)$/.exec(spec);
    if (!m) return null;
    path = m[1];
  }
  const [target, ...restParts] = path.split('/');
  return { target, rest: restParts.join('/') };
}

const isIndex = (rest) => rest === '' || /^index(\.[cm]?[jt]sx?)?$/.test(rest);

for (const file of listFiles(root)) {
  if (!hasExt(file, ['ts', 'tsx', 'js', 'jsx', 'mjs'])) continue;
  const text = readText(root, file);
  if (text === null) continue;
  const specs = importsOf(text);

  const mod = file.startsWith(MODULES_DIR) ? file.slice(MODULES_DIR.length).split('/') : null;
  if (mod && mod.length > 1) {
    scanned++;
    for (const spec of specs) {
      const t = moduleTarget(file, spec);
      if (!t || t.target === mod[0]) continue;
      if (!t.outside && !isIndex(t.rest)) {
        violations.push(`${file}: import profundo no modulo "${t.target}" (use o index): ${spec}`);
      }
      if (mod[0] === 'billing' && BILLING_FORBIDDEN.includes(t.target)) {
        violations.push(`${file}: billing nao pode importar ${t.target}`);
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
