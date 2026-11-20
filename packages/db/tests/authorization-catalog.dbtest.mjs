// Issue 124 (H-115), fatia F2: catalogo de autorizacao no banco (CAT-01 a CAT-08 e secao 6.4 do
// desenho 164-DESENHO-H115.md). Executar: pnpm db:test (ou node --test packages/db/tests/authorization-catalog.dbtest.mjs).
// Somente leitura em pg_catalog/information_schema. As sondas de contexto (CAT-08, 6.4) rodam dentro
// de uma transacao que termina em rollback; nada e gravado. Nenhuma funcao e alterada aqui.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

// Esquemas de produto e Data API (public). Obtidos por consulta; nenhuma tabela e fixada.
const PRODUCT_SCHEMAS = ['app', 'billing', 'ops', 'audit', 'private', 'public'];
const DOMAIN_TABLES = ['app.service_request', 'app.acceptance'];
const DOMAIN_BUCKETS = ['request-photos', 'identity-docs'];

// CAT-06: nenhuma excecao. A migracao 20261120300000 revogou as funcoes dsr_* de gatilho e a
// 20261120430000 revogou dsr_case_transition_allowed (decisao 1 do lider). Lista vazia = sem excecao.
const CAT06_EXCECOES = new Map();

// Funcoes administrativas e de sessao (6.4) cujo acesso depende de sessao admin com aal2.
const ADMIN_NAME = /^(admin_|verification_|access_case_|approval_|idoc_review|audit_query|retention_policy|dsr_admin)/;
// Helpers que resolvem a sessao admin (o aal2 vem da coluna aal2_at, NOT NULL, e de admin_guard).
const SESSION_HELPERS = ['admin_guard(', 'verification_session_ok(', 'access_case_session_totp(', 'admin_session_subject(', 'admin_session_expiry(', 'admin_step_up('];

let client;

before(async () => {
  client = await connect();
});

after(async () => {
  await client?.end();
});

async function rollbackSafe() {
  await client.query('rollback').catch(() => {});
}

// Consulta de relacoes de produto (tabelas e views), excluindo objetos de extensao.
const PRODUCT_RELATIONS = `
  select n.nspname as schema, c.relname as nome, c.relkind::text as tipo,
         c.relrowsecurity as rls, c.relforcerowsecurity as rls_forcada,
         coalesce('security_invoker=true' = any(c.reloptions), false) as invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1)
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
   order by 1, 2`;

test('[CP-25] CAT-01: toda tabela de produto tem RLS habilitada e forcada (esquemas por consulta)', async (t) => {
  const { rows } = await client.query(PRODUCT_RELATIONS, [PRODUCT_SCHEMAS]);
  const tabelas = rows.filter((r) => r.tipo === 'r' || r.tipo === 'p');
  assert.ok(tabelas.length > 0, 'deveria haver tabelas de produto');
  const violacoes = tabelas
    .filter((r) => !(r.rls && r.rls_forcada))
    .map((r) => `${r.schema}.${r.nome}`);
  t.diagnostic(`tabelas verificadas: ${tabelas.length}`);
  assert.deepEqual(violacoes, [], `sem RLS habilitada e forcada: ${violacoes.join(', ')}`);
});

test('CAT-02: anon e authenticated sem privilegio de tabela, view ou coluna nos esquemas de produto', async (t) => {
  const { rows } = await client.query(
    `select n.nspname||'.'||c.relname as objeto, papel.role as papel
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('anon'), ('authenticated')) as papel(role)
      where n.nspname = any($1)
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and (has_table_privilege(papel.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_any_column_privilege(papel.role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
      order by 1, 2`,
    [PRODUCT_SCHEMAS],
  );
  const violacoes = rows.map((r) => `${r.objeto} -> ${r.papel}`);
  assert.deepEqual(violacoes, [], `privilegio indevido: ${violacoes.join(', ')}`);

  // Aviso (nao falha): USAGE em esquema de negocio e so informativo quando nao ha uso comprovado.
  const usage = [];
  for (const schema of ['app', 'billing', 'ops', 'audit', 'private']) {
    for (const papel of ['anon', 'authenticated']) {
      const r = await client.query('select has_schema_privilege($1, $2, $3) as ok', [papel, schema, 'USAGE']);
      if (r.rows[0].ok) usage.push(`${papel}:${schema}`);
    }
  }
  if (usage.length > 0) t.diagnostic(`AVISO: USAGE em esquema de negocio (revisar): ${usage.join(', ')}`);
});

