// Issue 120 (H-111) | Valores de app.app_user.status no banco (147-DESENHO-H111 §3.3, §7: T-DB-01 e T-DB-18 na parte
// de CHECK e de guards negativos). Banco de desenvolvimento. Cada teste roda em transacao e e desfeito (rollback).
// Valores sinteticos (@example.test). Sem rede, sem e-mail.
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

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro (ou falha o teste). */
async function erroDe(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  assert.fail(`deveria ter falhado: ${sql.slice(0, 80)}`);
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

test('T-DB-01 | CHECK aceita ativo, bloqueado e em_eliminacao', () =>
  tx(async () => {
    const id = await usuario();
    for (const status of ['bloqueado', 'em_eliminacao', 'ativo']) {
      await client.query('update app.app_user set status = $2 where id = $1', [id, status]);
      const { rows } = await client.query('select status from app.app_user where id = $1', [id]);
      assert.equal(rows[0].status, status);
    }
  }));

test('T-DB-01 | CHECK aceita anonimizado quando ha marcador de expurgo (anonymized_at e retention_state expurgado)', () =>
  tx(async () => {
    const id = await usuario();
    await client.query(
      `update app.app_user set status = 'anonimizado', anonymized_at = now(), retention_state = 'expurgado'
        where id = $1`,
      [id],
    );
    const { rows } = await client.query('select status, retention_state from app.app_user where id = $1', [id]);
    assert.deepEqual(rows[0], { status: 'anonimizado', retention_state: 'expurgado' });
  }));

test('T-DB-01 | CHECK recusa valor fora da lista de status', () =>
  tx(async () => {
    const id = await usuario();
    const err = await erroDe("update app.app_user set status = 'apagado' where id = $1", [id]);
    assert.equal(err.code, '23514');
    assert.equal(err.constraint, 'app_user_status_check');
  }));

test('coerencia | status anonimizado sem anonymized_at e recusado pela constraint nova', () =>
  tx(async () => {
    const id = await usuario();
    const err = await erroDe("update app.app_user set status = 'anonimizado' where id = $1", [id]);
    assert.equal(err.code, '23514');
    assert.equal(err.constraint, 'app_user_status_anonimizado_consistente');
  }));

test('coerencia | anonymized_at sem retention_state expurgado e recusado pela constraint nova (a existente aceita NULL)', () =>
  tx(async () => {
    const id = await usuario();
    const err = await erroDe(
      "update app.app_user set status = 'anonimizado', anonymized_at = now() where id = $1",
      [id],
    );
    assert.equal(err.code, '23514');
    assert.equal(err.constraint, 'app_user_status_anonimizado_consistente');
  }));

test('coerencia | retention_state expurgado sem anonymized_at e recusado quando o status e anonimizado', () =>
  tx(async () => {
    const id = await usuario();
    const err = await erroDe(
      "update app.app_user set status = 'anonimizado', retention_state = 'expurgado' where id = $1",
      [id],
    );
    assert.equal(err.code, '23514');
    assert.equal(err.constraint, 'app_user_status_anonimizado_consistente');
  }));

test('catalogo | as duas constraints existem com as definicoes desta fatia', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'app.app_user'::regclass and conname in ('app_user_status_check', 'app_user_status_anonimizado_consistente')
        order by conname`,
    );
    assert.equal(rows.length, 2);
    const porNome = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
    for (const valor of ['ativo', 'bloqueado', 'em_eliminacao', 'anonimizado']) {
      assert.ok(porNome.app_user_status_check.includes(`'${valor}'`), `valor ${valor} no CHECK`);
    }
    assert.ok(porNome.app_user_status_anonimizado_consistente.includes('anonymized_at IS NOT NULL'));
  }));

test('T-DB-18 | nenhuma funcao do banco testa bloqueado por negacao (novos status ficariam como ativos)', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('app', 'private', 'ops')
          and (p.prosrc ~ $1 or p.prosrc ~ $2)`,
      ["status\\s*(<>|!=)\\s*'bloqueado'", "not\\s+in\\s*\\(\\s*'bloqueado'"],
    );
    assert.deepEqual(rows.map((r) => r.proname), []);
  }));
