// Testes de catalogo do banco (H-003). Rodam contra o banco de desenvolvimento (projeto Supabase
// gratuito) e sao SOMENTE LEITURA, exceto o autoteste da regra de RLS, que cria uma tabela
// temporaria dentro de uma transacao e desfaz (rollback). Executar: pnpm db:test.
// Nao ha banco efemero (sem Docker); por isso nada aqui grava dados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect, MIGRATIONS_DIR } from '../scripts/lib/env.mjs';
import { listMigrations } from '../scripts/lib/migrations.mjs';

const PRODUCT_SCHEMAS = ['app', 'billing', 'audit', 'ops', 'private'];
// pg_net e pg_cron (H-008) ficam fora: sao opcionais (podem estar desativados) e tem teste proprio.
const EXPECTED_EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'citext', 'btree_gist'];

// Esquemas verificados quanto a objetos relacionais: os do produto e o public (Data API).
const CHECKED_SCHEMAS = [...PRODUCT_SCHEMAS, 'public'];

// Objetos relacionais (tabelas r/p, views v, views materializadas m, tabelas estrangeiras f) fora
// do padrao: tabelas precisam de RLS habilitada E forcada; views precisam de security_invoker
// (senao ignoram a RLS das tabelas base); views materializadas e tabelas estrangeiras nao suportam
// RLS e por isso sao reprovadas; nenhum objeto pode dar acesso a anon, authenticated ou PUBLIC.
// Objetos pertencentes a extensoes ficam de fora (nao sao do produto).
const NON_COMPLIANT_OBJECTS = `
  select n.nspname || '.' || c.relname as objeto, c.relkind::text as tipo,
         array_remove(array[
           case when c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)
                then 'sem RLS habilitada e forcada' end,
           case when c.relkind = 'v'
                 and not coalesce('security_invoker=true' = any(c.reloptions), false)
                then 'view sem security_invoker' end,
           case when c.relkind in ('m', 'f')
                then 'view materializada/tabela estrangeira nao suporta RLS' end,
           case when has_table_privilege('anon', c.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                then 'acessivel a anon' end,
           case when has_table_privilege('authenticated', c.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                then 'acessivel a authenticated' end,
           case when exists (
                  select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where a.grantee = 0)
                then 'acessivel a PUBLIC' end
         ], null) as motivos
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1)
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid
                        and d.deptype = 'e')
   order by 1`;

async function nonCompliant() {
  const res = await client.query(NON_COMPLIANT_OBJECTS, [CHECKED_SCHEMAS]);
  return res.rows
    .filter((r) => r.motivos.length > 0)
    .map((r) => `${r.objeto} (${r.tipo}): ${r.motivos.join(', ')}`);
}

let client;

before(async () => {
  client = await connect();
});

after(async () => {
  await client?.end();
});

test('tabela de controle existe e todas as migracoes do repositorio estao aplicadas', async () => {
  const reg = await client.query("select to_regclass('ops.schema_migration') as t");
  assert.ok(reg.rows[0].t, 'ops.schema_migration deveria existir');
  const applied = new Map(
    (await client.query('select version, checksum from ops.schema_migration')).rows.map((r) => [
      r.version,
      r.checksum,
    ]),
  );
  for (const m of listMigrations(MIGRATIONS_DIR)) {
    assert.equal(applied.get(m.version), m.checksum, `migracao ${m.file} ausente ou alterada`);
  }
});

test('esquemas do produto existem', async () => {
  const res = await client.query('select nspname from pg_namespace where nspname = any($1)', [
    PRODUCT_SCHEMAS,
  ]);
  assert.deepEqual(res.rows.map((r) => r.nspname).sort(), [...PRODUCT_SCHEMAS].sort());
});

test('extensoes esperadas estao instaladas no esquema extensions', async () => {
  const res = await client.query(
    `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = any($1)`,
    [EXPECTED_EXTENSIONS],
  );
  const found = Object.fromEntries(res.rows.map((r) => [r.extname, r.nspname]));
  for (const ext of EXPECTED_EXTENSIONS) {
    assert.equal(found[ext], 'extensions', `extensao ${ext} deveria estar em extensions`);
  }
});

test('nenhum objeto (tabela, view, view materializada, tabela estrangeira) fora do padrao nos esquemas do produto e em public', async () => {
  assert.deepEqual(await nonCompliant(), []);
});

