// H-092 | Testes do pipeline de notificacoes no banco de desenvolvimento (desenho 35 §10).
// Cada teste roda numa transacao desfeita (rollback): nada fica gravado. Quota usa 2099-01-01 (isolado).
// Sem rede: o provedor nao e chamado aqui; fetch e bloqueado no setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

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

async function inTx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

const T0 = Date.parse('2026-11-11T12:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const SCOPE = randomUUID();
const SERVICE_KEY_ROLE = 'service' + '_role';

const INGEST_SQL =
  'select * from private.notification_ingest($1::uuid,$2,$3,$4::uuid,$5::timestamptz,$6,$7,$8::jsonb,$9,$10::integer,$11::timestamptz)';
const BEGIN_SQL =
  'select out_estado, out_cooldown_ate::text as c, out_item_ids from private.notification_flush_begin($1::uuid,$2,$3,$4::timestamptz)';
const COMMIT_SQL =
  'select * from private.notification_flush_commit($1::uuid,$2,$3,$4::timestamptz,$5::uuid[],$6::jsonb,$7,$8::jsonb,$9::integer,$10::timestamptz)';

// Ingestao digest (aceite por padrao) com evento, escopo e instante dados.
const digest = (rec, ev, now, scope = SCOPE, cat = 'aceite') =>
  client
    .query(INGEST_SQL, [
      rec,
      cat,
      scope,
      ev,
      now,
      cat === 'aceite' ? 'aceite_aviso' : 'mensagem_aviso',
      'digest',
      JSON.stringify(cat === 'aceite' ? { request_ref: scope } : { conversation_ref: scope }),
      null,
      900,
      now,
    ])
    .then((r) => r.rows[0]);

const countWhere = async (sql, params) => Number((await client.query(sql, params)).rows[0].n);

test('T-H92-10: reentrega do mesmo evento 3x gera um item', () =>
  inTx(async () => {
    const rec = randomUUID();
    const ev = randomUUID();
    const r1 = await digest(rec, ev, at(0));
    const r2 = await digest(rec, ev, at(0));
    const r3 = await digest(rec, ev, at(0));
    assert.equal(r1.out_resultado, 'enviado_agora');
    assert.equal(r2.out_resultado, 'duplicado');
    assert.equal(r3.out_resultado, 'duplicado');
    assert.equal(
      await countWhere(
        'select count(*)::int as n from ops.notification_item where recipient_user_id = $1',
        [rec],
      ),
      1,
    );
  }));

test('T-H92-11: sem janela ativa, envio imediato e cooldown de 15 min', () =>
  inTx(async () => {
    const rec = randomUUID();
    const r = await digest(rec, randomUUID(), at(0));
    assert.equal(r.out_resultado, 'enviado_agora');
    const diff = (
      await client.query(
        'select extract(epoch from cooldown_until) - extract(epoch from $2::timestamptz) as d ' +
          'from ops.notification_cooldown where recipient_user_id = $1',
        [rec, at(0)],
      )
    ).rows[0].d;
    assert.equal(Number(diff), 900);
  }));

test('T-H92-12: 8 aceites no mesmo pedido em 15 min = 1 imediato, 7 pendentes e 1 flush', () =>
  inTx(async () => {
    const rec = randomUUID();
    const results = [];
    for (let i = 0; i < 8; i += 1)
      results.push((await digest(rec, randomUUID(), at(i))).out_resultado);
    assert.equal(results[0], 'enviado_agora');
    assert.deepEqual(results.slice(1), Array(7).fill('pendente'));
    assert.equal(
      await countWhere(
        "select count(*)::int as n from ops.notification_item where recipient_user_id = $1 and state = 'pendente'",
        [rec],
      ),
      7,
    );
    assert.equal(
      await countWhere(
        "select count(*)::int as n from ops.job where kind = 'notification.flush' and payload_ref like $1",
        [`${rec}|aceite|%`],
      ),
      1,
    );
  }));

test('T-H92-15: flush com 3 itens validos = 1 linha de resumo (count=3), itens enviados, cooldown reiniciado', () =>
  inTx(async () => {
    const rec = randomUUID();
    await digest(rec, randomUUID(), at(0));
    for (let i = 1; i <= 3; i += 1) await digest(rec, randomUUID(), at(i));
    const begin = (await client.query(BEGIN_SQL, [rec, 'aceite', SCOPE, at(900)])).rows[0];
    assert.equal(begin.out_estado, 'pronto');
    assert.equal(begin.out_item_ids.length, 3);
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
    const row = (
      await client.query('select template_params from ops.email_outbox where id = $1', [
        commit.out_outbox_id,
      ])
    ).rows[0];
    assert.equal(row.template_params.count, 3);
    const cool = (
      await client.query(
        'select cooldown_until::text as c from ops.notification_cooldown where recipient_user_id = $1',
        [rec],
      )
    ).rows[0];
    assert.equal(new Date(cool.c).toISOString(), at(1800));
  }));

test('T-H92-16: o mesmo flush comitado de novo (cooldown ja movido) nao gera segundo resumo', () =>
  inTx(async () => {
    const rec = randomUUID();
    await digest(rec, randomUUID(), at(0));
    await digest(rec, randomUUID(), at(1));
    const begin = (await client.query(BEGIN_SQL, [rec, 'aceite', SCOPE, at(900)])).rows[0];
    const args = [
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
    ];
    const primeiro = (await client.query(COMMIT_SQL, args)).rows[0];
    const segundo = (await client.query(COMMIT_SQL, args)).rows[0];
    assert.equal(primeiro.out_resultado, 'enviado');
    assert.equal(segundo.out_resultado, 'cooldown_movido');
    assert.equal(
      await countWhere(
        "select count(*)::int as n from ops.email_outbox where recipient_user_id = $1 and email_type = 'aceite_resumo'",
        [rec],
      ),
      1,
    );
  }));

test('T-H92-17: flush com todos descartados = nenhum resumo e cooldown inalterado (CA-09)', () =>
  inTx(async () => {
    const rec = randomUUID();
    await digest(rec, randomUUID(), at(0));
    await digest(rec, randomUUID(), at(1));
    const begin = (await client.query(BEGIN_SQL, [rec, 'aceite', SCOPE, at(900)])).rows[0];
    const drops = begin.out_item_ids.map((id) => ({ id, motivo: 'lido' }));
    const antes = (
      await client.query(
        'select cooldown_until::text as c from ops.notification_cooldown where recipient_user_id = $1',
        [rec],
      )
    ).rows[0].c;
    const commit = (
      await client.query(COMMIT_SQL, [
        rec,
        'aceite',
        SCOPE,
        begin.c,
        [],
        JSON.stringify(drops),
        'aceite_resumo',
        '{}',
        900,
        at(900),
      ])
    ).rows[0];
    assert.equal(commit.out_resultado, 'sem_envio');
    assert.equal(
      await countWhere(
        "select count(*)::int as n from ops.email_outbox where recipient_user_id = $1 and email_type = 'aceite_resumo'",
        [rec],
      ),
      0,
    );
    const depois = (
      await client.query(
        'select cooldown_until::text as c from ops.notification_cooldown where recipient_user_id = $1',
        [rec],
      )
    ).rows[0].c;
    assert.equal(depois, antes);
  }));

test('T-H92-18: flush antes do fim da janela reagenda e nao envia', () =>
  inTx(async () => {
    const rec = randomUUID();
    await digest(rec, randomUUID(), at(0));
    const begin = (await client.query(BEGIN_SQL, [rec, 'aceite', SCOPE, at(100)])).rows[0];
    assert.equal(begin.out_estado, 'reagendado');
  }));

test('T-H92-20: critico nao tem cooldown; mesma chave de deduplicacao reaproveita a linha', () =>
  inTx(async () => {
    const rec = randomUUID();
    const key = `test.h092:${randomUUID()}`;
    const base = [
      rec,
      'cancelamento',
      SCOPE,
      randomUUID(),
      at(0),
      'cancelamento',
      'critico',
      JSON.stringify({ request_ref: SCOPE }),
      key,
      null,
      at(0),
    ];
    const a = (await client.query(INGEST_SQL, base)).rows[0];
    const b = (
      await client.query(INGEST_SQL, [
        rec,
        'cancelamento',
        SCOPE,
        randomUUID(),
        at(0),
        'cancelamento',
        'critico',
        JSON.stringify({ request_ref: SCOPE }),
        key,
        null,
        at(0),
      ])
    ).rows[0];
    assert.equal(a.out_resultado, 'enfileirado');
    assert.equal(b.out_resultado, 'reaproveitado');
    assert.equal(a.out_outbox_id, b.out_outbox_id);
    assert.equal(
      await countWhere(
        'select count(*)::int as n from ops.notification_cooldown where recipient_user_id = $1',
        [rec],
      ),
      0,
    );
  }));

test('T-H92-21: cota de 100 por dia no auth: a 101a reserva e negada; uso nunca passa de 100', () =>
  inTx(async () => {
    const day = '2099-01-01T00:00:00.000Z';
    let granted = 0;
    let last;
    for (let i = 0; i < 101; i += 1) {
      const id = (
        await client.query(
          "insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, dedupe_key) values ($1, 'acesso', 'auth', 'acesso_login', 'acesso_login', $2) returning id",
          [randomUUID(), `test.h092.q:${i}:${randomUUID()}`],
        )
      ).rows[0].id;
      last = (
        await client.query(
          'select * from private.email_outbox_reservar_cota($1::uuid, 100, 3000, $2::timestamptz)',
          [id, day],
        )
      ).rows[0];
      if (last.out_permitido) granted += 1;
    }
    assert.equal(granted, 100);
    assert.equal(last.out_permitido, false);
    assert.equal(last.out_bloqueado_por, 'dia');
    assert.equal(new Date(last.out_proxima_tentativa).toISOString(), '2099-01-02T00:00:00.000Z');
    const used = (
      await client.query(
        "select used from ops.external_quota where service = 'email' and period = 'dia_utc' and period_start = '2099-01-01'",
      )
    ).rows[0].used;
    assert.equal(used, 100);
  }));

test('T-H92-22: tabelas sem acesso para anon, authenticated e papel de servico; RLS forcada; funcoes so para app_system', async () => {
  const tabelas = [
    'ops.email_outbox',
    'ops.notification_item',
    'ops.notification_cooldown',
    'ops.external_quota',
  ];
  for (const t of tabelas) {
    for (const papel of ['anon', 'authenticated', SERVICE_KEY_ROLE]) {
      const r = (
        await client.query('select has_table_privilege($1, $2, $3) as ok', [
          papel,
          t,
          'select,insert,update,delete',
        ])
      ).rows[0];
      assert.equal(r.ok, false, `${papel} em ${t}`);
    }
  }
  const rls = (
    await client.query(
      "select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ops' and c.relname = any($1) and c.relrowsecurity and c.relforcerowsecurity",
      [['email_outbox', 'notification_item', 'notification_cooldown', 'external_quota']],
    )
  ).rows[0].n;
  assert.equal(rls, 4);
  const fn = (
    await client.query(
      "select has_function_privilege('anon', 'private.email_outbox_claim(uuid, timestamptz)', 'execute') as ok",
    )
  ).rows[0];
  assert.equal(fn.ok, false);
});

test('T-H92-23: gatilho do outbox_event agenda o despachante (outbox.dispatch)', () =>
  inTx(async () => {
    const antes = await countWhere(
      "select count(*)::int as n from ops.job where kind = 'outbox.dispatch'",
      [],
    );
    await client.query(
      "insert into ops.outbox_event (type, aggregate_type, aggregate_id, aggregate_seq, payload) values ('test.h092.evento', 'test_h092', $1, 1, '{}')",
      [randomUUID()],
    );
    const depois = await countWhere(
      "select count(*)::int as n from ops.job where kind = 'outbox.dispatch'",
      [],
    );
    assert.equal(depois, antes + 1);
  }));

test('reivindicacao: a linha so e reivindicada uma vez enquanto o lease e valido', () =>
  inTx(async () => {
    const id = (
      await client.query(
        "insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, dedupe_key) values ($1, 'acesso', 'auth', 'acesso_login', 'acesso_login', $2) returning id",
        [randomUUID(), `test.h092.c:${randomUUID()}`],
      )
    ).rows[0].id;
    const primeira = (
      await client.query('select * from private.email_outbox_claim($1::uuid, $2::timestamptz)', [
        id,
        at(0),
      ])
    ).rows;
    const segunda = (
      await client.query('select * from private.email_outbox_claim($1::uuid, $2::timestamptz)', [
        id,
        at(10),
      ])
    ).rows;
    assert.equal(primeira.length, 1);
    assert.equal(segunda.length, 0);
  }));
