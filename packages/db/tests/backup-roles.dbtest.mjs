// Testes de catalogo dos papeis do backup manual e do keep-alive (H-010; desenho 28-DESENHO-H010.md).
// SOMENTE LEITURA, exceto as tentativas de escrita, que rodam dentro de transacao com rollback e
// nao deixam nada gravado. Executar: pnpm db:test (banco de desenvolvimento).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

const PRODUCT_SCHEMAS = ['app', 'billing', 'audit', 'ops', 'private'];
const READER = 'app_backup_reader';
const KEEPALIVE = 'app_keepalive';
const ALL_TABLE_PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const WRITE_PRIVS = 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';

let client;

before(async () => {
  client = await connect();
});

after(async () => {
  await client?.end();
});

// Tabelas de dominio (relkind 'r', fora de extensoes) com os privilegios dos dois papeis.
async function tablePrivileges() {
  const res = await client.query(
    `select n.nspname || '.' || c.relname as objeto,
            has_table_privilege($1, c.oid, 'SELECT') as reader_select,
            has_table_privilege($1, c.oid, $2) as reader_write,
            has_table_privilege($3, c.oid, $4) as keepalive_any
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($5) and c.relkind = 'r'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                         and d.objid = c.oid and d.deptype = 'e')
      order by 1`,
    [READER, WRITE_PRIVS, KEEPALIVE, ALL_TABLE_PRIVS, PRODUCT_SCHEMAS],
  );
  return res.rows;
}

async function sequencePrivileges() {
  const res = await client.query(
    `select n.nspname || '.' || c.relname as objeto,
            has_sequence_privilege($1, c.oid, 'SELECT') as reader_select,
            has_sequence_privilege($2, c.oid, 'USAGE,SELECT,UPDATE') as keepalive_any
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($3) and c.relkind = 'S'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                         and d.objid = c.oid and d.deptype = 'e')
      order by 1`,
    [READER, KEEPALIVE, PRODUCT_SCHEMAS],
  );
  return res.rows;
}

async function schemaPrivilege(role, schema, priv) {
  const res = await client.query('select has_schema_privilege($1, $2, $3) as ok', [
    role,
    schema,
    priv,
  ]);
  return res.rows[0].ok;
}

test('papeis existem, sem superusuario, sem login, sem heranca, sem criacao de papeis ou bancos', async () => {
  const res = await client.query(
    `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
       from pg_roles where rolname = any($1) order by rolname`,
    [[READER, KEEPALIVE]],
  );
  const roles = Object.fromEntries(res.rows.map((r) => [r.rolname, r]));
  assert.ok(roles[READER], `${READER} deveria existir`);
  assert.ok(roles[KEEPALIVE], `${KEEPALIVE} deveria existir`);
  for (const r of Object.values(roles)) {
    assert.equal(r.rolsuper, false, `${r.rolname} nao pode ser superusuario`);
    assert.equal(r.rolcreaterole, false, `${r.rolname} nao pode criar papeis`);
    assert.equal(r.rolcreatedb, false, `${r.rolname} nao pode criar bancos`);
    assert.equal(r.rolcanlogin, false, `${r.rolname} deve ser NOLOGIN ate o passo manual`);
    assert.equal(r.rolinherit, false, `${r.rolname} deve ser NOINHERIT`);
  }
  // Leitura do backup precisa de BYPASSRLS (dump completo); o keep-alive nunca.
  assert.equal(roles[READER].rolbypassrls, true, `${READER} precisa de BYPASSRLS`);
  assert.equal(roles[KEEPALIVE].rolbypassrls, false, `${KEEPALIVE} nao pode ter BYPASSRLS`);
});

test('parametros de sessao: somente leitura por padrao nos dois papeis', async () => {
  const res = await client.query(
    `select r.rolname, s.setconfig from pg_db_role_setting s
       join pg_roles r on r.oid = s.setrole where r.rolname = any($1)`,
    [[READER, KEEPALIVE]],
  );
  const cfg = Object.fromEntries(res.rows.map((r) => [r.rolname, r.setconfig ?? []]));
  for (const role of [READER, KEEPALIVE]) {
    assert.ok(
      (cfg[role] ?? []).includes('default_transaction_read_only=on'),
      `${role} deveria ter default_transaction_read_only=on`,
    );
  }
});

test('T-BK-09: app_backup_reader le toda tabela e sequencia de dominio (nenhuma fica de fora do backup)', async () => {
  const tables = await tablePrivileges();
  assert.ok(tables.length > 0, 'deveria haver tabelas de dominio nos esquemas do produto');
  assert.deepEqual(
    tables.filter((t) => !t.reader_select).map((t) => t.objeto),
    [],
    'tabela de dominio sem SELECT ao papel de leitura (o backup sairia incompleto)',
  );
  assert.deepEqual(
    (await sequencePrivileges()).filter((s) => !s.reader_select).map((s) => s.objeto),
    [],
    'sequencia sem SELECT ao papel de leitura',
  );
});

