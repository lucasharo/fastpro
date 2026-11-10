// Secret scanning proprio (sem ferramenta externa), 17 §7.3; B-39, B-40, B-43; T-13.
// Uso: node scripts/check-secrets.mjs [--history]
//  - sem flag: varre arquivos versionados/nao ignorados (nunca .env.local, que e ignorado);
//  - --history: varre tambem as linhas adicionadas em todo o historico (git log -p).
// Limitacoes: regex proprio, sem entropia; cobre formatos conhecidos e atribuicoes de variaveis
// sensiveis. Nao substitui gitleaks/OSV (avaliar adicionar depois; licenca e limites
// [NAO VERIFICADO] nesta fase).
import { execFileSync } from 'node:child_process';
import { listFiles, readText, startsWithAny, report } from './lib/files.mjs';

const SELF_IGNORED = ['scripts/check-secrets.mjs', 'scripts/__tests__/', 'pnpm-lock.yaml'];
// service_role so e permitido em documentacao, scripts, SQL/config do Supabase e no .env.example.
const SERVICE_ROLE_ALLOWED = [
  'docs/',
  'scripts/',
  'supabase/',
  '.github/',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.env.example',
];

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/, 'chave privada'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'token do GitHub'],
  [/\bre_[A-Za-z0-9]{20,}\b/, 'chave Resend'],
  [/\b(?:APP_USR|TEST)-[0-9]{6,}-[0-9]{6}-[0-9a-f]{32}-[0-9]+/, 'token Mercado Pago'],
  [/\b(?:sk|pk)\.eyJ[A-Za-z0-9_-]{20,}/, 'token Mapbox'],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, 'chave secreta Supabase'],
  [
    /\bpostgres(?:ql)?:\/\/[^:\s/@]+:(?![<$%{]|\s|your|password|xxx|changeme|\*+)[^@\s]{4,}@/i,
    'URL de banco com senha',
  ],
];
// NOME_SENSIVEL=valor (arquivo .env commitado, YAML, shell). Valor placeholder e ignorado.
const ASSIGN =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|SERVICE_ROLE_KEY|PEPPER|HMAC_KEY|ENC_KEY_V\d+|_KEY))\s*[=:]\s*['"]?([^\s'"#]{8,})/;
const PLACEHOLDER =
  /^(?:<.*>|\$\{?.*|%.*|x{3,}|\*{3,}|changeme|your[-_].*|example.*|placeholder.*|dummy.*|\.{3})$/i;

function scanLine(path, line) {
  const found = [];
  for (const [re, kind] of SECRET_PATTERNS) if (re.test(line)) found.push(kind);
  const a = ASSIGN.exec(line);
  if (a && !PLACEHOLDER.test(a[2])) found.push(`valor atribuido a ${a[1]}`);
  if (/service[_-]?role/i.test(line) && !startsWithAny(path, SERVICE_ROLE_ALLOWED)) {
    found.push('referencia a service_role fora de modulo permitido');
  }
  return found;
}

const root = process.cwd();
const violations = [];
let lines = 0;

for (const file of listFiles(root)) {
  if (startsWithAny(file, SELF_IGNORED)) continue;
  const text = readText(root, file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    lines++;
    for (const kind of scanLine(file, line)) violations.push(`${file}:${i + 1} ${kind}`);
  });
}

let mode = 'arvore de trabalho';
if (process.argv.includes('--history')) {
  mode += ' + historico';
  let log;
  try {
    log = execFileSync('git', ['log', '-p', '--all', '-U0', '--no-color', '--format=commit %h'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    log = '';
  }
  let commit = '?';
  let path = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 14);
    else if (line.startsWith('+++ b/')) path = line.slice(6);
    else if (
      line.startsWith('+') &&
      !line.startsWith('+++') &&
      path &&
      !startsWithAny(path, SELF_IGNORED)
    ) {
      lines++;
      for (const kind of scanLine(path, line.slice(1))) {
        violations.push(`historico ${commit} ${path} ${kind}`);
      }
    }
  }
}
report('check-secrets', violations, `${mode}; ${lines} linhas`);
