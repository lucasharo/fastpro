// H-092 | Flush do agrupamento no banco (desenho 35 §10): T-H92-19 em transacao desfeita e
// T-H92-13 / T-H92-16 (concorrencia real) marcados NAO VERIFICADO: exigem COMMIT entre conexoes,
// e este projeto nao grava dados permanentes em teste. Sem rede. fetch bloqueado no setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { guard } from './fixtures/no-network.mjs';

after(() => {
  if (guard.denied.length > 0) throw new Error('tentativa de rede real durante os testes de flush');
});

globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes (H-092)');
};

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const T0 = Date.parse('2026-11-11T12:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const SCOPE = randomUUID();

const INGEST_SQL =
  'select * from private.notification_ingest($1::uuid,$2,$3,$4::uuid,$5::timestamptz,$6,$7,$8::jsonb,$9,$10::integer,$11::timestamptz)';
const BEGIN_SQL =
  'select out_estado, out_cooldown_ate::text as c, out_item_ids from private.notification_flush_begin($1::uuid,$2,$3,$4::timestamptz)';
const COMMIT_SQL =
  'select * from private.notification_flush_commit($1::uuid,$2,$3,$4::timestamptz,$5::uuid[],$6::jsonb,$7,$8::jsonb,$9::integer,$10::timestamptz)';

const digest = (rec, ev, now) =>
  client
    .query(INGEST_SQL, [
      rec,
      'aceite',
      SCOPE,
      ev,
      now,
      'aceite_aviso',
      'digest',
      JSON.stringify({ request_ref: SCOPE }),
      null,
      900,
      now,
    ])
    .then((r) => r.rows[0]);

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

test('T-H92-19: evento chega entre o inicio e o fechamento do flush: fica pendente com novo flush, sem rajada', () =>
  tx(async () => {
    const rec = randomUUID();
    assert.equal((await digest(rec, randomUUID(), at(0))).out_resultado, 'enviado_agora');
    assert.equal((await digest(rec, randomUUID(), at(100))).out_resultado, 'pendente');
    const begin = (await client.query(BEGIN_SQL, [rec, 'aceite', SCOPE, at(900)])).rows[0];
    assert.equal(begin.out_estado, 'pronto');
    assert.equal(begin.out_item_ids.length, 1);

    // Chega um evento depois do passo 1 e antes do passo 3.
    const tardio = (await digest(rec, randomUUID(), at(900))).out_resultado;
    assert.equal(tardio, 'pendente');

    const commit = (
      await client.query(COMMIT_SQL, [
        rec,
        'aceite',
        SCOPE,
        begin.c,
        begin.out_item_ids,
        '[]',
        'aceite_resumo',
        JSON.stringify({ request_ref: SCOPE }),
        900,
        at(900),
      ])
    ).rows[0];
    assert.equal(commit.out_resultado, 'enviado');

    // Somente o item do passo 1 saiu; o tardio continua pendente, sem segundo e-mail imediato.
    const pendentes = (
      await client.query(
        "select count(*)::int as n from ops.notification_item where recipient_user_id = $1 and state = 'pendente'",
        [rec],
      )
    ).rows[0].n;
    assert.equal(pendentes, 1);
    const resumos = (
      await client.query(
        "select count(*)::int as n from ops.email_outbox where recipient_user_id = $1 and email_type = 'aceite_resumo'",
        [rec],
      )
    ).rows[0].n;
    assert.equal(resumos, 1);
    // Novo flush agendado para o fim da nova janela (at 1800).
    const agendado = (
      await client.query(
        "select count(*)::int as n from ops.job where kind = 'notification.flush' and payload_ref = $1 and run_at = $2::timestamptz",
        [`${rec}|aceite|${SCOPE}`, at(1800)],
      )
    ).rows[0].n;
    assert.equal(agendado, 1);
  }));

test(
  'T-H92-13: 20 ingestoes simultaneas na mesma chave = 1 imediato, 19 pendentes, 1 flush (NAO VERIFICADO)',
  {
    skip: 'NAO_VERIFICADO: exige conexoes concorrentes com COMMIT (dados permanentes de teste); nao executado',
  },
  () => {},
);

test(
  'T-H92-16: flush executado em duas conexoes simultaneas = 1 e-mail (NAO VERIFICADO)',
  {
    skip: 'NAO_VERIFICADO: exige conexoes concorrentes com COMMIT (dados permanentes de teste); nao executado',
  },
  () => {},
);