test('T-BK-11: app_backup_reader sem escrita em tabela e sem CREATE nos esquemas do produto', async () => {
  const writable = (await tablePrivileges()).filter((t) => t.reader_write).map((t) => t.objeto);
  assert.deepEqual(writable, [], 'papel de leitura tem privilegio de escrita');
  for (const schema of PRODUCT_SCHEMAS) {
    assert.equal(
      await schemaPrivilege(READER, schema, 'CREATE'),
      false,
      `${READER} tem CREATE em ${schema}`,
    );
  }
});

test('app_backup_reader sem acesso a auth, storage e vault (quando existirem)', async () => {
  const ex = await client.query(
    "select nspname from pg_namespace where nspname in ('auth', 'storage', 'vault') order by 1",
  );
  for (const row of ex.rows) {
    assert.equal(
      await schemaPrivilege(READER, row.nspname, 'USAGE'),
      false,
      `${READER} tem USAGE em ${row.nspname}`,
    );
  }
});

test('T-KA-02 (catalogo): app_keepalive sem nenhum privilegio em tabela, sequencia ou esquema do produto', async () => {
  assert.deepEqual(
    (await tablePrivileges()).filter((t) => t.keepalive_any).map((t) => t.objeto),
    [],
    'keep-alive tem privilegio em tabela',
  );
  assert.deepEqual(
    (await sequencePrivileges()).filter((s) => s.keepalive_any).map((s) => s.objeto),
    [],
    'keep-alive tem privilegio em sequencia',
  );
  for (const schema of PRODUCT_SCHEMAS) {
    assert.equal(
      await schemaPrivilege(KEEPALIVE, schema, 'USAGE'),
      false,
      `keep-alive tem USAGE em ${schema}`,
    );
  }
});

// Tentativa real, dentro de transacao com rollback: nada e gravado. Se o SET ROLE for negado, o
// caso fica NAO_VERIFICAVEL e a checagem por catalogo acima continua valendo.
async function attemptAs(role, statements) {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    const outcomes = [];
    for (const [i, sql] of statements.entries()) {
      // Savepoint por instrucao: depois de um erro a transacao inteira ficaria abortada.
      await client.query(`savepoint s${i}`);
      try {
        await client.query(sql);
        outcomes.push('ok');
        await client.query(`release savepoint s${i}`);
      } catch (err) {
        outcomes.push(err.code ?? 'erro');
        await client.query(`rollback to savepoint s${i}`);
      }
    }
    return outcomes;
  } finally {
    await client.query('rollback');
  }
}

const WRITE_ATTEMPTS = [
  'create table app.zz_teste_h010 (id int)',
  "insert into ops.schema_migration (version, name, checksum) values ('1', 'x', 'y')",
  'delete from ops.schema_migration',
];

test('T-BK-11 / T-KA-02 (tentativa com rollback): escrita negada aos dois papeis', async (t) => {
  for (const role of [READER, KEEPALIVE]) {
    let outcomes;
    try {
      outcomes = await attemptAs(role, WRITE_ATTEMPTS);
    } catch (err) {
      if (err.code === '42501') {
        t.skip(`NAO_VERIFICAVEL: papel de teste nao pode ser assumido (SET ROLE ${role})`);
        return;
      }
      throw err;
    }
    assert.deepEqual(
      outcomes,
      ['42501', '42501', '42501'],
      `${role} deveria ter escrita negada (42501); obtido ${outcomes.join(',')}`,
    );
  }
});

test('T-BK-11 (tentativa com rollback): papel de leitura consegue ler a tabela de controle', async (t) => {
  let outcomes;
  try {
    outcomes = await attemptAs(READER, ['select count(*) from ops.schema_migration']);
  } catch (err) {
    if (err.code === '42501') {
      t.skip(`NAO_VERIFICAVEL: papel de teste nao pode ser assumido (SET ROLE ${READER})`);
      return;
    }
    throw err;
  }
  assert.deepEqual(outcomes, ['ok'], 'leitura da tabela de controle deveria ser permitida');
});

test('papeis do backup e do keep-alive sem senha definida (ou NAO_VERIFICAVEL se pg_authid for ilegivel)', async (t) => {
  const res = await client.query("select has_table_privilege('pg_authid', 'SELECT') as pode");
  if (res.rows[0].pode) {
    const pw = await client.query(
      'select rolname from pg_authid where rolname = any($1) and rolpassword is not null',
      [[READER, KEEPALIVE]],
    );
    assert.deepEqual(pw.rows, [], 'papeis do backup e do keep-alive nao deveriam ter senha');
  } else {
    t.skip('NAO_VERIFICAVEL: pg_authid nao e legivel pelo papel de migracao');
  }
});
