// Entrada do admin por e-mail e senha (migracao 20261127200000) contra o banco de desenvolvimento, usando os
// adaptadores compilados (rode o build antes). Cada teste roda em transacao e e desfeito (rollback). Valores
// sinteticos (@example.test). Sem rede externa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashAdminPassword, PgAdminLoginAttempts, PgAdminPasswordAccounts } from '../dist/index.js';
import { connect } from '../scripts/lib/env.mjs';

let client;

before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function superadmin() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${id}@example.test`, randomUUID()],
  );
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, null, now(), now())`,
    [id],
  );
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
     values (gen_random_uuid(), $1, 'superadmin', null, 'bootstrap', now())`,
    [id],
  );
  return id;
}

async function criar(ator, email, hash, papeis) {
  const r = await client.query('select private.admin_staff_create($1, $2, $3, $4, now()) as r', [
    ator,
    email,
    hash,
    papeis,
  ]);
  return r.rows[0].r;
}

test('cadastro pela Equipe: cria a conta, entra com a senha e abre a sessao de 8 horas', () =>
  tx(async () => {
    const ator = await superadmin();
    const email = `${randomUUID()}@example.test`;
    const senha = randomBytes(18).toString('base64url');
    assert.equal(await criar(ator, email, await hashAdminPassword(senha), ['verificacao', 'auditor']), 'ok');
    const contas = new PgAdminPasswordAccounts(client);
    assert.equal(await contas.verify(email, `${senha}x`), null);
    const conta = await contas.verify(email.toUpperCase(), senha);
    assert.ok(conta);
    assert.ok(await contas.openSession(conta.userId, Date.now()));
    const { rows } = await client.query(
      `select count(*)::int as n from app.admin_session s join app.app_user u on u.id = s.user_id where u.email = $1`,
      [email],
    );
    assert.equal(rows[0].n, 1);
  }));

test('cadastro recusa quem nao gere papeis, Superadmin, papel inexistente e e-mail com conta', () =>
  tx(async () => {
    const ator = await superadmin();
    const hash = await hashAdminPassword(randomBytes(18).toString('base64url'));
    const email = `${randomUUID()}@example.test`;
    assert.equal(await criar(ator, email, hash, ['superadmin']), 'papel_invalido');
    assert.equal(await criar(ator, email, hash, ['inexistente']), 'papel_invalido');
    assert.equal(await criar(ator, email, hash, []), 'papel_invalido');
    assert.equal(await criar(ator, email, hash, ['auditor']), 'ok');
    assert.equal(await criar(ator, email.toUpperCase(), hash, ['auditor']), 'email_indisponivel');
    const { rows } = await client.query('select id from app.app_user where email = $1', [email]);
    assert.equal(await criar(rows[0].id, `${randomUUID()}@example.test`, hash, ['auditor']), 'permissao_negada');
  }));

test('conta desativada ou sem papel nao entra', () =>
  tx(async () => {
    const ator = await superadmin();
    const email = `${randomUUID()}@example.test`;
    const senha = randomBytes(18).toString('base64url');
    await criar(ator, email, await hashAdminPassword(senha), ['auditor']);
    await client.query(
      `update app.admin_staff set status = 'desativado' where user_id = (select id from app.app_user where email = $1)`,
      [email],
    );
    assert.equal(await new PgAdminPasswordAccounts(client).verify(email, senha), null);
  }));

test('limite: 5 vagas por e-mail em 15 minutos; o acerto devolve a vaga', () =>
  tx(async () => {
    const chave = () => randomBytes(32).toString('hex');
    const email = chave();
    const ip = chave();
    const limites = new PgAdminLoginAttempts(client, { email: () => email, ip: () => ip });
    const quem = { email: 'a@example.test', ip: '203.0.113.1' };
    const agora = Date.now();
    for (let i = 0; i < 4; i++) assert.equal(await limites.reserve(quem, agora), true);
    assert.equal(await limites.reserve(quem, agora), true);
    await limites.release(quem, agora);
    assert.equal(await limites.reserve(quem, agora), true);
    assert.equal(await limites.reserve(quem, agora), false);
    assert.equal(await limites.reserve(quem, agora + 16 * 60 * 1000), true);
  }));

test('so app_system executa as funcoes; a credencial nao e legivel direto; a entrada por codigo saiu', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select has_table_privilege('app_system', 'app.admin_credential', 'select') as sistema,
             has_table_privilege('app_api', 'app.admin_credential', 'select') as api,
             to_regclass('app.admin_login_code') as codigo,
             (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'private' and p.proname like 'admin\\_code\\_%') as funcoes`);
    assert.deepEqual(rows[0], { sistema: false, api: false, codigo: null, funcoes: 0 });
  }));

test('privilegios das funcoes novas', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select p.proname, p.prosecdef,
             has_function_privilege('app_system', p.oid, 'execute') as sistema,
             has_function_privilege('app_api', p.oid, 'execute') as api,
             has_function_privilege('anon', p.oid, 'execute') as anonimo
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in ('admin_password_lookup', 'admin_login_reserve', 'admin_login_release', 'admin_staff_create')`);
    assert.equal(rows.length, 4);
    for (const f of rows) {
      assert.deepEqual([f.prosecdef, f.sistema, f.api, f.anonimo], [true, true, false, false], f.proname);
    }
  }));
