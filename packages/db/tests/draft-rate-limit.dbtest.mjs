// Issue 156 (H-025): limite de taxa do rascunho sem conta executavel pelo login da API (app_api).
// Cada caso roda numa transacao que termina em ROLLBACK (nada e gravado no banco de DEV).
// Executar: node --test --test-concurrency=1 packages/db/tests/draft-rate-limit.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

const CHECK = 'select out_ok, out_retry_after from private.draft_rate_check($1, $2, $3, $4, $5::timestamptz)';
const HIT = 'select private.draft_rate_hit($1, $2, $3::timestamptz)';
/** Chave ja em sha256 hex (64 caracteres), como PgDraftRate.chave envia. */
const CHAVE = 'd6'.repeat(32);

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

test('R-01 app_api checa e conta o limite do rascunho pela funcao privada e o contador passa a bloquear', async () => {
  const agora = new Date().toISOString();
  const [antes, , depois] = await como([
    [CHECK, [CHAVE, 60, 10, 1, agora]],
    [HIT, [CHAVE, 10, agora]],
    [CHECK, [CHAVE, 60, 10, 1, agora]],
  ]);
  assert.equal(antes[0].out_ok, true, 'antes de contar, o rascunho e aceito');
  assert.equal(depois[0].out_ok, false, 'depois de contar no limite 1, o rascunho e barrado');
  assert.ok(depois[0].out_retry_after >= 1, 'a espera de nova tentativa e informada');
});

test('R-02 app_api nao tem acesso direto a private.rl_check, private.rl_hit nem ao esquema ops', async () => {
  await assert.rejects(
    como([['select * from private.rl_check($1, 60, 10, 90, now())', [CHAVE]]]),
    (erro) => erro.code === '42501',
  );
  await assert.rejects(
    como([['select private.rl_hit($1, 10, now())', [CHAVE]]]),
    (erro) => erro.code === '42501',
  );
  await assert.rejects(
    como([['select 1 from ops.rate_counter limit 1', []]]),
    (erro) => erro.code === '42501',
  );
});

test('R-03 as funcoes do rascunho recusam chave que nao seja hex de 64 caracteres', async () => {
  await assert.rejects(
    como([['select * from private.draft_rate_check($1, 60, 10, 5, now())', ['draft:login:qualquer']]]),
    (erro) => erro.code === '22023',
  );
  await assert.rejects(
    como([['select private.draft_rate_hit($1, 10, now())', ['AB'.repeat(32)]]]),
    (erro) => erro.code === '22023',
  );
});
