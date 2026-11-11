// H-100 | Verificador de ausencia de interruptor de e-mail (Issue #110; docs/factory/49-DESENHO-H100.md).
// Uso: node scripts/check-no-email-switch.mjs [--selftest]
// --selftest: monta fixtures em memoria; cada fixture ruim deve ser acusada pela regra esperada e a
// limpa nao pode ser acusada. Se o autoteste falhar, a varredura real nao conta como prova.
import { listFiles, readText, report } from './lib/files.mjs';
import { arquivosNaoVarridos, canarios, escopoW1, scan } from './lib/email-switch-rules.mjs';

const SQL_OK = 'supabase/migrations/20990101000000_fixture.sql';

const FIXTURES = [
  {
    id: 'F-01',
    esperado: ['N1', 'N2'],
    arquivos: { [SQL_OK]: 'create table ops.email_flag (id uuid primary key);\n' },
  },
  {
    id: 'F-02',
    esperado: ['N1'],
    arquivos: { [SQL_OK]: 'create table ops.x (id uuid, email_enabled boolean);\n' },
  },
  {
    id: 'F-03',
    esperado: ['C1', 'N1'],
    arquivos: {
      [SQL_OK]:
        "insert into ops.app_config (key, value) values ('notification.email.enabled', 'false');\n",
    },
  },
  {
    id: 'F-04',
    esperado: ['N1'],
    arquivos: { 'apps/api/src/f04.ts': 'const k = process.env.EMAIL_KILL_SWITCH;\n' },
  },
  {
    id: 'F-05',
    esperado: ['V1'],
    arquivos: {
      'packages/email/src/f05.ts': "export const EMAIL_PROVIDERS = ['resend', 'off'];\n",
    },
  },
  {
    id: 'F-06',
    esperado: ['V1'],
    arquivos: { 'apps/api/src/f06.ts': 'const p = env.EMAIL_PROVIDER;\n' },
  },
  { id: 'F-07', esperado: ['V1'], arquivos: { '.env.example': 'EMAIL_PROVIDER=none\n' } },
  {
    id: 'F-08',
    esperado: ['V2'],
    arquivos: { 'apps/api/src/f08.ts': 'const p = new NoopEmailProvider();\n' },
  },
  {
    id: 'F-09',
    esperado: ['R1'],
    arquivos: {
      'apps/web/src/app/admin/email/desligar/page.tsx': 'export default function Page() {}\n',
    },
  },
  {
    id: 'F-10',
    esperado: ['R1'],
    arquivos: { 'apps/api/src/f10.ts': "const rota = '/v1/admin/notificacoes/preferencias';\n" },
  },
  {
    id: 'F-11',
    esperado: ['J1'],
    arquivos: { 'apps/api/src/f11.ts': "registerJobHandler(registry, 'email.backfill', h);\n" },
  },
  {
    id: 'F-12',
    esperado: ['J1', 'N1'],
    arquivos: { 'apps/api/src/f12.ts': "registerJobHandler(registry, 'notification.pause', h);\n" },
  },
  {
    id: 'F-13',
    esperado: ['W1'],
    arquivos: {
      [SQL_OK]:
        'insert into ops.email_outbox (recipient_user_id)\nselect id from ops.outbox_event;\n',
    },
  },
  {
    id: 'F-14',
    esperado: ['W1'],
    arquivos: {
      [SQL_OK]:
        'create or replace function private.relatorio_x() returns void language plpgsql as $$\n' +
        "begin update ops.notification_item set state = 'enviado'; end\n$$;\n",
    },
  },
  {
    id: 'F-15',
    esperado: ['M1'],
    arquivos: {
      'packages/domain/src/notifications/f15.ts':
        'export const NOTIFICATION_EFFECTIVE_FROM = Number(process.env.X);\n',
    },
  },
  { id: 'F-16a', esperado: ['FC'], arquivos: {} },
  { id: 'F-16b', esperado: ['FC'], arquivos: { 'apps/web/src/x.ts': 'const a = 1;\n' } },
  // Plural do grupo E (49 §1.1 N1): emails e mails tambem contam.
  {
    id: 'F-17',
    esperado: ['N1'],
    arquivos: { 'apps/api/src/f17.ts': 'const emailsEnabled = true;\n' },
  },
  // Excecao do package.json casa so o nome exato: sufixo "-off" continua acusado.
  {
    id: 'F-18',
    esperado: ['N1'],
    arquivos: { 'package.json': '    "check:email-switch-off": "node scripts/x.mjs",\n' },
  },
];

const LIMPA = {
  id: 'F-L',
  esperado: [],
  arquivos: {
    [SQL_OK]:
      'alter table ops.email_outbox enable row level security;\n' +
      '-- email_enabled (comentario nao conta)\n' +
      'create or replace function private.notification_ingest() returns void language plpgsql as $$\n' +
      'begin insert into ops.notification_item (recipient_user_id) values (null); end\n$$;\n',
    'apps/api/src/limpa.ts':
      "const rota = '/v1/webhooks/resend';\n" +
      "registerJobHandler(registry, 'email.send', h);\n" +
      "const chave = 'notification.accept.window_seconds';\n" +
      "const url = 'https://exemplo.invalid/a--b';\n",
  },
};

const regrasDe = (violacoes) =>
  new Set(violacoes.map((v) => v.match(/ ([A-Z]{1,2}\d?): /)?.[1]).filter(Boolean));

function selftest() {
  let falhas = 0;
  for (const f of [...FIXTURES, LIMPA]) {
    // F-16 testa a falha fechada sem canarios; as demais fixtures carregam os canarios de cobertura.
    const arquivos = f.id.startsWith('F-16') ? f.arquivos : { ...canarios(), ...f.arquivos };
    const violacoes = scan(arquivos);
    const achadas = regrasDe(violacoes);
    const ok =
      f === LIMPA
        ? violacoes.length === 0
        : f.esperado.every((r) => achadas.has(r)) && violacoes.length > 0;
    if (!ok) {
      falhas += 1;
      console.error(
        `${f.id}: NAO ACUSADA como esperado (regras: ${[...achadas].join(',') || 'nenhuma'})`,
      );
      for (const v of violacoes) console.error(`  - ${v}`);
    } else {
      const rotulo = f === LIMPA ? 'limpa aprovada' : `acusada (${[...achadas].join(',')})`;
      console.log(`${f.id}: ${rotulo}`);
    }
  }
  const total = FIXTURES.length;
  if (falhas > 0) {
    console.error(`selftest: ${falhas} fixture(s) fora do esperado`);
    process.exit(1);
  }
  console.log(`selftest ok: ${total}/${total} fixtures ruins acusadas, 1/1 limpa aprovada`);
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const root = process.cwd();
  const todos = listFiles(root);
  const mapa = new Map();
  for (const p of todos.filter((x) => escopoW1(x))) {
    const texto = readText(root, p);
    if (texto !== null) mapa.set(p, texto);
  }
  const naoVarridos = arquivosNaoVarridos(todos);
  if (naoVarridos.length > 0) {
    console.log(
      `aviso: ${naoVarridos.length} arquivo(s) de extensao nao varrida (ex.: ${naoVarridos.slice(0, 3).join(', ')})`,
    );
  }
  report('check-no-email-switch', scan(mapa), `${mapa.size} arquivos`);
}
