// H-092 | Desfazer a migracao 20261111120000 dentro de uma transacao que e sempre desfeita (rollback).
// Prova que o arquivo de rollback executa sem erro e remove o pipeline, e que o estado volta depois.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';
import { guard } from './fixtures/no-network.mjs';

after(() => {
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante o teste de rollback');
});

globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes (H-092)');
};

const DOWN = join(
  REPO_ROOT,
  'supabase',
  'rollbacks',
  '20261111120000_notifications_create_pipeline.down.sql',
);
let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// Remove apenas as linhas begin/commit do arquivo; o restante roda dentro da nossa transacao.
const body = readFileSync(DOWN, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l))
  .join('\n');

test('rollback 20261111120000: executa, remove o pipeline e tira a migracao do registro (dentro de transacao desfeita)', async () => {
  const antes = (await client.query("select to_regclass('ops.email_outbox') is not null as ok"))
    .rows[0].ok;
  assert.equal(antes, true, 'pipeline deve existir antes do rollback');
  await client.query('begin');
  try {
    await client.query(body);
    const dentro = (
      await client.query(
        "select to_regclass('ops.email_outbox') is null as sem_tabela, " +
          "(select count(*)::int from ops.schema_migration where version = '20261111120000') as registro",
      )
    ).rows[0];
    assert.equal(dentro.sem_tabela, true);
    assert.equal(dentro.registro, 0);
  } finally {
    await client.query('rollback');
  }
  const depois = (
    await client.query(
      "select to_regclass('ops.email_outbox') is not null as tabela, " +
        "(select count(*)::int from ops.schema_migration where version = '20261111120000') as registro",
    )
  ).rows[0];
  assert.equal(depois.tabela, true, 'rollback de teste nao pode apagar nada');
  assert.equal(depois.registro, 1);
});