test('CAT-03: papeis da API sem BYPASSRLS nem superusuario; nenhum papel de login da API herda BYPASSRLS', async (t) => {
  const { rows } = await client.query(
    `select rolname, rolbypassrls, rolsuper, rolcanlogin from pg_roles
      where rolname in ('app_api', 'app_keepalive', 'fastpro_api_login', 'fastpro_system_login', 'app_backup_reader')`,
  );
  const por = Object.fromEntries(rows.map((r) => [r.rolname, r]));
  for (const nome of ['app_api', 'app_keepalive']) {
    assert.ok(por[nome], `${nome} deveria existir`);
    assert.equal(por[nome].rolbypassrls, false, `${nome} nao pode ter BYPASSRLS`);
    assert.equal(por[nome].rolsuper, false, `${nome} nao pode ser superusuario`);
  }
  // Heranca: nenhum papel de que app_api e membro (direta ou indiretamente) pode ter BYPASSRLS/superuser.
  const heranca = await client.query(
    `with recursive m as (
        select roleid from pg_auth_members where member = 'app_api'::regrole
        union
        select a.roleid from pg_auth_members a join m on a.member = m.roleid)
     select r.rolname from m join pg_roles r on r.oid = m.roleid
      where r.rolbypassrls or r.rolsuper`,
  );
  assert.deepEqual(heranca.rows.map((r) => r.rolname), [], 'app_api herda BYPASSRLS ou superusuario');
  // Login da API (conexao DATABASE_URL_APP_API), quando existir neste banco.
  if (por.fastpro_api_login) {
    assert.equal(por.fastpro_api_login.rolbypassrls, false, 'fastpro_api_login nao pode ter BYPASSRLS');
  } else {
    t.diagnostic('fastpro_api_login ausente neste banco: verificacao de login pulada');
  }
  // Achado A-7 (pendencia do lider, fora de H-115): papel de leitura de backup com LOGIN e BYPASSRLS.
  if (por.app_backup_reader?.rolcanlogin && por.app_backup_reader?.rolbypassrls) {
    t.diagnostic('PENDENCIA A-7: app_backup_reader tem LOGIN e BYPASSRLS (fora de H-115; nao tratado aqui)');
  }
});

test('[CP-26] CAT-04: toda funcao SECURITY DEFINER de produto tem search_path vazio', async () => {
  const { rows } = await client.query(
    `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as fn
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)
        and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                         where regexp_replace(cfg, '["'']', '', 'g') = 'search_path=')
      order by 1`,
    [PRODUCT_SCHEMAS],
  );
  assert.deepEqual(rows.map((r) => r.fn), [], 'SECURITY DEFINER sem search_path vazio');
});

test('CAT-05: toda view de produto tem security_invoker (nenhuma materializada)', async () => {
  const { rows } = await client.query(PRODUCT_RELATIONS, [PRODUCT_SCHEMAS]);
  const violacoes = rows
    .filter((r) => r.tipo === 'v' && !r.invoker)
    .map((r) => `${r.schema}.${r.nome}`);
  const materializadas = rows.filter((r) => r.tipo === 'm' || r.tipo === 'f').map((r) => `${r.schema}.${r.nome}`);
  assert.deepEqual(violacoes, [], `view sem security_invoker: ${violacoes.join(', ')}`);
  assert.deepEqual(materializadas, [], `view materializada/estrangeira (sem RLS): ${materializadas.join(', ')}`);
});

