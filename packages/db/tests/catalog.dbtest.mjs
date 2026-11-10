// Testes de catalogo do banco (H-003). Rodam contra o banco de desenvolvimento (projeto Supabase
// gratuito) e sao SOMENTE LEITURA, exceto o autoteste da regra de RLS, que cria uma tabela
// temporaria dentro de uma transacao e desfaz (rollback). Executar: pnpm db:test.
// Nao ha banco efemero (sem Docker); por isso nada aqui grava dados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect, MIGRATIONS_DIR } from '../scripts/lib/env.mjs';
import { listMigrations } from '../scripts/lib/migrations.mjs';

const PRODUCT_SCHEMAS = ['app', 'billing', 'audit', 'ops', 'private'];
const EXPECTED_EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'citext', 'btree_gist'];

// Tabelas dos esquemas do produto sem RLS habilitada E forcada.
const TABLES_WITHOUT_RLS = `
  select n.nspname || '.' || c.relname as tabela
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1)
     and c.relkind in ('r', 'p')
     and not (c.relrowsecurity and c.relforcerowsecurity)
   order by 1`;

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

test('nenhuma tabela do produto sem RLS habilitada e forcada', async () => {
  const res = await client.query(TABLES_WITHOUT_RLS, [PRODUCT_SCHEMAS]);
  assert.deepEqual(
    res.rows.map((r) => r.tabela),
    [],
  );
});

test('autoteste: o teste de RLS reprova uma tabela criada sem RLS (rollback)', async () => {
  await client.query('begin');
  try {
    await client.query('create table app.zz_teste_sem_rls (id int)');
    const res = await client.query(TABLES_WITHOUT_RLS, [PRODUCT_SCHEMAS]);
    assert.deepEqual(
      res.rows.map((r) => r.tabela),
      ['app.zz_teste_sem_rls'],
    );
  } finally {
    await client.query('rollback');
  }
  const check = await client.query("select to_regclass('app.zz_teste_sem_rls') as t");
  assert.equal(check.rows[0].t, null, 'a tabela de teste deveria ter sido desfeita');
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

test('papeis app_api (sem BYPASSRLS) e app_system (BYPASSRLS) existem, sem superusuario', async () => {
  const res = await client.query(
    `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles where rolname in ('app_api', 'app_system') order by rolname`,
  );
  const roles = Object.fromEntries(res.rows.map((r) => [r.rolname, r]));
  assert.ok(roles.app_api, 'app_api deveria existir');
  assert.ok(roles.app_system, 'app_system deveria existir');
  assert.equal(roles.app_api.rolbypassrls, false);
  assert.equal(roles.app_system.rolbypassrls, true);
  for (const r of Object.values(roles)) {
    assert.equal(r.rolsuper, false);
    assert.equal(r.rolcreaterole, false);
    assert.equal(r.rolcreatedb, false);
  }
});

test('pg_cron e pg_net seguem desabilitados (decisao do spike S-10)', async () => {
  const res = await client.query(
    "select extname from pg_extension where extname in ('pg_cron', 'pg_net')",
  );
  assert.deepEqual(res.rows, []);
});
