// Teste de banco do exercicio integrado do runbook H-114 (Issue #123, fatia S8; desenho 165 §5 CA-18).
// Cada procedimento do runbook que tem exercicio grava um evento em audit.audit_event com ator, papel,
// motivo e instante, pela acao runbook.exercicio.executado (migracao 20261120420000, so catalogo).
// Transacao desfeita: nada persiste. Ator sintetico admin:h114 (formato aceito por audit_event).
// Executar: node --test --test-concurrency=1 packages/db/tests/runbook-h114-exercicio.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const PROCEDIMENTOS = ['D-04', 'D-05', 'D-06', 'D-07', 'D-09', 'R-MP', 'R-EMAIL', 'R-AUTH'];

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

function gravar(procedimento, motivo = `exercicio_h114_${procedimento.replace('-', '').toLowerCase()}`) {
  return client.query(
    `select private.audit_append('admin:h114', 'admin', 'runbook.exercicio.executado',
       'runbook_exercicio', $1::uuid, '{}'::jsonb,
       jsonb_build_object('status', 'executado', 'procedimento', $2::text), $3, null) as id`,
    [randomUUID(), procedimento, motivo],
  );
}

test('CA-18: a acao de exercicio esta no catalogo, exige motivo e esta ativa', async () => {
  const { rows } = await client.query(
    `select reason_required, active from audit.action_catalog
      where action = 'runbook.exercicio.executado' and object_type = 'runbook_exercicio'`,
  );
  assert.equal(rows.length, 1, 'acao presente no catalogo');
  assert.equal(rows[0].reason_required, true);
  assert.equal(rows[0].active, true);
});

test('CA-18: cada procedimento com exercicio grava um evento com ator, papel, motivo e instante', async () => {
  await emTransacaoDesfeita(async () => {
    for (const proc of PROCEDIMENTOS) {
      const { rows } = await gravar(proc);
      assert.ok(rows[0].id, `evento gravado para ${proc}`);
      const ev = await client.query(
        `select actor_ref, actor_role, action, reason_code, at, after_state
           from audit.audit_event where id = $1`,
        [rows[0].id],
      );
      const e = ev.rows[0];
      assert.equal(e.actor_ref, 'admin:h114', `ator em ${proc}`);
      assert.equal(e.actor_role, 'admin', `papel em ${proc}`);
      assert.equal(e.action, 'runbook.exercicio.executado', `acao em ${proc}`);
      assert.equal(e.reason_code, `exercicio_h114_${proc.replace('-', '').toLowerCase()}`, `motivo em ${proc}`);
      assert.ok(e.at instanceof Date && !Number.isNaN(e.at.getTime()), `instante em ${proc}`);
      assert.equal(e.after_state.procedimento, proc);
    }
  });
});

test('CA-18: evento sem motivo e recusado (reason_required)', async () => {
  await emTransacaoDesfeita(async () => {
    await client.query('savepoint sp_motivo');
    await assert.rejects(gravar('D-04', ''), (e) => {
      assert.ok(e, 'recusa com erro');
      return true;
    });
    await client.query('rollback to savepoint sp_motivo');
  });
});

test('CA-18: acao fora do catalogo e recusada (catalogo fechado)', async () => {
  await emTransacaoDesfeita(async () => {
    await client.query('savepoint sp_acao');
    await assert.rejects(
      client.query(
        `select private.audit_append('admin:h114', 'admin', 'runbook.exercicio.inexistente',
           'runbook_exercicio', $1::uuid, '{}'::jsonb, '{"status":"x"}'::jsonb, 'exercicio_h114_x', null)`,
        [randomUUID()],
      ),
    );
    await client.query('rollback to savepoint sp_acao');
  });
});
