// H-107 (Issue 116) | Testes de banco da gestao do catalogo (docs/factory/77-REFINO-H107.md CA-03, CA-05, CA-06,
// CA-08 e permissao de leitura do historico; desenho 81-DESENHO-H107.md §2 e §6).
// Banco de desenvolvimento COMPARTILHADO: cada caso roda dentro de transacao com ROLLBACK (nunca COMMIT).
// A migracao 20261111450000 (catalog_revision_list) ainda NAO esta aplicada no banco de desenvolvimento: o
// teste T-H107-05 a executa DENTRO da transacao, para provar a permissao, e o rollback a desfaz.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/catalog-h107.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIGRACAO_HISTORICO = new URL('../../../supabase/migrations/20261111450000_catalog_revision_list.sql', import.meta.url);

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// --- Utilitarios (mesmo contrato de catalog-service.dbtest.mjs) -------------------------------------

/** Executa fn dentro de transacao que sempre termina em ROLLBACK. */
async function inTx(fn) {
  await client.query('begin');
  try {
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

/** Cria, como dono, um grupo ativo com dois servicos ativos (base para a busca e a lista publica). */
async function criarGrupoAtivo(nome, posicao) {
  const id = randomUUID();
  await client.query(
    `insert into app.service_group (id, name, position, active) values ($1, $2, $3, true)`,
    [id, nome, posicao],
  );
  await client.query(
    `insert into app.service (group_id, name, modality, regulated, active)
     values ($1, $2, 'online', false, true), ($1, $3, 'presencial', false, true)`,
    [id, `${nome} servico um`, `${nome} servico dois`],
  );
  return id;
}

/** Versao atual de uma linha do catalogo, lida como dono (o papel de API nao tem SELECT nas tabelas). */
async function versaoDe(tabela, id) {
  await asOwner();
  const { rows } = await client.query(`select version from app.${tabela} where id = $1`, [id]);
  await client.query('set local role app_api');
  return rows[0].version;
}

// --- T-H107-01 (CA-03): criar grupo e servico -------------------------------------------------------

test('T-H107-01 CA-03 administrador aal2 cria grupo e servico; aparece na lista admin e, ativo, na busca publica', () =>
  inTx(async () => {
    await asAppApi(ADMIN);
    const gid = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo CA03', position: 810, active: false }),
      ])
    ).rows[0].id;
    const sid = (
      await client.query('select private.catalog_service_save(null, null, $1::jsonb) as id', [
        // Sem "active" o cadastro nasce inativo (padrao do banco): publicar exige marcar Ativo.
        JSON.stringify({ name: 'Encanador ca03', group_id: gid, modality: 'ambos', regulated: true, active: true }),
      ])
    ).rows[0].id;
    await client.query('select private.catalog_group_save($1, 1, $2::jsonb)', [gid, '{"active":true}']);

    const lista = (await client.query('select private.catalog_admin_list() as j')).rows[0].j;
    const s = lista.services.find((x) => x.id === sid);
    assert.ok(s, 'o servico criado deveria estar na lista administrativa');
    assert.equal(s.name, 'Encanador ca03');
    assert.equal(s.group_id, gid);
    assert.equal(s.modality, 'ambos');
    assert.equal(s.regulated, true);
    assert.equal(s.active, true);

    await asAppApi({ type: 'anonymous' });
    const publica = (await client.query('select service_id from private.catalog_public_list()')).rows;
    assert.ok(publica.some((r) => r.service_id === sid), 'servico ativo de grupo ativo deveria estar na lista publica');
    const busca = (await client.query('select service_id from private.catalog_search($1)', ['encanador ca03'])).rows;
    assert.ok(busca.some((r) => r.service_id === sid), 'servico ativo deveria aparecer na busca');
  }));

