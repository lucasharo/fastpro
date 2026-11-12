// H-073 (#83) | Listagem dos casos (private.access_case_list) e validade da sessao (private.admin_session_expiry),
// migracao 20261111400000. Banco de desenvolvimento. A migracao e aplicada DENTRO da transacao de cada teste
// (nada persiste no banco compartilhado) e tudo e desfeito com rollback. Valores sinteticos (@example.test).
// Sem rede, sem envio de e-mail. Rodar sozinho: node --test packages/db/tests/admin-access-case-list.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261111400000_admin_access_case_list.sql'),
  'utf8',
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const MIN = 60 * 1000;
const at = (ms) => new Date(ms).toISOString();
const JUST = 'motivo sintetico com mais de vinte caracteres';

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. Nada fica no banco compartilhado. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

async function staffComPapel(role) {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [id, role],
  );
  return id;
}

/** Sessao aberta no instante ms (login com TOTP: totp_at = ms). Devolve o hash do segredo (como no banco). */
async function sessao(userId, ms) {
  const hash = sha(randomUUID());
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, hash, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return hash;
}

async function abrir(actor, hash, ms) {
  const caso = randomUUID();
  const conversa = randomUUID();
  await client.query('select private.access_case_open($1, $2, $3, $4, $5, $6)',
    [actor, hash, conversa, JUST, caso, at(ms)]);
  return { caso, conversa };
}

async function listar(actor, hash, ms) {
  const { rows } = await client.query(
    'select * from private.access_case_list($1, $2, $3)', [actor, hash, at(ms)]);
  return rows;
}

// T-L1 | o autor ve o proprio caso pendente, com so os campos de 60 §1
test('T-L1 autor ve o proprio caso pendente com os campos de 60 §1', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const sAbre = await sessao(abre, T0);
    const { caso, conversa } = await abrir(abre, sAbre, T0);
    const linhas = await listar(abre, sAbre, T0);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].out_id, caso);
    assert.equal(linhas[0].out_estado, 'pendente');
    assert.equal(linhas[0].out_scope_id, conversa);
    assert.equal(linhas[0].out_justificativa, JUST);
    assert.equal(linhas[0].out_expires_at, null);
    assert.deepEqual(Object.keys(linhas[0]).sort(),
      ['out_estado', 'out_expires_at', 'out_id', 'out_justificativa', 'out_scope_id']);
  }));

// T-L2 | quem tem case.authorize_sensitive ve o pendente de outra pessoa; quem nao tem, nao ve
test('T-L2 pendente de outro so aparece para quem autoriza', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const outro = await staffComPapel('suporte');
    const autoriza = await staffComPapel('superadmin');
    const sAbre = await sessao(abre, T0);
    const sOutro = await sessao(outro, T0);
    const sAutoriza = await sessao(autoriza, T0);
    const { caso } = await abrir(abre, sAbre, T0);
    const comAutorizacao = await listar(autoriza, sAutoriza, T0);
    assert.ok(comAutorizacao.some((r) => r.out_id === caso && r.out_estado === 'pendente'));
    const semAutorizacao = await listar(outro, sOutro, T0);
    assert.ok(!semAutorizacao.some((r) => r.out_id === caso));
  }));

// T-L3 | sessao invalida (hash que nao existe) = 42501, sem linhas
test('T-L3 sessao invalida e negada com 42501', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const sAbre = await sessao(abre, T0);
    await abrir(abre, sAbre, T0);
    let erro = null;
    try {
      await listar(abre, sha('hash-que-nao-existe'), T0);
    } catch (err) {
      erro = err;
    }
    assert.ok(erro, 'deveria recusar');
    assert.equal(erro.code, '42501');
  }));

// T-L4 | o estado acompanha a aprovacao (ativo dentro de 30 min) e o fechamento (fechado)
test('T-L4 estado: ativo na janela, vencido depois, fechado apos encerrar', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const aprova = await staffComPapel('superadmin');
    const sAbre = await sessao(abre, T0);
    const sAprova = await sessao(aprova, T0);
    const { caso } = await abrir(abre, sAbre, T0);
    await client.query('select private.access_case_approve($1, $2, $3, $4)', [aprova, sAprova, caso, at(T0 + MIN)]);

    const dentro = await listar(abre, sAbre, T0 + 2 * MIN);
    assert.equal(dentro.find((r) => r.out_id === caso).out_estado, 'ativo');
    const vencido = await listar(abre, sAbre, T0 + MIN + 30 * MIN);
    assert.equal(vencido.find((r) => r.out_id === caso).out_estado, 'vencido');

    await client.query('select private.access_case_close($1, $2, $3)', [abre, caso, at(T0 + 3 * MIN)]);
    const fechado = await listar(abre, sAbre, T0 + 4 * MIN);
    assert.equal(fechado.find((r) => r.out_id === caso).out_estado, 'fechado');
  }));

// T-L5 | validade da sessao: valor futuro para sessao valida; nulo para hash desconhecido
test('T-L5 admin_session_expiry devolve a validade da sessao valida e nulo para outra', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const sAbre = await sessao(abre, T0);
    const { rows } = await client.query(
      'select private.admin_session_expiry($1, $2) as expira', [sAbre, at(T0)]);
    const expira = new Date(rows[0].expira).getTime();
    assert.ok(expira > T0, 'validade no futuro');
    const outra = await client.query(
      'select private.admin_session_expiry($1, $2) as expira', [sha('nao-existe'), at(T0)]);
    assert.equal(outra.rows[0].expira, null);
  }));
