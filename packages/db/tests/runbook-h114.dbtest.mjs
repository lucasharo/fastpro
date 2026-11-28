// Testes de banco do runbook de incidente (H-114, Issue #123; desenho 165 §5 CA-03 e CA-04).
// Rodam no banco de DEV em transacao desfeita (begin/rollback). Nada e gravado de forma permanente.
// Dados sinteticos levam o marcador [TESTE-H114]. Schemas de teste sao descartaveis (h114_mig_*).
// Executar: node --test --test-concurrency=1 packages/db/tests/runbook-h114.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/** Executa fn dentro de transacao e sempre desfaz (rollback), mesmo em caso de falha. */
async function emTransacaoDesfeita(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

// Identificador de schema descartavel: so letras minusculas, digitos e underscore.
const schemaDescartavel = () => `h114_mig_${randomBytes(4).toString('hex')}`;

// --- D-04: projeto pausado ou indisponivel ---------------------------------------------------------

test('D-04 passo 6: gatilhos de bloqueio de audit.audit_event habilitados (tgenabled = A)', async () => {
  const res = await client.query(
    `select t.tgname, t.tgenabled::text as enabled
       from pg_trigger t
      where t.tgrelid = 'audit.audit_event'::regclass
        and t.tgname in ('tg_block_mutation', 'tg_block_truncate', 'tg_event_seal')
        and not t.tgisinternal
      order by 1`,
  );
  assert.deepEqual(
    res.rows.map((r) => r.tgname),
    ['tg_block_mutation', 'tg_block_truncate', 'tg_event_seal'],
  );
  // Valor verificado no DEV em 2026-11-20: ENABLE ALWAYS ('A'). O desenho marcava como nao verificado.
  for (const r of res.rows) assert.equal(r.enabled, 'A', `${r.tgname} nao esta ENABLE ALWAYS`);
});

test('D-04 detecao: defasagem do ultimo job concluido em ops.job (job sintetico de 25 h)', async () => {
  await emTransacaoDesfeita(async () => {
    const marcador = `[TESTE-H114]-tick-${randomBytes(6).toString('hex')}`;
    await client.query(
      `insert into ops.job (kind, dedupe_key, run_at, state, updated_at)
       values ('test.h114.tick', $1, now() - interval '25 hours', 'concluido',
               now() - interval '25 hours')`,
      [marcador],
    );
    const res = await client.query(
      `select extract(epoch from (now() - max(updated_at))) / 3600 as horas
         from ops.job
        where state = 'concluido' and kind = 'test.h114.tick'`,
    );
    const horas = Number(res.rows[0].horas);
    // Alerta do runbook: defasagem acima de 24 h.
    assert.ok(horas > 24, `defasagem esperada acima de 24 h, obtido ${horas.toFixed(2)} h`);
  });
});

test('D-04 detecao: sem job concluido a consulta devolve nulo (ramo "sem historico")', async () => {
  await emTransacaoDesfeita(async () => {
    const res = await client.query(
      `select max(updated_at) as ultimo from ops.job
        where state = 'concluido' and kind = 'test.h114.inexistente'`,
    );
    assert.equal(res.rows[0].ultimo, null);
  });
});

test('D-04 passo 7: cron.job so e conferido se pg_cron estiver instalado', async (t) => {
  const ext = await client.query(
    'select exists (select 1 from pg_extension where extname = $1) as ok',
    ['cron'],
  );
  if (!ext.rows[0].ok) {
    t.skip('pg_cron nao instalado no DEV (verificado em 2026-11-20); passo 7 pulado com motivo');
    return;
  }
  const res = await client.query('select count(*)::int as n from cron.job');
  assert.ok(res.rows[0].n >= 0);
});

// --- D-05: migracao falha (compensacao) ------------------------------------------------------------

test('D-05 diagnostico: ops.schema_migration tem as colunas que o runbook consulta', async () => {
  const res = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'ops' and table_name = 'schema_migration'
      order by ordinal_position`,
  );
  const colunas = res.rows.map((r) => r.column_name);
  for (const c of ['version', 'name', 'checksum', 'applied_at', 'applied_by']) {
    assert.ok(colunas.includes(c), `coluna ausente em ops.schema_migration: ${c}`);
  }
});

test('D-05 exercicio: migracao que viola check nao deixa nada aplicado (rollback total)', async () => {
  const schema = schemaDescartavel();
  await client.query('begin');
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`create table ${schema}.t (v int check (v > 0))`);
    await client.query(`insert into ${schema}.t (v) values (1)`);
    // Passo que falha por constraint: a transacao da migracao inteira aborta.
    await assert.rejects(client.query(`insert into ${schema}.t (v) values (-1)`), (e) => {
      assert.equal(e.code, '23514', 'esperado check_violation (23514)');
      return true;
    });
  } finally {
    await client.query('rollback');
  }
  const depois = await client.query('select to_regnamespace($1) is null as ausente', [schema]);
  assert.equal(depois.rows[0].ausente, true, 'o schema de teste nao deveria persistir apos rollback');
});

test('D-05 exercicio: migracao compensatoria com a constraint correta aplica e aceita a linha valida', async () => {
  const schema = schemaDescartavel();
  await emTransacaoDesfeita(async () => {
    // Compensatoria: recria a tabela com a regra correta, sem tocar migracao ja aplicada.
    await client.query(`create schema ${schema}`);
    await client.query(`create table ${schema}.t (v int check (v > 0))`);
    await client.query(`insert into ${schema}.t (v) values (2)`);
    const res = await client.query(`select count(*)::int as n from ${schema}.t`);
    assert.equal(res.rows[0].n, 1);
    await assert.rejects(client.query(`insert into ${schema}.t (v) values (0)`), (e) => {
      assert.equal(e.code, '23514');
      return true;
    });
  });
  // Fora da transacao o schema ja foi desfeito (nada persistido).
  const depois = await client.query('select to_regnamespace($1) is null as ausente', [schema]);
  assert.equal(depois.rows[0].ausente, true);
});