test('T-H107-01b CA-03 cadastro sem nome ou sem grupo e recusado (CT004) com o campo na mensagem', () =>
  inTx(async () => {
    const gid = await criarGrupoAtivo('Grupo CA03 validacao', 811);
    await asAppApi(ADMIN);
    const semNome = await expectError(
      'select private.catalog_service_save(null, null, $1::jsonb)',
      [JSON.stringify({ group_id: gid, modality: 'online', regulated: false })],
      'CT004',
    );
    assert.match(semNome.message, /name/, 'a mensagem deve apontar o campo nome');
    const semGrupo = await expectError(
      'select private.catalog_service_save(null, null, $1::jsonb)',
      [JSON.stringify({ name: 'Servico sem grupo', modality: 'online', regulated: false })],
      'CT004',
    );
    assert.match(semGrupo.message, /group_id/, 'a mensagem deve apontar o campo grupo');
    await asOwner();
    const n = (await client.query("select count(*)::int as n from app.service where name = 'Servico sem grupo'")).rows[0].n;
    assert.equal(n, 0, 'nada deve ser gravado no cadastro recusado');
  }));

// --- T-H107-02 (CA-05): desativar e reativar --------------------------------------------------------

test('T-H107-02 CA-05 desativar tira o servico da busca e da lista publica, o registro fica; reativar devolve', () =>
  inTx(async () => {
    const gid = await criarGrupoAtivo('Grupo CA05', 820);
    await asAppApi(ADMIN);
    const sid = (
      await client.query('select private.catalog_service_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Hidraulica ca05', group_id: gid, modality: 'presencial', regulated: false, active: true }),
      ])
    ).rows[0].id;

    await asAppApi({ type: 'anonymous' });
    const antes = (await client.query('select service_id from private.catalog_search($1)', ['hidraulica ca05'])).rows;
    assert.ok(antes.some((r) => r.service_id === sid), 'antes de desativar, deveria aparecer na busca');

    await asAppApi(ADMIN);
    await client.query('select private.catalog_service_save($1, $2, $3::jsonb)', [
      sid,
      await versaoDe('service', sid),
      '{"active":false}',
    ]);
    await asAppApi({ type: 'anonymous' });
    const depois = (await client.query('select service_id from private.catalog_search($1)', ['hidraulica ca05'])).rows;
    assert.equal(depois.length, 0, 'desativado nao pode aparecer no autocomplete');
    const publica = (await client.query('select service_id from private.catalog_public_list()')).rows;
    assert.ok(!publica.some((r) => r.service_id === sid), 'desativado nao pode aparecer na lista publica');

    await asOwner();
    const reg = (await client.query('select active from app.service where id = $1', [sid])).rows;
    assert.equal(reg.length, 1, 'o registro deve continuar no banco');
    assert.equal(reg[0].active, false);

    await asAppApi(ADMIN);
    await client.query('select private.catalog_service_save($1, $2, $3::jsonb)', [
      sid,
      await versaoDe('service', sid),
      '{"active":true}',
    ]);
    await asAppApi({ type: 'anonymous' });
    const reativado = (await client.query('select service_id from private.catalog_search($1)', ['hidraulica ca05'])).rows;
    assert.ok(reativado.some((r) => r.service_id === sid), 'reativado deve voltar a aparecer na busca');
  }));

// --- T-H107-03 (CA-06): mudanca de modalidade com antes e depois na auditoria -----------------------

test('T-H107-03 CA-06 presencial para online: grava o novo valor; antes e depois na revisao e na auditoria', () =>
  inTx(async () => {
    const gid = await criarGrupoAtivo('Grupo CA06', 830);
    await asAppApi(ADMIN);
    const sid = (
      await client.query('select private.catalog_service_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Pintor ca06', group_id: gid, modality: 'presencial', regulated: false }),
      ])
    ).rows[0].id;
    await client.query('select private.catalog_service_save($1, $2, $3::jsonb)', [
      sid,
      await versaoDe('service', sid),
      '{"modality":"online"}',
    ]);

    await asOwner();
    const linha = (await client.query('select modality, version from app.service where id = $1', [sid])).rows[0];
    assert.equal(linha.modality, 'online', 'a nova modalidade deve ser gravada');
    assert.equal(linha.version, 2);

    const evento = (
      await client.query(
        `select action, object_id, before_state, after_state
           from audit.audit_event where object_id = $1 order by seq desc limit 1`,
        [sid],
      )
    ).rows[0];
    assert.equal(evento.action, 'catalog.service.changed');
    assert.equal(evento.before_state.modality, 'presencial', 'valor anterior na auditoria');
    assert.equal(evento.after_state.modality, 'online', 'valor posterior na auditoria');

    const rev = (
      await client.query(
        `select version, before, after from app.catalog_revision
          where entity = 'service' and entity_id = $1 order by version desc limit 1`,
        [sid],
      )
    ).rows[0];
    assert.equal(rev.version, 2);
    assert.equal(rev.before.modality, 'presencial');
    assert.equal(rev.after.modality, 'online');
  }));

