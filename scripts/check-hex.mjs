// Varredura de cor literal fora de packages/tokens (17 §7.1; B-32, B-33).
// Falha se houver hex (#rgb..#rrggbbaa), rgb()/rgba()/hsl()/hsla()/oklch() ou valor arbitrario
// de cor em classes utilitarias. Excecao pontual na linha: comentario "check-hex:ignore".
import { listFiles, readText, hasExt, startsWithAny, report } from './lib/files.mjs';

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'svg'];
const IGNORED_PREFIXES = [
  'packages/tokens/',
  'docs/',
  'scripts/',
  'node_modules/',
  'pnpm-lock.yaml',
];
const PATTERNS = [
  [/(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/, 'hex'],
  [/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\s*\(/i, 'funcao de cor'],
  [
    /\b(?:bg|text|border|fill|stroke|ring|outline|from|to|via|shadow)-\[(?:#|rgb|hsl|oklch)/i,
    'classe com cor arbitraria',
  ],
];

const root = process.cwd();
const violations = [];
let scanned = 0;
for (const file of listFiles(root)) {
  if (!hasExt(file, EXTS) || startsWithAny(file, IGNORED_PREFIXES)) continue;
  const text = readText(root, file);
  if (text === null) continue;
  scanned++;
  text.split('\n').forEach((line, i) => {
    if (line.includes('check-hex:ignore')) return;
    for (const [re, kind] of PATTERNS) {
      if (re.test(line)) violations.push(`${file}:${i + 1} cor literal (${kind})`);
    }
  });
}
report('check-hex', violations, `${scanned} arquivos`);
