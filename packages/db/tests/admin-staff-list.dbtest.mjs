// H-103 (Issue 112) | Listagem da equipe (private.admin_staff_list), migracao 20261111410000 (T-H103-09).
// Banco de desenvolvimento. A migracao e aplicada DENTRO da transacao de cada teste (nada persiste no
// banco compartilhado) e tudo e desfeito com rollback. Valores sinteticos (@example.test).
// NAO executado nesta etapa: rodar so quando o usuario liberar. Rodar sozinho:
//   node --test packages/db/tests/admin-staff-list.dbtest.mjs
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
  join(REPO_ROOT, 'supabase', 'migrations', '20261111410000_admin_staff_list.sql'),
  'utf8',
);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();

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

async function listar(actor, hash, ms) {
  const { rows } = await client.query(
    'select * from private.admin_staff_list($1, $2, $3)', [actor, hash, at(ms)]);
  return rows;
}

async function erroDe(promessa) {
  try {
    await promessa;
  } catch (err) {
    return err;
  }
  return null;
}

// T-S1 | superadmin ve a equipe com so as colunas da projecao (sem e-mail, hash ou segredo)
test('T-S1 superadmin lista a equipe com a projecao fechada', () =>
  tx(async () => {
    const admin = await staffComPapel('superadmin');
    const outro = await staffComPapel('auditor');
    const sAdmin = await sessao(admin, T0);
    const linhas = await listar(admin, sAdmin, T0);
    const ids = linhas.map((r) => r.out_user_id);
    assert.ok(ids.includes(admin), 'o proprio superadmin aparece');
    assert.ok(ids.includes(outro), 'o auditor aparece');
    const linhaAuditor = linhas.find((r) => r.out_user_id === outro);
    assert.equal(linhaAuditor.out_status, 'ativo');
    assert.equal(linhaAuditor.out_mfa_ativo, true);
    assert.deepEqual(linhaAuditor.out_papeis, ['auditor']);
    assert.deepEqual(Object.keys(linhaAuditor).sort(),
      ['out_created_at', 'out_mfa_ativo', 'out_papeis', 'out_status', 'out_user_id']);
  }));

// T-S2 | papel sem admin.role.manage = 42501, sem linhas
test('T-S2 auditor e negado com 42501', () =>
  tx(async () => {
    const auditor = await staffComPapel('auditor');
    const sAuditor = await sessao(auditor, T0);
    const erro = await erroDe(listar(auditor, sAuditor, T0));
    assert.ok(erro, 'deveria recusar');
    assert.equal(erro.code, '42501');
  }));

// T-S3 | sessao invalida (hash que nao existe) = 42501
test('T-S3 sessao invalida e negada com 42501', () =>
  tx(async () => {
    const admin = await staffComPapel('superadmin');
    await sessao(admin, T0);
    const erro = await erroDe(listar(admin, sha('hash-que-nao-existe'), T0));
    assert.ok(erro, 'deveria recusar');
    assert.equal(erro.code, '42501');
  }));

// T-S4 | papel revogado nao aparece em out_papeis (linha nunca apagada, so revogada)
test('T-S4 papel revogado sai de out_papeis', () =>
  tx(async () => {
    const admin = await staffComPapel('superadmin');
    const alvo = await staffComPapel('suporte');
    await client.query(
      `update app.admin_user_role set revoked_at = now(), revoked_by = $1
        where user_id = $2 and role_code = 'suporte'`,
      [admin, alvo],
    );
    const sAdmin = await sessao(admin, T0);
    const linha = (await listar(admin, sAdmin, T0)).find((r) => r.out_user_id === alvo);
    assert.deepEqual(linha.out_papeis, []);
  }));

// T-S5 | privilegio de execucao: so app_system; app_api e demais papeis nao executam
test('T-S5 apenas app_system executa a funcao de listagem', () =>
  tx(async () => {
    const assinatura = 'private.admin_staff_list(uuid, text, timestamptz)';
    const { rows } = await client.query(
      `select has_function_privilege('app_system', $1, 'execute') as sistema,
              has_function_privilege('app_api', $1, 'execute') as api,
              has_function_privilege('anon', $1, 'execute') as anonimo,
              has_function_privilege('authenticated', $1, 'execute') as autenticado`,
      [assinatura],
    );
    assert.equal(rows[0].sistema, true);
    assert.equal(rows[0].api, false);
    assert.equal(rows[0].anonimo, false);
    assert.equal(rows[0].autenticado, false);
  }));
