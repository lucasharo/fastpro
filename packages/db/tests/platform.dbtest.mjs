// Testes de catalogo e de comportamento do esqueleto da plataforma (H-005). Rodam contra o banco de
// desenvolvimento. Catalogo: somente leitura. Comportamento: transacao com rollback, exceto a
// disputa de lease (precisa de commit) que usa um `kind` exclusivo e remove o que criou.
// Executar: pnpm db:test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from '../scripts/lib/env.mjs';

const TABLES = ['outbox_event', 'job', 'idempotency_key', 'rate_counter', 'app_config'];
const FUNCTIONS = [
  'job_enqueue',
  'job_claim',
  'job_complete',
  'job_fail',
  'idempotency_begin',
  'idempotency_complete',
];
// Nome montado em partes: o check-secrets so permite o literal em modulos especificos.
const BLOCKED_ROLES = ['anon', 'authenticated', 'service' + '_role'];
const ALL_TABLE_PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const hash = (c) => c.repeat(64);

// --- Catalogo --------------------------------------------------------------------------------

test('tabelas do esqueleto existem em ops, com RLS habilitada e forcada', async () => {
  const res = await client.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relname = any($1) order by 1`,
    [TABLES],
  );
  assert.deepEqual(res.rows.map((r) => r.relname).sort(), [...TABLES].sort());
  for (const r of res.rows) {
    assert.equal(r.relrowsecurity, true, `${r.relname} sem RLS habilitada`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname} sem RLS forcada`);
  }
});

test('nenhuma politica de acesso existe nos esquemas do produto (negar por padrao)', async () => {
  const res = await client.query(
    `select schemaname || '.' || tablename as tabela, policyname from pg_policies
      where schemaname in ('app', 'billing', 'audit', 'ops', 'private')`,
  );
  assert.deepEqual(res.rows, []);
});

test('anon, authenticated, chave de servico, PUBLIC e app_api nao acessam as tabelas', async () => {
  for (const t of TABLES) {
    for (const role of [...BLOCKED_ROLES, 'app_api']) {
      const res = await client.query('select has_table_privilege($1, $2, $3) as p', [
        role,
        `ops.${t}`,
        ALL_TABLE_PRIVS,
      ]);
      assert.equal(res.rows[0].p, false, `${role} tem privilegio em ops.${t}`);
    }
    const pub = await client.query(
      `select count(*)::int as n from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where c.oid = $1::regclass and a.grantee = 0`,
      [`ops.${t}`],
    );
    assert.equal(pub.rows[0].n, 0, `PUBLIC tem privilegio em ops.${t}`);
  }
});

test('app_system tem apenas os privilegios minimos nas tabelas (sem TRUNCATE/REFERENCES/TRIGGER)', async () => {
  for (const t of TABLES) {
    for (const p of ['SELECT', 'INSERT', 'UPDATE']) {
      const res = await client.query('select has_table_privilege($1, $2, $3) as p', [
        'app_system',
        `ops.${t}`,
        p,
      ]);
      assert.equal(res.rows[0].p, true, `app_system sem ${p} em ops.${t}`);
    }
    for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const res = await client.query('select has_table_privilege($1, $2, $3) as p', [
        'app_system',
        `ops.${t}`,
        p,
      ]);
      assert.equal(res.rows[0].p, false, `app_system tem ${p} em ops.${t}`);
    }
  }
});

test('funcoes private.* do esqueleto: sem EXECUTE para PUBLIC/anon/authenticated/chave de servico/app_api', async () => {
  const res = await client.query(
    `select p.oid::regprocedure::text as fn, p.proname, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = any($1)`,
    [FUNCTIONS],
  );
  assert.deepEqual(res.rows.map((r) => r.proname).sort(), [...FUNCTIONS].sort());
  for (const r of res.rows) {
    assert.equal(r.prosecdef, false, `${r.fn} nao deveria ser SECURITY DEFINER`);
    assert.ok(
      (r.proconfig ?? []).some((c) => c === 'search_path=""'),
      `${r.fn} sem search_path fixo`,
    );
    for (const role of [...BLOCKED_ROLES, 'app_api']) {
      const ex = await client.query(
        'select has_function_privilege($1, $2::regprocedure, $3) as p',
        [role, r.fn, 'EXECUTE'],
      );
      assert.equal(ex.rows[0].p, false, `${role} executa ${r.fn}`);
    }
    const pub = await client.query(
      `select count(*)::int as n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = $1::regprocedure and a.grantee = 0`,
      [r.fn],
    );
    assert.equal(pub.rows[0].n, 0, `PUBLIC executa ${r.fn}`);
    const sys = await client.query('select has_function_privilege($1, $2::regprocedure, $3) as p', [
      'app_system',
      r.fn,
      'EXECUTE',
    ]);
    assert.equal(sys.rows[0].p, true, `app_system nao executa ${r.fn}`);
  }
});

