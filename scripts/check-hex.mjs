// Varredura de cor literal fora de packages/tokens (17 §7.1; B-32, B-33).
// Falha se houver hex (#rgb..#rrggbbaa), rgb()/rgba()/hsl()/hsla()/oklch() ou valor arbitrario
// de cor em classes utilitarias. Excecao pontual na linha: comentario "check-hex:ignore".
// Referencia numerica de 3 ou 4 digitos decimais dentro de comentario (ex.: numero de Issue) nao
// e cor; hex com letra ou de 6/8 digitos continua reprovado em qualquer lugar.
// Tambem detecta NOMES de cor CSS (red, tomato, white, black, rebeccapurple...) usados em
// propriedades de cor (color, background, border*, outline, fill, stroke, *-shadow, atributos
// SVG/JSX, objetos de estilo kebab-case ou camelCase) e em utilitarios no estilo Tailwind
// (bg-red-500, text-white). "transparent" e "currentColor" sao permitidos. Limite: heuristica
// por linha; nome de cor fora de propriedade de cor (ex.: variant: 'red') nao e detectado.
import { listFiles, readText, hasExt, startsWithAny, report } from './lib/files.mjs';
import { namedColorsIn } from './lib/css-colors.mjs';

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'svg', 'html'];
const IGNORED_PREFIXES = [
  'packages/tokens/',
  'docs/',
  'scripts/',
  'node_modules/',
  'pnpm-lock.yaml',
];
const HEX_RE =
  /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const QUOTES = /['"`]/g;
const COMMENT_MARK = /\/\/|\/\*/g;
const PATTERNS = [
  [/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\s*\(/i, 'funcao de cor'],
  [
    /\b(?:bg|text|border|fill|stroke|ring|outline|from|to|via|shadow)-\[(?:#|rgb|hsl|oklch)/i,
    'classe com cor arbitraria',
  ],
];

// Posicao do match dentro de comentario: depois de // ou /* na mesma linha, com numero par de
// aspas antes do marcador (marcador dentro de string, ex.: 'https://x' + '#123', nao conta),
// ou linha de continuacao de bloco comentado (* inicial) sem aspas antes do match.
function inComment(line, index) {
  if (/^\s*\*/.test(line) && (line.slice(0, index).match(QUOTES) ?? []).length === 0) return true;
  for (const mark of line.matchAll(COMMENT_MARK)) {
    if (mark.index >= index) break;
    if ((line.slice(0, mark.index).match(QUOTES) ?? []).length % 2 === 0) return true;
  }
  return false;
}

// Hex literal que reprova. Unica excecao: referencia numerica de 3 ou 4 digitos decimais
// (ex.: Issue) dentro de comentario. Hex com letra, 6 ou 8 digitos e #ddd fora de comentario reprovam.
function hexLiteralsIn(line) {
  const found = [];
  for (const m of line.matchAll(HEX_RE)) {
    if (/^#\d{3,4}$/.test(m[0]) && inComment(line, m.index)) continue;
    found.push(m[0]);
  }
  return found;
}

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
    if (hexLiteralsIn(line).length > 0) violations.push(`${file}:${i + 1} cor literal (hex)`);
    for (const [re, kind] of PATTERNS) {
      if (re.test(line)) violations.push(`${file}:${i + 1} cor literal (${kind})`);
    }
    for (const name of new Set(namedColorsIn(line))) {
      violations.push(`${file}:${i + 1} cor literal (nome de cor CSS: ${name})`);
    }
  });
}
report('check-hex', violations, `${scanned} arquivos`);
