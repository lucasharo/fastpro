// Secret scanning proprio (sem ferramenta externa), 17 §7.3; B-39, B-40, B-43; T-13.
// Uso: node scripts/check-secrets.mjs [--history]
//  - sem flag: varre arquivos versionados/nao ignorados (nunca .env.local, que e ignorado);
//  - --history: varre tambem as linhas adicionadas em todo o historico (git log -p).
//    Falha ao ler o historico (erro do git, estouro de buffer) FAZ O SCRIPT FALHAR.
// Limitacoes: regex proprio, sem entropia; cobre formatos conhecidos e atribuicoes a nomes
// sensiveis. Nao substitui gitleaks/OSV (avaliar adicionar depois; licenca e limites
// [NAO VERIFICADO] nesta fase).
import { execFileSync } from 'node:child_process';
import { listFiles, readText, startsWithAny, report } from './lib/files.mjs';

const SELF_IGNORED = ['scripts/check-secrets.mjs', 'scripts/__tests__/', 'pnpm-lock.yaml'];
// A REFERENCIA ao nome service_role so e permitida em documentacao, scripts, SQL/config do
// Supabase, .env.example e nos locais previstos no plano (19 §1.1): modulos isolados de
// Storage/Auth admin (media, identity) e a validacao de env em packages/config.
// Valores atribuidos continuam sendo verificados em qualquer lugar.
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
  'apps/api/src/modules/media/',
  'apps/api/src/modules/identity/',
  'packages/config/',
];

// Excecao exata de um caminho: lista publica de senhas comuns, nao segredo (decisao do usuario,
// 11/11, H-016). So a verificacao de atribuicao (assignments) e dispensada para este arquivo;
// padroes de token, chave e hexadecimal continuam valendo nele. Nao usar para outros caminhos.
const PUBLIC_WORDLIST_EXEMPT = new Set(['packages/domain/src/identity/common-passwords.ts']);

const HEX_LONG = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64,}(?![0-9A-Fa-f])/;
const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/, 'chave privada'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'token do GitHub'],
  [/\bre_[A-Za-z0-9]{20,}\b/, 'chave Resend'],
  [/\b(?:APP_USR|TEST)-[0-9]{6,}-[0-9]{6}-[0-9a-f]{32}-[0-9]+/, 'token Mercado Pago'],
  [/\b(?:sk|pk)\.eyJ[A-Za-z0-9_-]{20,}/, 'token Mapbox'],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/, 'chave Supabase (sb_secret_/sb_publishable_)'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, 'chave secreta de provedor (sk_live_/sk_test_)'],
  [/\bwhsec_[A-Za-z0-9+/=_-]{16,}/, 'segredo de webhook (whsec_)'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/, 'cabecalho Bearer com token'],
  [HEX_LONG, 'valor hexadecimal longo (>= 64 digitos)'],
  [
    /\bpostgres(?:ql)?:\/\/[^:\s/@]+:(?![<$%{]|\s|your|password|xxx|changeme|\*+)[^@\s]{4,}@/i,
    'URL de banco com senha',
  ],
];

// Atribuicao NOME = valor / NOME: valor / "nome": "valor" (env, YAML, JSON, TS). O nome e
// avaliado sem diferenciar maiusculas (pepper, webhookSecret, SESSION_COOKIE_SECRET).
const PAIR = /([A-Za-z_][A-Za-z0-9_.-]*)['"]?\s*[:=]\s*(['"`]?)([^\s'"`,;#)}\]]*)/g;
const SENSITIVE_NAME =
  /secret|token|passw(?:or)?d|pepper|hmac|api[_-]?key|private[_-]?key|service[_-]?role|enc[_-]?key|signing[_-]?key/i;
const KEY_SUFFIX = /[a-z0-9]Key$|_KEY$|_key$/;
// Valores que nao sao segredo: modelos, expressoes de leitura/validacao de env e referencias.
const PLACEHOLDER =
  /^(?:<.*|\$.*|%.*|x{3,}|\*{3,}|changeme.*|your[-_].*|example.*|placeholder.*|dummy.*|\.{3}|z\..*|process\.env.*|import\.meta.*|env\..*|config\..*|secrets\..*)$/i;

function assignments(line) {
  const found = [];
  for (const m of line.matchAll(PAIR)) {
    const [, name, quote, value] = m;
    if (!(SENSITIVE_NAME.test(name) || KEY_SUFFIX.test(name))) continue;
    if (value === '' || PLACEHOLDER.test(value)) continue;
    const upper = /^[A-Z][A-Z0-9_]*$/.test(name);
    const looksSecret = quote
      ? (value.length >= 12 && /\d/.test(value)) || value.length >= 20
      : value.length >= 8 && (upper || /\d/.test(value));
    if (looksSecret) found.push(`valor atribuido a ${name}`);
  }
  return found;
}

function scanLine(path, line) {
  const found = [];
  for (const [re, kind] of SECRET_PATTERNS) {
    // Hash declarado (ex.: 'SHA256 do ZIP: ...') nao e segredo.
    if (re === HEX_LONG && /sha-?(?:256|512)\b/i.test(line)) continue;
    if (re.test(line)) found.push(kind);
  }
  if (!PUBLIC_WORDLIST_EXEMPT.has(path)) found.push(...assignments(line));
  if (
    /service[_-]?role|SUPABASE_SECRET_KEY/i.test(line) &&
    !startsWithAny(path, SERVICE_ROLE_ALLOWED)
  ) {
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
  let log = '';
  try {
    const count = Number(
      execFileSync('git', ['rev-list', '--all', '--count'], { cwd: root, encoding: 'utf8' }).trim(),
    );
    if (count > 0) {
      log = execFileSync('git', ['log', '-p', '--all', '-U0', '--no-color', '--format=commit %h'], {
        cwd: root,
        encoding: 'utf8',
        // CHECK_SECRETS_MAX_BUFFER existe so para testar a falha por estouro de buffer.
        maxBuffer: Number(process.env.CHECK_SECRETS_MAX_BUFFER) || 256 * 1024 * 1024,
      });
    }
  } catch (err) {
    // Falha ao ler o historico NAO pode virar "ok": o gate precisa falhar.
    console.error(`check-secrets: falha ao ler o historico git: ${err.code ?? err.message}`);
    process.exit(2);
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
