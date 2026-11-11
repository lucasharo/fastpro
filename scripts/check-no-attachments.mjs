// Chat sem anexos (17 §2.7, §7.5; M-01, M-02): nao pode existir bucket, tabela ou rota de
// anexo de mensagem. Varre codigo, SQL e configuracao (nao docs/ nem scripts/).
import { listFiles, readText, hasExt, startsWithAny, report } from './lib/files.mjs';

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'sql', 'json', 'toml', 'yml', 'yaml', 'sh'];
const IGNORED = ['docs/', 'scripts/', 'pnpm-lock.yaml', '.github/'];
const PATTERNS = [
  /chat[-_]attachments?/i,
  /message[-_]attachments?/i,
  /message[-_]media/i,
  /attachment[-_]?(id|url|path)\b/i,
  /\/messages\/[^'"`\s]*\/(attachments?|upload|media)/i,
];
const root = process.cwd();
const violations = [];
let scanned = 0;
for (const file of listFiles(root)) {
  if (!hasExt(file, EXTS) || startsWithAny(file, IGNORED)) continue;
  const text = readText(root, file);
  if (text === null) continue;
  scanned++;
  text.split('\n').forEach((line, i) => {
    if (PATTERNS.some((re) => re.test(line))) {
      violations.push(`${file}:${i + 1} anexo de chat: ${line.trim().slice(0, 80)}`);
    }
  });
}
report('check-no-attachments', violations, `${scanned} arquivos`);