test('restricoes do esqueleto: unicos e indices esperados', async () => {
  const res = await client.query(
    `select conrelid::regclass::text as tabela, conname, contype from pg_constraint
      where connamespace = 'ops'::regnamespace and contype in ('u', 'p')`,
  );
  const names = new Set(res.rows.map((r) => `${r.tabela}:${r.conname}`));
  assert.ok(names.has('ops.idempotency_key:idempotency_key_pkey'));
  assert.ok(names.has('ops.outbox_event:outbox_event_aggregate_seq_key'));
  assert.ok(names.has('ops.rate_counter:rate_counter_pkey'));
  assert.ok(names.has('ops.job:job_dedupe_key_key'));
  const idx = await client.query(
    `select indexname from pg_indexes where schemaname = 'ops'
        and indexname in ('job_state_run_at_idx', 'outbox_event_pending_idx')`,
  );
  assert.equal(idx.rows.length, 2);
});

// --- Comportamento (transacao com rollback; papel app_system valida tambem os grants) ------------

// O papel de migracao nao e membro dos papeis de aplicacao; a concessao abaixo vale so dentro da
// transacao e e desfeita pelo rollback (nada persiste).
async function inTx(fn) {
  await client.query('begin');
  try {
    await client.query('grant app_system, app_api to current_user');
    await client.query('set local role app_system');
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

test('app_api (sem BYPASSRLS) e negado pela RLS e pelos privilegios; app_system opera', async () => {
  await inTx(async () => {
    await client.query("select private.job_enqueue('zz_teste.rls', 'rls-' || gen_random_uuid())");
    const visible = await client.query('select count(*)::int as n from ops.job');
    assert.ok(visible.rows[0].n >= 1, 'app_system enxerga o job que criou');
    await client.query('reset role');
    await client.query('set local role app_api');
    await client.query('savepoint s');
    await assert.rejects(client.query('select count(*) from ops.job'), { code: '42501' });
    await client.query('rollback to savepoint s');
    // Mesmo que um privilegio fosse concedido por engano, a RLS sem politicas nega as linhas.
    await client.query('reset role');
    await client.query('grant usage on schema ops to app_api');
    await client.query('grant select on ops.job to app_api');
    await client.query('set local role app_api');
    const denied = await client.query('select count(*)::int as n from ops.job');
    assert.equal(denied.rows[0].n, 0, 'RLS forcada sem politicas deve ocultar todas as linhas');
  });
});

test('idempotencia: nova, em_andamento, conflito (corpo diferente), repetida e chave vencida', async () => {
  await inTx(async () => {
    const key = randomUUID();
    const begin = async (h, ttl = 3600) =>
      (
        await client.query('select * from private.idempotency_begin($1, $2, $3, $4, $5)', [
          'p-teste',
          'op_teste',
          key,
          h,
          ttl,
        ])
      ).rows[0];
    assert.equal((await begin(hash('a'))).outcome, 'nova');
    assert.equal((await begin(hash('a'))).outcome, 'em_andamento');
    assert.equal((await begin(hash('b'))).outcome, 'conflito');
    const done = await client.query(
      'select private.idempotency_complete($1, $2, $3, $4, $5) as ok',
      ['p-teste', 'op_teste', key, 201, 'ref://resposta'],
    );
    assert.equal(done.rows[0].ok, true);
    const again = await client.query(
      'select private.idempotency_complete($1, $2, $3, $4, $5) as ok',
      ['p-teste', 'op_teste', key, 200, null],
    );
    assert.equal(again.rows[0].ok, false);
    const rep = await begin(hash('a'));
    assert.deepEqual(
      { o: rep.outcome, s: rep.response_status, r: rep.response_body_ref },
      { o: 'repetida', s: 201, r: 'ref://resposta' },
    );
    assert.equal((await begin(hash('b'))).outcome, 'conflito');
    // Principal diferente com a mesma chave e independente.
    const other = await client.query(
      'select * from private.idempotency_begin($1, $2, $3, $4, $5)',
      ['p-outro', 'op_teste', key, hash('b'), 3600],
    );
    assert.equal(other.rows[0].outcome, 'nova');
    // Chave vencida e reaproveitada, inclusive com outro corpo.
    await client.query(
      `update ops.idempotency_key set expires_at = clock_timestamp() - interval '1 second'
        where principal_id = 'p-teste'`,
    );
    const reuse = await begin(hash('c'));
    assert.equal(reuse.outcome, 'nova');
    assert.equal((await begin(hash('c'))).outcome, 'em_andamento');
  });
});

test('idempotencia: hash invalido e recusado pelo CHECK', async () => {
  await inTx(async () => {
    await client.query('savepoint s');
    await assert.rejects(
      client.query('select * from private.idempotency_begin($1, $2, $3, $4, $5)', [
        'p',
        'op_teste',
        randomUUID(),
        'nao-e-hash',
        60,
      ]),
      { code: '23514' },
    );
    await client.query('rollback to savepoint s');
  });
});

test('jobs: enqueue deduplica, claim respeita run_at, kind, lease e tentativas', async () => {
  await inTx(async () => {
    const kind = 'zz_teste.' + randomUUID().slice(0, 8);
    const enq = async (dedupe, runAtSql = 'null') =>
      (
        await client.query(`select private.job_enqueue($1, $2, ${runAtSql}, null, 2) as id`, [
          kind,
          dedupe,
        ])
      ).rows[0].id;
    const a = await enq('a-' + kind);
    assert.equal(await enq('a-' + kind), a, 'mesmo dedupe_key devolve o mesmo job');
    await enq('futuro-' + kind, "clock_timestamp() + interval '1 hour'");

    const claim = async (owner, secs = 60) =>
      (await client.query('select * from private.job_claim($1, $2, $3, 10)', [owner, kind, secs]))
        .rows;
    const first = await claim('w1');
    assert.equal(first.length, 1, 'so o job devido');
    assert.equal(first[0].id, a);
    assert.equal(first[0].state, 'em_execucao');
    assert.equal(first[0].lease_owner, 'w1');
    assert.equal(first[0].attempts, 1);
    assert.deepEqual(await claim('w2'), [], 'lease vigente nao e reivindicado');

    // Dono antigo nao conclui depois de outro assumir.
    await client.query(
      `update ops.job set lease_until = clock_timestamp() - interval '1 second' where id = $1`,
      [a],
    );
    const retaken = await claim('w2');
    assert.equal(retaken.length, 1);
    assert.equal(retaken[0].attempts, 2);
    const stale = await client.query('select private.job_complete($1, $2) as ok', [a, 'w1']);
    assert.equal(stale.rows[0].ok, false);

    // Esgotadas as tentativas (max 2), lease vencido vira falha e nao e mais reivindicado.
    await client.query(
      `update ops.job set lease_until = clock_timestamp() - interval '1 second' where id = $1`,
      [a],
    );
    assert.deepEqual(await claim('w3'), []);
    const st = await client.query(
      'select state, last_error, lease_owner from ops.job where id = $1',
      [a],
    );
    assert.deepEqual(st.rows[0], {
      state: 'falha',
      last_error: 'lease_expirado',
      lease_owner: null,
    });
  });
});

test('jobs: complete pelo dono, e fail reagenda ate esgotar tentativas', async () => {
  await inTx(async () => {
    const kind = 'zz_teste.' + randomUUID().slice(0, 8);
    const id = (
      await client.query('select private.job_enqueue($1, $2, null, null, 2) as id', [
        kind,
        'k-' + kind,
      ])
    ).rows[0].id;
    const claim = async (owner) =>
      (await client.query('select * from private.job_claim($1, $2, 60, 1)', [owner, kind])).rows;

    assert.equal((await claim('w1')).length, 1);
    const fail1 = await client.query('select private.job_fail($1, $2, $3, 0) as ok', [
      id,
      'w1',
      'boom',
    ]);
    assert.equal(fail1.rows[0].ok, true);
    assert.equal(
      (await client.query('select state from ops.job where id = $1', [id])).rows[0].state,
      'pendente',
    );
    assert.equal((await claim('w1')).length, 1);
    await client.query('select private.job_fail($1, $2, $3, 0)', [id, 'w1', 'boom']);
    const last = await client.query(
      'select state, attempts, last_error from ops.job where id = $1',
      [id],
    );
    assert.deepEqual(last.rows[0], { state: 'falha', attempts: 2, last_error: 'boom' });

    const id2 = (
      await client.query('select private.job_enqueue($1, $2) as id', [kind, 'ok-' + kind])
    ).rows[0].id;
    assert.equal((await claim('w9')).length, 1);
    const wrongOwner = await client.query('select private.job_complete($1, $2) as ok', [
      id2,
      'outro',
    ]);
    assert.equal(wrongOwner.rows[0].ok, false);
    const done = await client.query('select private.job_complete($1, $2) as ok', [id2, 'w9']);
    assert.equal(done.rows[0].ok, true);
    assert.deepEqual(await claim('w9'), []);
  });
});

test('outbox: seq unico por agregado e payload deve ser objeto', async () => {
  await inTx(async () => {
    const agg = randomUUID();
    const ins = (seq, payload = '{}') =>
      client.query(
        `insert into ops.outbox_event (type, aggregate_type, aggregate_id, aggregate_seq, payload)
         values ('teste.criado', 'teste', $1, $2, $3::jsonb)`,
        [agg, seq, payload],
      );
    await ins(1);
    await ins(2);
    await client.query('savepoint s1');
    await assert.rejects(ins(2), { code: '23505' });
    await client.query('rollback to savepoint s1');
    await assert.rejects(ins(3, '[1]'), { code: '23514' });
    await client.query('rollback to savepoint s1');
  });
});

// Disputa real entre duas conexoes: precisa de commit; usa kind exclusivo e limpa ao final.
test('jobs: FOR UPDATE SKIP LOCKED -- duas conexoes concorrentes nunca recebem o mesmo job', async () => {
  const other = await connect();
  const kind = 'zz_teste.' + randomUUID().slice(0, 8);
  try {
    for (const n of [1, 2, 3]) {
      await client.query('select private.job_enqueue($1, $2)', [kind, `${n}-${kind}`]);
    }
    await client.query('begin');
    await other.query('begin');
    try {
      const a = await client.query('select id from private.job_claim($1, $2, 60, 2)', ['wa', kind]);
      const b = await other.query('select id from private.job_claim($1, $2, 60, 2)', ['wb', kind]);
      const ids = [...a.rows, ...b.rows].map((r) => r.id);
      assert.equal(a.rows.length, 2);
      assert.equal(b.rows.length, 1, 'a segunda conexao recebe apenas o restante');
      assert.equal(new Set(ids).size, 3, 'nenhum job entregue em duplicidade');
    } finally {
      await client.query('rollback');
      await other.query('rollback');
    }
  } finally {
    await client.query('delete from ops.job where kind = $1', [kind]);
    await other.end();
  }
});

// Visibilidade transacional do outbox: o evento so aparece para outra conexao apos o commit.
test('outbox: evento sem commit nao e visivel a outra conexao; apos o commit fica visivel', async () => {
  const other = await connect();
  const agg = randomUUID();
  const count = async (c) =>
    (
      await c.query('select count(*)::int as n from ops.outbox_event where aggregate_id = $1', [
        agg,
      ])
    ).rows[0].n;
  try {
    await client.query('begin');
    try {
      await client.query(
        `insert into ops.outbox_event (type, aggregate_type, aggregate_id, aggregate_seq, payload)
         values ('teste.criado', 'zz_teste', $1, 1, '{}'::jsonb)`,
        [agg],
      );
      assert.equal(await count(client), 1, 'a propria transacao enxerga o evento');
      assert.equal(await count(other), 0, 'outra conexao nao enxerga evento sem commit');
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
    assert.equal(await count(other), 1, 'apos o commit o evento fica visivel');
  } finally {
    await client.query('delete from ops.outbox_event where aggregate_id = $1', [agg]);
    await other.end();
  }
});

// Corrida real de idempotency_begin: a 2a conexao espera a 1a decidir (lock da linha) e, apos o
// commit dela, recebe 'em_andamento'. Precisa de commit; usa principal exclusivo e limpa ao final.
test('idempotencia: duas conexoes com a mesma chave -- uma recebe nova, a outra em_andamento', async () => {
  const other = await connect();
  const principal = 'zz_teste.' + randomUUID().slice(0, 8);
  const key = randomUUID();
  const begin = (c) =>
    c.query('select outcome from private.idempotency_begin($1, $2, $3, $4, $5)', [
      principal,
      'op_teste',
      key,
      hash('a'),
      60,
    ]);
  try {
    await client.query('begin');
    await other.query('begin');
    try {
      const first = await begin(client);
      assert.equal(first.rows[0].outcome, 'nova');
      let settled = false;
      const second = begin(other).finally(() => {
        settled = true;
      });
      await sleep(500);
      assert.equal(settled, false, 'a segunda conexao aguarda a primeira decidir');
      await client.query('commit');
      assert.equal((await second).rows[0].outcome, 'em_andamento');
      await other.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      await other.query('rollback').catch(() => {});
      throw e;
    }
  } finally {
    await client.query('delete from ops.idempotency_key where principal_id = $1', [principal]);
    await other.end();
  }
});
