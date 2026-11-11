// Testes de banco do catalogo de servicos (H-018, desenho 53-DESENHO-H018 §6.2): T-H018-10, 14 a 21.
// Rodam no banco de desenvolvimento COMPARTILHADO: cada caso roda dentro de transacao com ROLLBACK
// (nunca COMMIT). A semente NAO e aplicada aqui (a aplicacao real e comando explicito, depois da QA).
// Executar: pnpm db:test (exige a migracao 20261111200000 aplicada).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const TABLES = ['service_group', 'service', 'service_synonym', 'catalog_revision', 'catalog_seed_run'];
const PUBLIC_VIEW_COLUMNS = [
  'group_id',
  'group_name',
  'group_position',
  'service_id',
  'service_name',
  'modality',
  'regulated',
];

// --- Utilitarios ------------------------------------------------------------------------------------

/** Executa fn dentro de transacao que sempre termina em ROLLBACK. */
async function inTx(fn) {
  await client.query('begin');
  try {
    // Concessao valida so dentro da transacao (desfeita pelo rollback): permite SET LOCAL ROLE.
    await client.query('grant app_system, app_api to current_user');
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Exige que o comando falhe com o SQLSTATE indicado; a transacao segue viva (savepoint). */
async function expectError(sql, params, code) {
  await client.query('savepoint sp_expect');
  let err = null;
  try {
    await client.query(sql, params);
  } catch (e) {
    err = e;
  }
  if (err) await client.query('rollback to savepoint sp_expect');
  else await client.query('release savepoint sp_expect');
  assert.ok(err, `deveria falhar com ${code}`);
  assert.equal(err.code, code, `codigo inesperado (${err.code}): ${err.message}`);
  return err;
}

/** Define o principal da transacao (GUCs locais). Sem valor = ausente. */
async function asPrincipal({ type, id = '', aal = '', perms = '' }) {
  await client.query(
    `select set_config('app.principal_type', $1, true), set_config('app.principal_id', $2, true),
            set_config('app.aal', $3, true), set_config('app.permissions', $4, true)`,
    [type, id, aal, perms],
  );
}

const ADMIN = { type: 'admin', id: randomUUID(), aal: 'aal2', perms: 'catalog.manage' };

async function asAppApi(principal) {
  await client.query('set local role app_api');
  await asPrincipal(principal);
}

async function asOwner() {
  await client.query('reset role');
}

/** Cria, como dono, um grupo ativo com servico ativo, um grupo inativo com servico ativo e sinonimos. */
async function criarBase() {
  const b = { gA: randomUUID(), gB: randomUUID(), sA: randomUUID(), sB: randomUUID(), sSens: randomUUID() };
  await client.query(
    `insert into app.service_group (id, name, position, active) values
       ($1, 'Grupo teste A', 901, true), ($2, 'Grupo teste B', 902, false)`,
    [b.gA, b.gB],
  );
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active, council_body, moderation_sensitive)
     values ($1, $2, 'Servico teste A', 'online', false, true, null, false),
            ($3, $4, 'Servico teste B', 'presencial', false, true, null, false),
            ($5, $2, 'Servico teste sensivel', 'ambos', true, true, 'CRM', true)`,
    [b.sA, b.gA, b.sB, b.gB, b.sSens],
  );
  await client.query(
    `insert into app.service_synonym (service_id, term, active) values
       ($1, 'termo teste ativo', true), ($1, 'termo teste inativo', false)`,
    [b.sA],
  );
  return b;
}

// --- T-H018-10: catalogo do banco (RLS forcada e view com security_invoker) -------------------------

test('T-H018-10 tabelas do catalogo com RLS habilitada e forcada; view publica com security_invoker', async () => {
  const res = await client.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = any($1)`,
    [TABLES],
  );
  assert.equal(res.rows.length, TABLES.length);
  for (const r of res.rows) {
    assert.equal(r.relrowsecurity, true, `${r.relname} sem RLS habilitada`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname} sem RLS forcada`);
  }
  const view = await client.query(
    `select reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = 'catalog_public'`,
  );
  assert.ok(view.rows[0].reloptions.includes('security_invoker=true'));
});

// --- T-H018-14: leitura anonima ---------------------------------------------------------------------

test('T-H018-14 leitura anonima: so grupos e servicos ativos; colunas internas e controle negados (42501)', () =>
  inTx(async () => {
    const b = await criarBase();
    await asAppApi({ type: 'anonymous' });

    const groups = (await client.query('select id, name, position, active from app.service_group')).rows;
    const visibleGroups = groups.map((g) => g.id);
    assert.ok(visibleGroups.includes(b.gA), 'grupo ativo deveria aparecer');
    assert.ok(!visibleGroups.includes(b.gB), 'grupo inativo nao deveria aparecer');

    const services = (await client.query('select id, group_id, name, modality, regulated, active from app.service')).rows.map(
      (s) => s.id,
    );
    assert.ok(services.includes(b.sA), 'servico de grupo ativo deveria aparecer');
    assert.ok(!services.includes(b.sB), 'servico de grupo inativo nao deveria aparecer');

    const syn = (await client.query('select term, active from app.service_synonym')).rows.map((r) => r.term);
    assert.deepEqual(syn, ['termo teste ativo']);

    await expectError('select council_body from app.service', [], '42501');
    await expectError('select moderation_sensitive from app.service', [], '42501');
    await expectError('select seed_key from app.service_group', [], '42501');
    await expectError('select * from app.service', [], '42501');
    await expectError('select id from app.catalog_revision', [], '42501');
    await expectError('select id from app.catalog_seed_run', [], '42501');

    const view = (await client.query('select * from app.catalog_public')).rows;
    assert.deepEqual(Object.keys(view[0] ?? {}).sort(), [...PUBLIC_VIEW_COLUMNS].sort());
    assert.ok(view.some((r) => r.service_id === b.sA));
    assert.ok(!view.some((r) => r.service_id === b.sB || r.group_id === b.gB));
  }));

// --- T-H018-15: escrita negada ----------------------------------------------------------------------

test('T-H018-15 escrita negada: DML direto e funcoes catalog_*_save falham com 42501 e nada muda', () =>
  inTx(async () => {
    await criarBase();
    const cases = [
      { type: 'anonymous' },
      { type: 'customer', id: randomUUID(), aal: 'aal2', perms: 'catalog.manage' },
      { type: 'professional', id: randomUUID(), aal: 'aal2', perms: 'catalog.manage' },
      { type: 'admin', id: randomUUID(), aal: 'aal1', perms: 'catalog.manage' },
      { type: 'admin', id: randomUUID(), aal: 'aal2', perms: '' },
      { type: 'admin', id: randomUUID(), aal: 'aal2', perms: 'outra.permissao' },
    ];
    for (const principal of cases) {
      await asAppApi(principal);
      await expectError(`insert into app.service_group (name, position, active) values ('Negado X', 1, false)`, [], '42501');
      await expectError(`update app.service_group set name = 'Negado Y'`, [], '42501');
      await expectError('delete from app.service_group', [], '42501');
      await expectError('insert into app.service_synonym (service_id, term) values ($1, $2)', [randomUUID(), 'x'], '42501');
      await expectError(
        `select private.catalog_group_save(null, null, '{"name":"Negado X","position":1}'::jsonb)`,
        [],
        '42501',
      );
      await expectError(
        `select private.catalog_service_save(null, null, '{"name":"Negado X"}'::jsonb)`,
        [],
        '42501',
      );
      await expectError(
        `select private.catalog_synonym_save(null, null, '{"term":"Negado X"}'::jsonb)`,
        [],
        '42501',
      );
      await expectError('select private.catalog_admin_list()', [], '42501');
    }
    await asOwner();
    const negados = await client.query("select count(*)::int as n from app.service_group where name like 'Negado%'");
    assert.equal(negados.rows[0].n, 0, 'nada deveria ter sido gravado');
  }));

// --- T-H018-16: escrita permitida (administrador aal2 com catalog.manage) ---------------------------

test('T-H018-16 administrador: cria, altera e desativa; version sobe; versao errada = CT003; chave fora = CT004', () =>
  inTx(async () => {
    await asAppApi(ADMIN);
    const gid = (
      await client.query(
        'select private.catalog_group_save(null, null, $1::jsonb) as id',
        [JSON.stringify({ name: 'Grupo admin X', position: 950, active: false })],
      )
    ).rows[0].id;

    await client.query(
      'select private.catalog_group_save($1, 1, $2::jsonb)',
      [gid, JSON.stringify({ name: 'Grupo admin Y', active: false })],
    );
    await expectError('select private.catalog_group_save($1, 1, $2::jsonb)', [gid, '{"name":"Z"}'], 'CT003');
    await expectError('select private.catalog_group_save($1, 2, $2::jsonb)', [gid, '{"cor":"azul"}'], 'CT004');
    await expectError('select private.catalog_group_save($1, 2, $2::jsonb)', [gid, '{"name":""}'], 'CT004');

    const sid = (
      await client.query(
        'select private.catalog_service_save(null, null, $1::jsonb) as id',
        [JSON.stringify({ name: 'Servico admin X', group_id: gid, modality: 'online', regulated: false })],
      )
    ).rows[0].id;
    await expectError(
      'select private.catalog_service_save(null, null, $1::jsonb)',
      [JSON.stringify({ name: 'Servico ruim', group_id: gid, modality: 'remoto', regulated: false })],
      'CT004',
    );
    await expectError(
      'select private.catalog_service_save(null, null, $1::jsonb)',
      [JSON.stringify({ name: 'Servico ruim 2', group_id: gid, modality: 'online', regulated: false, council_body: 'CRM' })],
      'CT004',
    );
    const yid = (
      await client.query(
        'select private.catalog_synonym_save(null, null, $1::jsonb) as id',
        [JSON.stringify({ service_id: sid, term: 'termo admin' })],
      )
    ).rows[0].id;
    await client.query('select private.catalog_synonym_save($1, 1, $2::jsonb)', [
      yid,
      JSON.stringify({ active: false }),
    ]);

    await asOwner();
    const v = await client.query(
      `select (select version from app.service_group where id = $1) as g,
              (select version from app.service where id = $2) as s,
              (select version from app.service_synonym where id = $3) as y`,
      [gid, sid, yid],
    );
    assert.deepEqual(v.rows[0], { g: 2, s: 1, y: 2 });

    await asAppApi(ADMIN);
    const list = (await client.query('select private.catalog_admin_list() as j')).rows[0].j;
    assert.ok(list.groups.some((g) => g.id === gid && g.name === 'Grupo admin Y' && g.active === false));
  }));

// --- T-H018-17: auditoria e revisao na mesma transacao ----------------------------------------------

test('T-H018-17 cada mudanca gera 1 evento e 1 revisao (antes/depois completos); falha de auditoria desfaz', () =>
  inTx(async () => {
    await asOwner();
    const before = (
      await client.query("select count(*)::int as n from audit.audit_event where action = 'catalog.group.changed'")
    ).rows[0].n;
    await asAppApi(ADMIN);
    const gid = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo auditado', position: 960, active: false }),
      ])
    ).rows[0].id;
    await asOwner();
    const after = (
      await client.query("select count(*)::int as n from audit.audit_event where action = 'catalog.group.changed'")
    ).rows[0].n;
    assert.equal(after, before + 1, 'deveria haver exatamente 1 evento');
    const rev = await client.query(
      `select r.before, r.after, e.actor_ref, e.actor_role, e.object_type
         from app.catalog_revision r join audit.audit_event e on e.id = r.audit_event_id
        where r.entity_id = $1`,
      [gid],
    );
    assert.equal(rev.rows.length, 1, 'deveria haver exatamente 1 revisao');
    assert.equal(rev.rows[0].before, null);
    assert.equal(rev.rows[0].after.name, 'Grupo auditado');
    assert.equal(rev.rows[0].actor_ref, `admin:${ADMIN.id}`);
    assert.equal(rev.rows[0].actor_role, 'admin');
    assert.equal(rev.rows[0].object_type, 'service_group');

    const chain = (await client.query('select ok from private.audit_verify_chain()')).rows[0];
    assert.equal(chain.ok, true, 'cadeia de auditoria deveria estar integra');

    // Falha forcada da auditoria: substitui a funcao so nesta transacao (o rollback restaura).
    await client.query(`create or replace function private.audit_append(
        p_actor_ref text, p_actor_role text, p_action text, p_object_type text, p_object_id uuid,
        p_before_state jsonb, p_after_state jsonb, p_reason_code text default null,
        p_correlation_id uuid default null)
      returns uuid language plpgsql set search_path = '' as $$
      begin raise exception 'auditoria forcada para o teste' using errcode = 'AU002'; end $$`);
    await asAppApi(ADMIN);
    await expectError(
      'select private.catalog_group_save(null, null, $1::jsonb)',
      [JSON.stringify({ name: 'Grupo sem auditoria', position: 961, active: false })],
      'AU002',
    );
    await asOwner();
    const sem = await client.query("select count(*)::int as n from app.service_group where name = 'Grupo sem auditoria'");
    assert.equal(sem.rows[0].n, 0, 'a mudanca deveria ter sido desfeita junto com a auditoria');
  }));

// --- T-H018-18: invariante de grupo ativo com servico ativo (CT002 no COMMIT, aqui forcado) ---------

test('T-H018-18 invariante: grupo ativo sem servico ativo falha (CT002); desativar grupo e servico juntos passa', () =>
  inTx(async () => {
    await asAppApi(ADMIN);
    const a = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo inv A', position: 970, active: false }),
      ])
    ).rows[0].id;
    const b = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo inv B', position: 971, active: false }),
      ])
    ).rows[0].id;
    const s = (
      await client.query('select private.catalog_service_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Servico inv', group_id: a, modality: 'online', regulated: false, active: true }),
      ])
    ).rows[0].id;
    // A partir daqui, as verificacoes adiadas valem a cada comando (equivale ao COMMIT).
    await client.query('set constraints all immediate');
    await client.query('select private.catalog_group_save($1, 1, $2::jsonb)', [a, '{"active":true}']);
    await expectError('select private.catalog_service_save($1, 1, $2::jsonb)', [s, '{"active":false}'], 'CT002');
    // Mover o ultimo servico ativo para outro grupo: falha pelo grupo de origem.
    await expectError('select private.catalog_service_save($1, 1, $2::jsonb)', [s, JSON.stringify({ group_id: b })], 'CT002');
    // Desativar grupo e servico na mesma transacao: passa.
    await client.query('select private.catalog_group_save($1, 2, $2::jsonb)', [a, '{"active":false}']);
    await client.query('select private.catalog_service_save($1, 1, $2::jsonb)', [s, '{"active":false}']);
    await asOwner();
    const estado = (
      await client.query('select active from app.service_group where id = $1', [a])
    ).rows[0];
    assert.equal(estado.active, false);
  }));

// --- T-H018-19: unicidade por normalizacao (acento e caixa) -----------------------------------------

test('T-H018-19 unicidade: nome igual com acento/caixa no mesmo grupo e sinonimo repetido = 23505; outro grupo aceita', () =>
  inTx(async () => {
    await asAppApi(ADMIN);
    const g1 = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo unic 1', position: 980, active: false }),
      ])
    ).rows[0].id;
    const g2 = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo unic 2', position: 981, active: false }),
      ])
    ).rows[0].id;
    const svc = (name, gid) =>
      `select private.catalog_service_save(null, null, '${JSON.stringify({ name, group_id: gid, modality: 'online', regulated: false })}'::jsonb)`;
    await client.query(svc('Pintor residencial', g1));
    await expectError(svc('PINTOR  Residêncial', g1), [], '23505');
    await client.query(svc('Pintor residencial', g2));
    await asOwner();
    const sid = (
      await client.query(
        `select id from app.service where group_id = $1 and name = 'Pintor residencial'`,
        [g1],
      )
    ).rows[0].id;
    await asAppApi(ADMIN);
    await client.query('select private.catalog_synonym_save(null, null, $1::jsonb)', [
      JSON.stringify({ service_id: sid, term: 'pintura' }),
    ]);
    await expectError(
      'select private.catalog_synonym_save(null, null, $1::jsonb)',
      [JSON.stringify({ service_id: sid, term: 'PINTURA' })],
      '23505',
    );
  }));

// --- T-H018-20: revisao e auditoria imutaveis (ate para o dono) -------------------------------------

test('T-H018-20 catalog_revision e audit_event: update/delete falham com AU001 mesmo para o dono', () =>
  inTx(async () => {
    await asAppApi(ADMIN);
    await client.query('select private.catalog_group_save(null, null, $1::jsonb)', [
      JSON.stringify({ name: 'Grupo imutavel', position: 990, active: false }),
    ]);
    await asOwner();
    await client.query(
      `insert into app.catalog_seed_run (seed_version, checksum, groups_inserted, services_inserted,
              synonyms_inserted, skipped_conflict, groups_total, services_total, audit_event_id)
       values ('teste-imutavel', repeat('a', 64), 0, 0, 0, 0, 0, 0,
               (select id from audit.audit_event order by seq desc limit 1))`,
    );
    await expectError('update app.catalog_revision set version = 9', [], 'AU001');
    await expectError('delete from app.catalog_revision', [], 'AU001');
    await expectError('update audit.audit_event set object_type = object_type', [], 'AU001');
    await expectError('delete from audit.audit_event', [], 'AU001');
    await expectError("update app.catalog_seed_run set seed_version = 'x'", [], 'AU001');
  }));

// --- T-H018-21: council_body exige regulamentado; SENS e conselho fora da leitura publica -----------

test('T-H018-21 council_body sem regulated e rejeitado; leitura publica nao traz conselho nem sensibilidade', () =>
  inTx(async () => {
    const b = await criarBase();
    await asOwner();
    await expectError(
      `insert into app.service (group_id, name, modality, regulated, council_body, active)
       values ($1, 'Conselho sem regulado', 'online', false, 'CRM', true)`,
      [b.gA],
      '23514',
    );
    await asAppApi(ADMIN);
    await expectError(
      'select private.catalog_service_save(null, null, $1::jsonb)',
      [JSON.stringify({ name: 'Conselho sem regulado', group_id: b.gA, modality: 'online', regulated: false, council_body: 'CRM' })],
      'CT004',
    );
    await asAppApi({ type: 'anonymous' });
    const rows = (await client.query('select * from app.catalog_public where service_id = $1', [b.sSens])).rows;
    assert.equal(rows.length, 1, 'o servico sensivel ativo aparece na leitura publica');
    assert.deepEqual(Object.keys(rows[0]).sort(), [...PUBLIC_VIEW_COLUMNS].sort());
    assert.equal(
      Object.keys(rows[0]).some((k) => ['council_body', 'moderation_sensitive', 'seed_key', 'version'].includes(k)),
      false,
    );
  }));

// --- T-H018-05 (lado do banco): private.catalog_norm dá os mesmos resultados fixos do espelho TypeScript/JS.

test('T-H018-05 paridade: private.catalog_norm produz os pares fixos usados em catalog-seed.test.mjs', async () => {
  const pairs = [
    ['  Reformas   e  Construção ', 'reformas e construcao'],
    ['ÁGUA', 'agua'],
    ['Pé de Moleque', 'pe de moleque'],
    ['Ação', 'acao'],
    ['Lâmpada  LED', 'lampada led'],
    ['Ç', 'c'],
  ];
  for (const [input, expected] of pairs) {
    const res = await client.query('select private.catalog_norm($1) as n', [input]);
    assert.equal(res.rows[0].n, expected, input);
  }
});