test('CAT-06: EXECUTE de funcoes private.* negado a PUBLIC, anon e authenticated (excecoes explicitas)', async (t) => {
  const { rows } = await client.query(
    `select p.proname as nome
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and (has_function_privilege('public', p.oid, 'EXECUTE')
             or has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      order by 1`,
  );
  const naoListadas = rows.map((r) => r.nome).filter((nome) => !CAT06_EXCECOES.has(nome));
  for (const [nome, motivo] of CAT06_EXCECOES) {
    if (rows.some((r) => r.nome === nome)) t.diagnostic(`EXCECAO CAT-06 (${nome}): ${motivo}`);
  }
  assert.deepEqual(naoListadas, [], `private.* executavel por PUBLIC/anon/authenticated: ${naoListadas.join(', ')}`);
  // Regressao: as funcoes de gatilho dsr_* revogadas pela 20261120300000 nao podem voltar.
  const trigger = await client.query(
    `select p.proname as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname like 'dsr\\_%' and p.prorettype = 'trigger'::regtype
        and (has_function_privilege('public', p.oid, 'EXECUTE')
             or has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
  );
  assert.deepEqual(trigger.rows.map((r) => r.nome), [], 'funcao de gatilho dsr_* voltou a ser executavel');
});

test('[CP-17] CAT-07: buckets sensiveis privados e nenhuma politica permissiva de leitura para anon/public em storage.objects', async (t) => {
  const buckets = await client.query('select id, public from storage.buckets where id = any($1) order by id', [DOMAIN_BUCKETS]);
  assert.equal(buckets.rows.length, DOMAIN_BUCKETS.length, 'buckets de foto e documento deveriam existir');
  assert.deepEqual(buckets.rows.filter((r) => r.public).map((r) => r.id), [], 'bucket sensivel marcado como publico');

  // RLS habilitada e forcada em storage.objects: sem politica permissiva, a leitura e negada por padrao.
  const rls = await client.query(
    "select relrowsecurity as rls, relforcerowsecurity as forcada from pg_class where oid = 'storage.objects'::regclass",
  );
  assert.equal(rls.rows[0]?.rls, true, 'storage.objects deveria ter RLS habilitada');
  // Tabela gerenciada pela plataforma (dono nao e o papel do produto): FORCE nao e aplicavel aqui.
  if (rls.rows[0]?.forcada !== true) t.diagnostic('storage.objects: RLS habilitada, nao forcada (tabela gerenciada pela plataforma)');

  // Nenhuma politica permissiva de leitura para anon, public ou authenticated que alcance os buckets
  // sensiveis (qual nulo alcanca todos os buckets; qual citando um dos buckets tambem conta).
  const politicas = await client.query(
    `select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
        and cmd in ('SELECT', 'ALL')
        and (roles::text[] && array['public', 'anon', 'authenticated'])
        and (qual is null or qual ~ 'request-photos|identity-docs')`,
  );
  assert.deepEqual(politicas.rows.map((r) => r.policyname), [], 'politica permissiva de leitura alcanca buckets sensiveis');
  // Nota: anon ja tem SELECT de tabela em storage.objects pelo padrao da plataforma; a barreira e a RLS acima.
  t.diagnostic('CAT-07: leitura direta negada por RLS (sem politica permissiva para anon/public/authenticated); foto e documento so por URL assinada da API');
});

test('CAT-08: contexto ausente nega leitura de tabela de dominio como app_api (default-deny por privilegio)', async () => {
  // O papel postgres (conexao do executor) nao pode SET ROLE app_api (set_option = false), entao a
  // negacao e provada no catalogo: app_api sem SELECT/escrita em tabela de dominio nega a leitura
  // antes de qualquer RLS, com ou sem set_config do principal. Ver A-10 no documento da fatia.
  for (const tabela of DOMAIN_TABLES) {
    const r = await client.query(
      "select has_table_privilege('app_api', $1, 'SELECT,INSERT,UPDATE,DELETE') as ok",
      [tabela],
    );
    assert.equal(r.rows[0].ok, false, `${tabela}: app_api tem privilegio de tabela (deveria ser default-deny)`);
  }
});

test('6.4: sessao admin sem aal2 nao existe (coluna NOT NULL) e admin_guard exige aal2_at', async () => {
  const col = await client.query(
    `select is_nullable from information_schema.columns
      where table_schema = 'app' and table_name = 'admin_session' and column_name = 'aal2_at'`,
  );
  assert.equal(col.rows[0]?.is_nullable, 'NO', 'app.admin_session.aal2_at deveria ser NOT NULL');
  const guard = await client.query(
    `select pg_get_functiondef(p.oid) as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'admin_guard'`,
  );
  assert.match(guard.rows[0]?.d ?? '', /aal2_at is not null/, 'admin_guard deveria exigir aal2_at');
});

test('6.4: funcoes admin com sessao resolvem a sessao (helper ou tabela de sessao); lista revisada', async () => {
  const { rows } = await client.query(
    `select n.nspname||'.'||p.proname as fn, pg_get_functiondef(p.oid) as d
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.prosecdef
        and p.proname ~ $1
        and pg_get_function_identity_arguments(p.oid) ~ 'session_hash|secret_hash'`,
    [ADMIN_NAME.source],
  );
  assert.ok(rows.length > 0, 'deveria haver funcoes admin com sessao');
  const sem = rows
    .filter((r) => !r.d.includes('app.admin_session') && !SESSION_HELPERS.some((h) => r.d.includes(h)))
    .map((r) => r.fn);
  assert.deepEqual(sem, [], `funcao admin com sessao sem checagem de sessao: ${sem.join(', ')}`);
});

test('6.4: catalogo admin exige aal2 e a permissao certa (aal1 negado; aal2 sem permissao negado; aal2 com permissao ok)', async () => {
  // Rota de producao: app_api executa catalog_admin_list (EXECUTE confirmado abaixo). O gate
  // catalog_assert_admin le so as variaveis app.* (set_config local), entao a logica e exercida aqui
  // pelo papel do executor; a concessao de papel e provada no catalogo.
  const exec = await client.query("select has_function_privilege('app_api', 'private.catalog_admin_list()', 'EXECUTE') as ok");
  assert.equal(exec.rows[0].ok, true, 'app_api deveria executar private.catalog_admin_list');
  const principal = randomUUID();
  const sessao = async (aal, perms) => {
    await client.query("select set_config('app.principal_type', 'admin', true)");
    await client.query("select set_config('app.aal', $1, true)", [aal]);
    await client.query("select set_config('app.principal_id', $1, true)", [principal]);
    await client.query("select set_config('app.permissions', $1, true)", [perms]);
  };
  const chamar = async () => {
    try {
      await client.query('select * from private.catalog_admin_list()');
      return 'ok';
    } catch (err) {
      return err.code;
    }
  };
  const casos = [
    ['aal1 com catalog.manage', 'aal1', 'catalog.manage', '42501'],
    ['aal2 sem permissao', 'aal2', '', '42501'],
    ['aal2 com catalog.manage', 'aal2', 'catalog.manage', 'ok'],
  ];
  for (const [nome, aal, perms, esperado] of casos) {
    await client.query('begin');
    try {
      await sessao(aal, perms);
      const obtido = await chamar();
      assert.equal(obtido, esperado, `${nome}: esperado ${esperado}, veio ${obtido}`);
    } finally {
      await rollbackSafe();
    }
  }
});
