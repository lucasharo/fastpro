// Issue 57 (H-044) | Reversao da migracao 20261113270000 em transacao desfeita (docs/factory/135-DESENHO-H044.md, §6, T-22).
// Aplica o arquivo de desfazer e depois recria com o arquivo da migracao, dentro de UMA transacao que e sempre
// desfeita (rollback). Os comandos de inicio e fim de transacao dos arquivos sao retirados para que a prova
// fique dentro da transacao da prova. Nada e gravado de forma definitiva. Sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const UP = new URL('../../../supabase/migrations/20261113270000_billing_create_trial_activation.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261113270000_billing_create_trial_activation.down.sql', import.meta.url);

const semControleDeTransacao = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((linha) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(linha))
    .join('\n');

async function presentes(client) {
  const { rows } = await client.query(
    `select to_regprocedure('private.trial_activate(uuid,text,timestamptz,uuid)') is not null as ativa,
            to_regprocedure('private.identity_id_from_document_hmac(text)') is not null as derivacao`,
  );
  return [rows[0].ativa, rows[0].derivacao];
}

test('T-22 reversao: desfazer remove as duas funcoes; reaplicar a migracao as recria (transacao desfeita)', async () => {
  const client = await connect();
  try {
    await client.query('begin');
    assert.deepEqual(await presentes(client), [true, true], 'estado inicial: funcoes presentes');

    await client.query(semControleDeTransacao(readFileSync(DOWN, 'utf8')));
    assert.deepEqual(await presentes(client), [false, false], 'depois de desfazer: funcoes removidas');

    await client.query(semControleDeTransacao(readFileSync(UP, 'utf8')));
    assert.deepEqual(await presentes(client), [true, true], 'depois de reaplicar: funcoes de volta');

    const { rows } = await client.query(
      `select count(*)::int as n from audit.action_catalog
        where action in ('billing.trial.activated', 'billing.trial.denied')`,
    );
    assert.equal(rows[0].n, 2, 'catalogo de auditoria com as duas acoes');
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
});