// --- T-H107-04 (CA-08): ordem da navegacao publica -----------------------------------------------

test('T-H107-04 CA-08 troca de posicao de dois grupos muda a ordem da lista publica (leitura anonima)', () =>
  inTx(async () => {
    const gA = await criarGrupoAtivo('Grupo CA08 A', 901);
    const gC = await criarGrupoAtivo('Grupo CA08 C', 801);
    const ordem = async () =>
      (await client.query('select group_id from private.catalog_public_list()')).rows
        .map((r) => r.group_id)
        .filter((g, i, todos) => todos.indexOf(g) === i)
        .filter((g) => g === gA || g === gC);

    await asAppApi({ type: 'anonymous' });
    assert.deepEqual(await ordem(), [gC, gA], 'antes da troca, o grupo na posicao 801 vem primeiro');

    // Troca de duas posicoes: duas chamadas, cada uma com sua versao e auditoria (81 §2).
    await asAppApi(ADMIN);
    await client.query('select private.catalog_group_save($1, $2, $3::jsonb)', [
      gA,
      await versaoDe('service_group', gA),
      '{"position":801}',
    ]);
    await client.query('select private.catalog_group_save($1, $2, $3::jsonb)', [
      gC,
      await versaoDe('service_group', gC),
      '{"position":901}',
    ]);

    await asAppApi({ type: 'anonymous' });
    assert.deepEqual(await ordem(), [gA, gC], 'depois da troca, a nova ordem deve aparecer sem login');
  }));

// --- T-H107-05 (permissao): historico de revisoes exige catalog.manage e aal2 -----------------------

test('T-H107-05 catalog_revision_list: so administrador aal2 com catalog.manage le o historico; anon e authenticated nao executam', () =>
  inTx(async () => {
    // Aplica a migracao DENTRO da transacao (ainda pendente no banco de desenvolvimento); o rollback a desfaz.
    await client.query(readFileSync(MIGRACAO_HISTORICO, 'utf8'));

    await asAppApi(ADMIN);
    const gid = (
      await client.query('select private.catalog_group_save(null, null, $1::jsonb) as id', [
        JSON.stringify({ name: 'Grupo historico', position: 840, active: false }),
      ])
    ).rows[0].id;
    await client.query('select private.catalog_group_save($1, 1, $2::jsonb)', [gid, '{"name":"Grupo historico 2"}']);

    const historico = (await client.query('select private.catalog_revision_list($1, $2) as j', ['group', gid])).rows[0].j;
    assert.deepEqual(
      historico.map((r) => r.version),
      [2, 1],
      'o historico deve ter as duas versoes, mais nova primeiro',
    );
    assert.equal(historico[0].before.name, 'Grupo historico');
    assert.equal(historico[0].after.name, 'Grupo historico 2');
    assert.ok(historico[0].actor, 'o ator deve vir de updated_by_ref');

    const negado = [
      { type: 'admin', id: randomUUID(), aal: 'aal1', perms: 'catalog.manage' },
      { type: 'admin', id: randomUUID(), aal: 'aal2', perms: '' },
      { type: 'admin', id: randomUUID(), aal: 'aal2', perms: 'outra.permissao' },
      { type: 'customer', id: randomUUID(), aal: 'aal2', perms: 'catalog.manage' },
      { type: 'anonymous' },
    ];
    for (const principal of negado) {
      await asAppApi(principal);
      await expectError('select private.catalog_revision_list($1, $2)', ['group', gid], '42501');
    }

    await asOwner();
    const priv = (
      await client.query(
        `select has_function_privilege('anon', 'private.catalog_revision_list(text,uuid)', 'execute') as anon,
                has_function_privilege('authenticated', 'private.catalog_revision_list(text,uuid)', 'execute') as auth,
                has_function_privilege('public', 'private.catalog_revision_list(text,uuid)', 'execute') as publico,
                has_function_privilege('app_api', 'private.catalog_revision_list(text,uuid)', 'execute') as api`,
      )
    ).rows[0];
    assert.deepEqual(priv, { anon: false, auth: false, publico: false, api: true });
  }));
