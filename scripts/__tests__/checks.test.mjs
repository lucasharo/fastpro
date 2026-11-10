// Testes negativos e positivos dos scripts de verificacao (H-004).
// Cada caso cria um repositorio git temporario, escreve arquivos sinteticos e roda o script.
// Valores "secretos" sao montados em tempo de execucao com dados sinteticos obviamente falsos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE = '.env\n.env.*\n!.env.example\n';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fastpro-chk-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, content] of Object.entries({ '.gitignore': GITIGNORE, ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function run(script, dir, args = [], env = {}) {
  const r = spawnSync(process.execPath, [join(scriptsDir, script), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function check(script, files, expectFail, match) {
  const dir = fixture(files);
  try {
    const r = run(script, dir);
    assert.equal(r.code !== 0, expectFail, r.out);
    if (match) assert.match(r.out, match);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENV_OK = 'APP_ENV=\nSUPABASE_URL=\n';

test('check-hex: reprova hex, rgb e classe arbitraria fora de tokens', () => {
  const hex = '#' + 'ff00aa';
  check('check-hex.mjs', { 'apps/web/src/a.css': `a { color: ${hex}; }\n` }, true, /a\.css:1/);
  check(
    'check-hex.mjs',
    { 'apps/web/src/a.ts': 'const c = "rgb(1, 2, 3)";\n' },
    true,
    /funcao de cor/,
  );
  check('check-hex.mjs', { 'apps/web/src/a.tsx': 'const c = "bg-[#123456]";\n' }, true);
});

test('check-hex: aceita packages/tokens e codigo sem cor literal', () => {
  const hex = '#' + 'ff00aa';
  check('check-hex.mjs', { 'packages/tokens/src/c.ts': `export const c = "${hex}";\n` }, false);
  check('check-hex.mjs', { 'apps/web/src/a.ts': 'const href = "/x#section";\n' }, false);
});

test('check-hex: reprova NOMES de cor CSS em estilos e componentes', () => {
  const bad = {
    'apps/web/src/a.css': ['a { color: red; }\n', /nome de cor CSS: red/],
    'apps/web/src/b.css': ['a { background-color: Tomato; }\n', /tomato/],
    'apps/web/src/c.css': ['a { border: 1px solid white; }\n', /white/],
    'apps/web/src/d.css': ['a { box-shadow: 0 0 4px 1px black, 0 0 1px blue; }\n', /black/],
    'apps/web/src/e.tsx': ["const s = { color: 'rebeccapurple' };\n", /rebeccapurple/],
    'apps/web/src/f.tsx': ["const s = { backgroundColor: 'white', padding: 4 };\n", /white/],
    'apps/web/src/g.tsx': ['const x = <svg><path fill="red" /></svg>;\n', /red/],
    'apps/web/src/h.tsx': ['const x = <Icon color="black" />;\n', /black/],
    'apps/web/src/i.tsx': ['const c = "bg-red-500 text-white p-4";\n', /red|white/],
    'apps/web/src/j.scss': ['.a { border-top-color: navy; }\n', /navy/],
  };
  for (const [path, [content, match]] of Object.entries(bad)) {
    check('check-hex.mjs', { [path]: content }, true, match);
  }
});

test('check-hex: aceita variaveis, transparent/currentColor e palavras que nao sao cor', () => {
  const ok = {
    'apps/web/src/a.css': 'a { color: var(--color-text-primary); background: transparent; }\n',
    'apps/web/src/b.css': 'a { border: 1px solid currentColor; fill: none; outline: none; }\n',
    'apps/web/src/c.tsx': "const s = { color: tokens.textPrimary, name: 'tan', variant: 'red' };\n",
    'apps/web/src/d.css': 'a { background: url(red.png) no-repeat; text-decoration: underline; }\n',
    'apps/web/src/e.tsx': 'const a = "text-center bg-surface border-border";\n',
    'apps/web/src/f.css': '.red { --color-x: var(--color-primary); }\n',
    // Nomes de cor so podem existir dentro de packages/tokens.
    'packages/tokens/src/c.css': 'a { color: red; }\n',
  };
  for (const [path, content] of Object.entries(ok))
    check('check-hex.mjs', { [path]: content }, false);
});

test('check-logs: reprova console.*, campos fora da allowlist e interpolacao sensivel', () => {
  const bad = [
    ["console.log('x');\n", /console/],
    ["console.error('x', err);\n", /console/],
    ["logger.info('x', { email: user.email });\n", /fora da allowlist: "email"/],
    ["logger.info('x', { phone });\n", /fora da allowlist: "phone"/],
    ["this.logger.warn('x', { cpf: '1' });\n", /"cpf"/],
    ["const l = log.child({ name: 'x' });\n", /"name"/],
    ['logger.info(`cliente ${user.email} criado`);\n', /interpolacao sensivel/],
    ["logger.info('cliente ' + customerPhone);\n", /interpolacao sensivel/],
    ["logger.info('x', { status: req.body.x });\n", /expressao sensivel/],
    ["logger.info('x', { route: request.headers.host });\n", /expressao sensivel/],
    ["logger.info('x', { ...req.body });\n", /spread/],
    ["logger.info('x', payload);\n", /objeto literal/],
    ["logger.info('x', { module: { a: 1 } });\n", /valor objeto/],
    ["logger.error('x', { status: 500 }, JSON.stringify(err.message));\n", /JSON\.stringify/],
    ["logger.info(\n  'x',\n  {\n    status: 200,\n    token: t,\n  },\n);\n", /"token"/],
  ];
  for (const [i, [content, match]] of bad.entries()) {
    check('check-logs.mjs', { [`apps/api/src/m${i}.ts`]: content }, true, match);
  }
});

test('check-logs: stdout/stderr, console por alias/colchetes, receptores e metodos extras', () => {
  const bad = [
    ["process.stdout.write('x');\n", /stdout\/stderr/, 'apps/api/src/s1.ts'],
    ['process.stderr.write(msg);\n', /stdout\/stderr/, 'packages/domain/src/s2.ts'],
    ["process['stdout'].write('x');\n", /stdout\/stderr/, 'apps/api/src/s3.ts'],
    ["console['log']('x');\n", /console/, 'apps/api/src/c1.ts'],
    ["const c = console;\nc.log('x');\n", /console/, 'apps/api/src/c2.ts'],
    ['const { log } = console;\n', /console/, 'apps/api/src/c3.ts'],
    ["globalThis.console.info('x');\n", /console/, 'apps/api/src/c4.ts'],
    ["req.log.info('x', { email });\n", /"email"/, 'apps/api/src/r1.ts'],
    ["app.log.info('x', { phone });\n", /"phone"/, 'apps/api/src/r2.ts'],
    ["logger?.info('x', { cpf });\n", /"cpf"/, 'apps/api/src/r3.ts'],
    ["logger['info']('x', { cpf });\n", /"cpf"/, 'apps/api/src/r4.ts'],
    ["logger.log('x');\n", /metodo ".log"/, 'apps/api/src/m1.ts'],
    ["logger.trace('x');\n", /metodo ".trace"/, 'apps/api/src/m2.ts'],
    ["logger.verbose('x');\n", /metodo ".verbose"/, 'apps/api/src/m3.ts'],
    [
      "const l = logger.child({ module: 'a' });\nl.info('x', { email });\n",
      /"email"/,
      'apps/api/src/a1.ts',
    ],
    ["console.log('x');\n", /console/, 'apps/api/api/index.ts'],
    ["console.log('x');\n", /console/, 'apps/api/src/e1.mjs'],
    ["console.log('x');\n", /console/, 'apps/api/src/e2.cts'],
    ["console.log('x');\n", /console/, 'apps/api/src/e3.mts'],
    ["console.log('x'); // check-logs:ignore\n", /sem motivo/, 'apps/api/src/i1.ts'],
    ["console.log('x'); // check-logs:ignore -\n", /sem motivo/, 'apps/api/src/i2.ts'],
  ];
  for (const [content, match, path] of bad) {
    check('check-logs.mjs', { [path]: content }, true, match);
  }
});

test('check-logs: aceita logger com allowlist, ids e testes', () => {
  const ok = {
    'apps/api/src/a.ts':
      "logger.info('aceite registrado', { module: 'requests', status: 200, duration_ms: ms, request_id: requestId });\n",
    'apps/api/src/b.ts':
      "const l = logger.child({ module: 'billing' });\nl.error('falha', { error_code: code }, err);\n",
    'apps/api/src/c.ts': 'logger.warn(`tentativa ${attempt} de ${max}`, { attempt, queue });\n',
    'apps/api/src/d.ts':
      "const x = Math.log(2); // Math.log nao e logger\nconsole.log('ok'); // check-logs:ignore - saida de diagnostico do bootstrap\n",
    'apps/api/src/d2.ts':
      "// check-logs:ignore - CLI de manutencao, nao e codigo de servidor\nconsole.warn('uso: x');\n",
    'packages/observability/src/sink.ts': "process.stdout.write('linha\\n');\n",
    'apps/api/api/index.ts': "logger.info('ok', { status: 200 });\n",
    'apps/api/src/i.cts': "logger.info('ok', { request_id: requestId, status: 200 });\n",
    'apps/api/src/e.test.ts': "console.log('teste'); logger.info('x', { email });\n",
    'apps/web/tests/f.ts': "console.log('fora de src');\n",
    'scripts/g.mjs': "console.log('scripts podem');\n",
    'packages/tokens/src/h.ts': '// console.log aqui e so comentario\nexport const a = 1;\n',
  };
  for (const [path, content] of Object.entries(ok)) {
    check('check-logs.mjs', { [path]: content }, false);
  }
});

test('check-typography: reprova fonte e peso fora do permitido', () => {
  check('check-typography.mjs', { 'apps/web/a.css': 'a { font-family: Arial; }\n' }, true, /Arial/);
  check('check-typography.mjs', { 'apps/web/a.css': 'a { font-weight: 600; }\n' }, true, /600/);
  check(
    'check-typography.mjs',
    { 'apps/web/a.css': 'a { font-family: Roboto; font-weight: 500; }\n' },
    false,
  );
});

test('check-env-example: so nomes', () => {
  check('check-env-example.mjs', { '.env.example': ENV_OK }, false);
  check('check-env-example.mjs', { '.env.example': 'APP_ENV=abc123\n' }, true, /tem valor/);
  check('check-env-example.mjs', { '.env.example': 'A=\nA=\n' }, true, /duplicado/);
  check(
    'check-env-example.mjs',
    { '.env.example': 'NEXT_PUBLIC_SERVICE_ROLE_KEY=\n' },
    true,
    /publico/,
  );
});

test('check-env-example: .gitignore e variavel lida no codigo', () => {
  check(
    'check-env-example.mjs',
    { '.env.example': ENV_OK, '.gitignore': 'node_modules\n' },
    true,
    /gitignore/,
  );
  check(
    'check-env-example.mjs',
    { '.env.example': ENV_OK, 'apps/api/src/a.ts': 'const v = process.env.NAO_DECLARADA;\n' },
    true,
    /NAO_DECLARADA/,
  );
  check(
    'check-env-example.mjs',
    { '.env.example': ENV_OK, 'apps/api/src/a.ts': 'const v = process.env.APP_ENV;\n' },
    false,
  );
});

test('check-module-boundaries: import profundo, billing e packages -> apps', () => {
  const m = 'apps/api/src/modules';
  check(
    'check-module-boundaries.mjs',
    { [`${m}/requests/a.ts`]: "import { x } from '../catalog/domain/x';\n" },
    true,
    /profundo/,
  );
  check(
    'check-module-boundaries.mjs',
    { [`${m}/requests/a.ts`]: "import { x } from '../catalog';\n" },
    false,
  );
  check(
    'check-module-boundaries.mjs',
    { [`${m}/billing/a.ts`]: "import { x } from '../chat';\n" },
    true,
    /billing/,
  );
  check(
    'check-module-boundaries.mjs',
    { 'packages/ui/src/a.ts': "import { x } from '@fastpro/web';\n" },
    true,
    /apps/,
  );
  check(
    'check-module-boundaries.mjs',
    { 'packages/domain/src/a.ts': "import fs from 'node:fs';\n" },
    true,
    /I\/O/,
  );
  check(
    'check-module-boundaries.mjs',
    { 'packages/domain/src/a.ts': 'export const a = 1;\n' },
    false,
  );
});

test('check-no-attachments: reprova anexo de chat', () => {
  const bucket = ['chat', 'attachments'].join('-');
  check(
    'check-no-attachments.mjs',
    { 'supabase/migrations/1.sql': `insert into storage.buckets values ('${bucket}');\n` },
    true,
    /anexo/,
  );
  check(
    'check-no-attachments.mjs',
    { 'apps/api/src/a.ts': 'export const t = "message_attachment";\n' },
    true,
  );
  check(
    'check-no-attachments.mjs',
    { 'apps/api/src/a.ts': 'export const t = "message";\n' },
    false,
  );
});

test('check-secrets: reprova formatos conhecidos e atribuicao com valor', () => {
  const fake = (n) => 'A1b2C3d4'.repeat(n);
  const jwt = ['eyJ' + fake(2), 'eyJ' + fake(2), fake(2)].join('.');
  const pem = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const mp = `APP_USR-${'1'.repeat(10)}-${'2'.repeat(6)}-${'a'.repeat(32)}-${'3'.repeat(8)}`;
  const resend = 're_' + fake(3);
  const dburl = `postgres://app:${fake(1)}@db.example.test:5432/x`;
  check('check-secrets.mjs', { 'apps/api/a.ts': `const t = "${jwt}";\n` }, true, /JWT/);
  check('check-secrets.mjs', { 'k.txt': `${pem}\n` }, true, /chave privada/);
  check('check-secrets.mjs', { 'apps/api/a.ts': `const t = "${mp}";\n` }, true, /Mercado Pago/);
  check('check-secrets.mjs', { 'apps/api/a.ts': `const t = "${resend}";\n` }, true, /Resend/);
  check('check-secrets.mjs', { 'apps/api/a.ts': `const t = "${dburl}";\n` }, true, /banco/);
  check(
    'check-secrets.mjs',
    { 'ci.yml': `MP_ACCESS_TOKEN: ${fake(2)}\n` },
    true,
    /MP_ACCESS_TOKEN/,
  );
});

test('check-secrets: service_role so em locais permitidos; placeholders passam', () => {
  check(
    'check-secrets.mjs',
    { 'apps/web/src/a.ts': 'const k = "service_role";\n' },
    true,
    /service_role/,
  );
  check('check-secrets.mjs', { 'docs/a.md': 'o papel service_role nunca vai ao cliente\n' }, false);
  check(
    'check-secrets.mjs',
    { 'supabase/migrations/1.sql': 'grant usage on schema x to service_role;\n' },
    false,
  );
  check(
    'check-secrets.mjs',
    { 'a.env.txt': 'SESSION_COOKIE_SECRET=<defina-localmente>\nJOBS_TICK_SECRET=\n' },
    false,
  );
});

test('check-secrets: nomes camelCase/minusculos e pares chave:valor entre aspas', () => {
  const hex64 = 'ab12cd34'.repeat(8);
  const body = 'A1b2C3d4E5f6';
  const cases = [
    [`const pepper = "${hex64}";\n`, /pepper|hexadecimal/],
    [`const webhookSecret = "whsec_${body}${body}";\n`, /whsec_|webhookSecret/],
    [`const key = "${['sk', 'live', body + body].join('_')}";\n`, /sk_live_/],
    [`fetch(u, { headers: { Authorization: "Bearer ${body}${body}.x" } });\n`, /Bearer/],
    [`const pub = "${['sb', 'publishable', body + body].join('_')}";\n`, /sb_publishable_/],
    [`{ "sessionCookieSecret": "${body}${body}" }\n`, /sessionCookieSecret/],
    [`const apiKey = '${body}${body}';\n`, /apiKey/],
    [`service_role_key: ${body}${body}\n`, /service_role_key/],
  ];
  for (const [line, match] of cases) {
    check('check-secrets.mjs', { 'apps/api/src/a.ts': line }, true, match);
  }
  // Valor hexadecimal longo avulso (sem nome sensivel) tambem reprova.
  check(
    'check-secrets.mjs',
    { 'apps/api/src/a.ts': `const x = "${hex64}";\n` },
    true,
    /hexadecimal/,
  );
});

test('check-secrets: usos legitimos nao sao falso positivo', () => {
  const ok = (path, line) => check('check-secrets.mjs', { [path]: line }, false);
  ok('packages/config/src/env.ts', 'SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),\n');
  ok('packages/config/src/env.ts', 'MP_WEBHOOK_SECRET: z.string().min(16),\n');
  ok(
    'apps/api/src/modules/media/storage.ts',
    'const k = process.env.SUPABASE_SERVICE_ROLE_KEY; // service_role isolado\n',
  );
  ok(
    'apps/api/src/modules/media/storage.ts',
    "const k = process.env['SUPABASE_SERVICE_ROLE_KEY'];\n",
  );
  ok('apps/api/src/modules/identity/admin.ts', 'const name = "service_role";\n');
  ok('apps/api/src/a.ts', 'const token: string = req.headers.authorization;\n');
  ok('apps/api/src/a.ts', 'headers: { Authorization: `Bearer ${token}` },\n');
  ok('apps/web/src/a.ts', 'const key = "chave";\nconst pepper = process.env.PEPPER_EMAIL_HMAC;\n');
  ok('docs/a.md', 'SHA256 do arquivo: ' + 'ab12cd34'.repeat(8) + '\n');
  // Fora dos locais permitidos, service_role segue reprovado mesmo como nome.
  check(
    'check-secrets.mjs',
    { 'apps/api/src/modules/billing/a.ts': 'const r = "service_role";\n' },
    true,
    /service_role/,
  );
});

test('check-secrets --history: falha de leitura do historico FALHA (nao vira ok)', () => {
  const dir = fixture({ 'a.txt': 'ok\n' });
  try {
    const git = (...a) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], {
        cwd: dir,
      });
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
    assert.equal(run('check-secrets.mjs', dir, ['--history']).code, 0);
    const r = run('check-secrets.mjs', dir, ['--history'], { CHECK_SECRETS_MAX_BUFFER: '16' });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /falha ao ler o historico/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-secrets --history: repositorio sem commits passa', () => {
  const dir = fixture({ 'a.txt': 'ok\n' });
  try {
    assert.equal(run('check-secrets.mjs', dir, ['--history']).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-module-boundaries: resolve import relativo contra o diretorio do arquivo', () => {
  const m = 'apps/api/src/modules';
  const mb = 'check-module-boundaries.mjs';
  // Dentro do proprio modulo: livre, em qualquer profundidade.
  check(mb, { [`${m}/billing/domain/a.ts`]: "import { e } from '../domain/entity';\n" }, false);
  check(mb, { [`${m}/billing/a.ts`]: "import { e } from './domain/entity';\n" }, false);
  check(mb, { [`${m}/billing/a/b/c.ts`]: "import { e } from '../../domain/entity';\n" }, false);
  // Outro modulo pelo index: livre; profundo: reprova (relativo e por modules/).
  check(mb, { [`${m}/requests/a.ts`]: "import { c } from '../catalog/index';\n" }, false);
  check(mb, { [`${m}/requests/x/a.ts`]: "import { c } from '../../catalog';\n" }, false);
  check(
    mb,
    { [`${m}/requests/a.ts`]: "import { c } from '../catalog/infra/repo';\n" },
    true,
    /profundo/,
  );
  check(
    mb,
    { [`${m}/billing/a.ts`]: "import { x } from '../../modules/requests/internal/x';\n" },
    true,
    /requests/,
  );
  // billing nunca importa requests/distribution/selection/chat (de qualquer profundidade).
  check(mb, { [`${m}/billing/a.ts`]: "import { c } from '../../chat';\n" }, true, /billing/);
  check(mb, { [`${m}/billing/domain/a.ts`]: "import { c } from '../../chat';\n" }, true, /billing/);
  check(mb, { [`${m}/billing/a.ts`]: "import { c } from '../selection';\n" }, true, /billing/);
});

test('check-secrets --history: acha segredo removido depois', () => {
  const dir = fixture({ 'a.txt': 'ok\n' });
  try {
    const git = (...a) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], {
        cwd: dir,
      });
    const secret = 're_' + 'A1b2C3d4'.repeat(3);
    writeFileSync(join(dir, 'a.txt'), `${secret}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
    writeFileSync(join(dir, 'a.txt'), 'limpo\n');
    git('commit', '-q', '-am', 'y');
    assert.equal(run('check-secrets.mjs', dir).code, 0);
    const r = run('check-secrets.mjs', dir, ['--history']);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /historico/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
