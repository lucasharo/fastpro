// Issue 156 (F6): limite de taxa da busca de servico executavel pelo login da API (app_api).
// Cada caso roda numa transacao que termina em ROLLBACK (nada e gravado no banco de DEV).
// Executar: node --test --test-concurrency=1 packages/db/tests/catalog-rate-limit.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

const CHECK = 'select out_ok, out_retry_after from private.catalog_rate_check($1, $2, $3, $4, $5::timestamptz)';
const HIT = 'select private.catalog_rate_hit($1, $2, $3::timestamptz)';
const CHAVE = `catalog_search:${'f6'.repeat(32)}`;

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/** Executa os passos como app_api numa transacao que termina em rollback. Devolve as linhas de cada passo. */
async function como(passos) {
  await client.query('begin');
  try {
    await client.query('grant app_api to current_user');
    await client.query('set local role app_api');
    const saida = [];
    for (const [sql, params = []] of passos) saida.push((await client.query(sql, params)).rows);
    return saida;
  } finally {
    await client.query('rollback');
  }
}

test('F6-01 app_api checa e conta o limite pela funcao privada e o contador passa a bloquear', async () => {
  const agora = new Date().toISOString();
  const [antes, , depois] = await como([
    [CHECK, [CHAVE, 60, 10, 1, agora]],
    [HIT, [CHAVE, 10, agora]],
    [CHECK, [CHAVE, 60, 10, 1, agora]],
  ]);
  assert.equal(antes[0].out_ok, true, 'antes de contar, a busca e aceita');
  assert.equal(depois[0].out_ok, false, 'depois de contar no limite 1, a busca e barrada');
  assert.ok(depois[0].out_retry_after >= 1, 'a espera de nova tentativa e informada');
});

test('F6-02 app_api nao tem acesso direto a private.rl_check nem ao esquema ops', async () => {
  await assert.rejects(
    como([['select * from private.rl_check($1, 60, 10, 90, now())', [CHAVE]]]),
    (erro) => erro.code === '42501',
  );
  await assert.rejects(
    como([['select 1 from ops.rate_counter limit 1', []]]),
    (erro) => erro.code === '42501',
  );
});

test('F6-03 as funcoes recusam chave fora do prefixo catalog_search:', async () => {
  await assert.rejects(
    como([['select private.catalog_rate_hit($1, 10, now())', ['login:qualquer']]]),
    (erro) => erro.code === '22023',
  );
});

test('F6-04 PUBLIC, anon e authenticated sem EXECUTE nas duas funcoes', async () => {
  const { rows } = await client.query(`
    select
      (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
        where p.pronamespace = 'private'::regnamespace and p.proname like 'catalog_rate_%'
          and a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
      has_function_privilege('anon', 'private.catalog_rate_check(text,integer,integer,integer,timestamptz)', 'EXECUTE') as anon,
      has_function_privilege('authenticated', 'private.catalog_rate_hit(text,integer,timestamptz)', 'EXECUTE') as autenticado`);
  assert.deepEqual(rows[0], { publico: 0, anon: false, autenticado: false });
});