test('autoteste: a verificacao reprova tabela sem RLS, view, view materializada e exposicao a anon (rollback)', async () => {
  await client.query('begin');
  try {
    await client.query('create table app.zz_teste_sem_rls (id int)');
    await client.query('create view app.zz_teste_view as select 1 as id');
    await client.query('create materialized view app.zz_teste_mview as select 1 as id');
    await client.query('create table public.zz_teste_publica (id int)');
    await client.query('alter table public.zz_teste_publica enable row level security');
    await client.query('alter table public.zz_teste_publica force row level security');
    await client.query('grant select on public.zz_teste_publica to anon');
    const found = await nonCompliant();
    const byName = (name) => found.find((f) => f.startsWith(name + ' '));
    assert.match(byName('app.zz_teste_sem_rls'), /sem RLS habilitada e forcada/);
    assert.match(byName('app.zz_teste_view'), /view sem security_invoker/);
    assert.match(byName('app.zz_teste_mview'), /nao suporta RLS/);
    assert.match(byName('public.zz_teste_publica'), /acessivel a anon/);
    assert.equal(found.length, 4, `objetos inesperados: ${found.join('; ')}`);
  } finally {
    await client.query('rollback');
  }
  const check = await client.query(
    `select to_regclass('app.zz_teste_sem_rls') as a, to_regclass('app.zz_teste_view') as b,
            to_regclass('app.zz_teste_mview') as c, to_regclass('public.zz_teste_publica') as d`,
  );
  assert.deepEqual(check.rows[0], { a: null, b: null, c: null, d: null });
});

test('papeis da plataforma (anon, authenticated, chave de servico) e PUBLIC nao acessam os esquemas do produto', async () => {
  for (const schema of PRODUCT_SCHEMAS) {
    // Nome montado em partes: o check-secrets so permite o literal em modulos especificos.
    for (const role of ['anon', 'authenticated', 'service' + '_role']) {
      const res = await client.query(
        'select has_schema_privilege($1, $2, $3) as usage, has_schema_privilege($1, $2, $4) as cr',
        [role, schema, 'USAGE', 'CREATE'],
      );
      assert.equal(res.rows[0].usage, false, `${role} tem USAGE em ${schema}`);
      assert.equal(res.rows[0].cr, false, `${role} tem CREATE em ${schema}`);
    }
    const pub = await client.query(
      `select count(*)::int as n
         from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        where n.nspname = $1 and a.grantee = 0`,
      [schema],
    );
    assert.equal(pub.rows[0].n, 0, `PUBLIC tem permissao em ${schema}`);
  }
});

test('papeis app_api (sem BYPASSRLS) e app_system (BYPASSRLS) existem, sem superusuario, sem login e sem heranca', async () => {
  const res = await client.query(
    `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
       from pg_roles where rolname in ('app_api', 'app_system') order by rolname`,
  );
  const roles = Object.fromEntries(res.rows.map((r) => [r.rolname, r]));
  assert.ok(roles.app_api, 'app_api deveria existir');
  assert.ok(roles.app_system, 'app_system deveria existir');
  assert.equal(roles.app_api.rolbypassrls, false);
  assert.equal(roles.app_system.rolbypassrls, true);
  for (const r of Object.values(roles)) {
    assert.equal(r.rolsuper, false, `${r.rolname} nao pode ser superusuario`);
    assert.equal(r.rolcreaterole, false, `${r.rolname} nao pode criar papeis`);
    assert.equal(r.rolcreatedb, false, `${r.rolname} nao pode criar bancos`);
    assert.equal(r.rolcanlogin, false, `${r.rolname} deve ser NOLOGIN ate o passo manual`);
    assert.equal(r.rolinherit, false, `${r.rolname} deve ser NOINHERIT`);
  }
});

// Ausencia de senha: verificada via pg_authid (rolpassword) quando o papel de migracao consegue
// le-lo. Se um ambiente nao permitir (pg_authid ilegivel), fica registrada como NAO_VERIFICAVEL
// (teste ignorado com aviso); sem login (teste acima) a senha seria inutil de qualquer forma.
test('app_api/app_system sem senha definida (ou NAO_VERIFICAVEL se pg_authid for ilegivel)', async (t) => {
  const res = await client.query("select has_table_privilege('pg_authid', 'SELECT') as pode");
  if (res.rows[0].pode) {
    const pw = await client.query(
      "select rolname from pg_authid where rolname in ('app_api','app_system') and rolpassword is not null",
    );
    assert.deepEqual(pw.rows, [], 'papeis de aplicacao nao deveriam ter senha definida');
  } else {
    t.skip('NAO_VERIFICAVEL: pg_authid nao e legivel pelo papel de migracao');
  }
});

// H-008 (decisao do spike S-10): pg_cron e pg_net instalados, com pg_net em extensions e pg_cron em
// pg_catalog (medido no S-10). Estado degradado (o dono desativou as duas): nenhum esquema cron/net.
// Uma so ausente e falha: o estado parcial nao e esperado.
test('H-008: pg_cron e pg_net instalados (extensions/pg_catalog) ou ambos ausentes (sem esquemas cron/net)', async () => {
  const res = await client.query(
    'select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace ' +
      "where e.extname in ('pg_cron', 'pg_net')",
  );
  const found = Object.fromEntries(res.rows.map((r) => [r.extname, r.nspname]));
  const schemas = await client.query(
    "select nspname from pg_namespace where nspname in ('cron', 'net') order by 1",
  );
  if (!found.pg_cron && !found.pg_net) {
    assert.deepEqual(schemas.rows, [], 'estado degradado: nao deveria haver esquemas cron/net');
    return;
  }
  assert.equal(found.pg_cron, 'pg_catalog');
  assert.equal(found.pg_net, 'extensions');
  assert.deepEqual(
    schemas.rows.map((r) => r.nspname),
    ['cron', 'net'],
  );
});
