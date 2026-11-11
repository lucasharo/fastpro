// Tipografia (17 §7.2; B-34): somente Roboto e pesos 400, 500 e 700 fora de packages/tokens.
import { listFiles, readText, hasExt, startsWithAny, report } from './lib/files.mjs';

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'css', 'scss'];
const IGNORED_PREFIXES = ['packages/tokens/', 'docs/', 'scripts/'];
const root = process.cwd();
const violations = [];
let scanned = 0;

for (const file of listFiles(root)) {
  if (!hasExt(file, EXTS) || startsWithAny(file, IGNORED_PREFIXES)) continue;
  const text = readText(root, file);
  if (text === null) continue;
  scanned++;
  text.split('\n').forEach((line, i) => {
    const fam = /font-?family\s*[:=]\s*['"]?([^;'",}]+)/i.exec(line);
    if (fam && !/roboto|inherit|var\(|\$\{/i.test(fam[1])) {
      violations.push(`${file}:${i + 1} font-family fora de Roboto: ${fam[1].trim()}`);
    }
    const w = /font-?weight\s*[:=]\s*['"]?(\w+)/i.exec(line);
    if (w && !['400', '500', '700', 'inherit', 'var'].includes(w[1])) {
      violations.push(`${file}:${i + 1} font-weight fora de 400/500/700: ${w[1]}`);
    }
  });
}
report('check-typography', violations, `${scanned} arquivos`);
