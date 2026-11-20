// Testes de banco do runbook H-114 (Issue #123, fatia S5): contencao do D-09 (incidente de dados pessoais),
// desenho 165 §4.5 e CA-09. A contencao grava a chave de degradacao da rota em ops.app_config (sem redeploy).
// Verificado aqui: gravar, ler, atualizar e recusar nome fora do padrao. NAO verificado aqui: a API ler
// a chave e responder 503 (lacuna L-5: nenhum leitor de degradacao existe em apps/api/src hoje).
// Transacao desfeita; chave com marcador de teste (degradacao.rota.h114_teste).
// Executar: node --test --test-concurrency=1 packages/db/tests/runbook-h114-d09.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

async function emTransacaoDesfeita(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

test('D-09 contencao: chave de degradacao de rota grava e le valor booleano', async () => {
  await emTransacaoDesfeita(async () => {
    const chave = 'degradacao.rota.h114_teste';
    await client.query(
      `insert into ops.app_config (key, value, updated_by) values ($1, 'true'::jsonb, 'h114-teste')`,
      [chave],
    );
    const lido = await client.query('select value, version from ops.app_config where key = $1', [chave]);
    assert.equal(lido.rows[0].value, true, 'chave ativa devolve true');
    assert.equal(lido.rows[0].version, 1);
  });
});

test('D-09 contencao: desligar a chave altera o valor e avanca a versao (sem redeploy)', async () => {
  await emTransacaoDesfeita(async () => {
    const chave = 'degradacao.rota.h114_teste';
    await client.query(
      `insert into ops.app_config (key, value, updated_by) values ($1, 'true'::jsonb, 'h114-teste')`,
      [chave],
    );
    await client.query(
      `update ops.app_config set value = 'false'::jsonb, version = version + 1, updated_at = now()
        where key = $1`,
      [chave],
    );
    const lido = await client.query('select value, version from ops.app_config where key = $1', [chave]);
    assert.equal(lido.rows[0].value, false);
    assert.equal(lido.rows[0].version, 2);
  });
});

test('D-09 contencao: nome de chave fora do padrao (espaco, maiuscula) e recusado', async () => {
  await emTransacaoDesfeita(async () => {
    for (const ruim of ['Degradacao Rota', 'degradacao-rota-h114']) {
      await client.query('savepoint sp_chave');
      await assert.rejects(
        client.query(`insert into ops.app_config (key, value) values ($1, 'true'::jsonb)`, [ruim]),
        (e) => {
          assert.equal(e.code, '23514', `esperado check_violation para ${ruim}`);
          return true;
        },
      );
      await client.query('rollback to savepoint sp_chave');
    }
  });
});
