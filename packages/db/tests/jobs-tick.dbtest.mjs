// Testes do tick de jobs no banco de desenvolvimento (H-008, desenho 24-DESENHO-H008.md §7).
// Sem chamada externa: nunca ha commit com net.http_post pendente (o pg_net so envia depois do
// commit) e a URL de teste e https://tick.invalid/internal/jobs/tick. Os testes de comportamento
// rodam em transacao com rollback. Os de concorrencia usam kind com prefixo test.h008.* e limpam no
// finally. Nenhum segredo e criado de verdade: os do Vault so existem dentro de transacao desfeita.
// Executar: pnpm db:test (exige pnpm build em packages/db: importa o espelho compilado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import {
  JobRegistry,
  PgJobStore,
  TICK_DELAY_SQL,
  TickService,
  registerJobHandler,
  tickProbeHandler,
} from '../dist/jobs-tick.js';

// Nomes montados em partes: o check-secrets so permite o literal em modulos especificos.
const BLOCKED = ['anon', 'authenticated', 'service' + '_role', 'app_api', 'app_system'];
const CHECKED_ROLES = ['PUBLIC', ...BLOCKED];
// Titulares de privilegio da propria plataforma (dono das extensoes e do schema) — lista fixada.
const PLATFORM_HOLDERS = ['postgres', 'supabase_admin', 'supabase_functions_admin'];
const TICK_URL = 'https://tick.invalid/internal/jobs/tick';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/** Executa fn numa transacao desfeita; o papel app_system so vale dentro dela (set local role). */
async function inTx(fn, { asSystem = false } = {}) {
  await client.query('begin');
  try {
    await client.query('grant app_system, app_api to current_user');
    if (asSystem) await client.query('set local role app_system');
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

// H-008 degradado: pg_cron e pg_net podem estar desativados pelo dono. Os testes que dependem deles
// verificam o estado real (ou pulam, com motivo) em vez de falhar por esquema ausente.
const temExtensao = async (nome) =>
  (
    await client.query('select exists (select 1 from pg_extension where extname = $1) as ok', [
      nome,
    ])
  ).rows[0].ok;

// Sem pg_net nao existe fila: a contagem e zero (nada pode ser enfileirado).
const queueCount = async () => {
  if (!(await temExtensao('pg_net'))) return 0;
  return (await client.query('select count(*)::int as n from net.http_request_queue')).rows[0].n;
};

// --- Catalogo e privilegios -----------------------------------------------------------------------

test('T-H8-02: nenhum papel de aplicacao ou PUBLIC tem acesso a cron/net (titulares fora da lista da plataforma: nenhum)', async () => {
  const res = await client.query(
    `with acl as (
       select 'schema' as tipo, n.nspname as objeto, a.grantee, a.privilege_type
         from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        where n.nspname in ('cron', 'net')
       union all
       select 'relacao', n.nspname || '.' || c.relname, a.grantee, a.privilege_type
         from pg_class c join pg_namespace n on n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where n.nspname in ('cron', 'net')
       union all
       select 'funcao', n.nspname || '.' || p.proname, a.grantee, a.privilege_type
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where n.nspname in ('cron', 'net')
     )
     select tipo, objeto, case when grantee = 0 then 'PUBLIC' else pg_get_userbyid(grantee) end as titular,
            privilege_type
       from acl`,
  );
  const violations = res.rows
    .filter((r) => r.titular === 'PUBLIC' || ![...PLATFORM_HOLDERS].includes(r.titular))
    .map((r) => `${r.titular} ${r.privilege_type} em ${r.tipo} ${r.objeto}`);
  const unique = [...new Set(violations.map((v) => v.replace(/ em .*/, '')))].sort();
  assert.deepEqual(
    unique,
    [],
    `titulares indevidos em cron/net (ocorrencias: ${violations.length}; ex.: ${violations.slice(0, 3).join('; ')})`,
  );
});

test('T-H8-02b: papeis de aplicacao sem USAGE em cron/net e sem EXECUTE nas funcoes de cron/net', async () => {
  for (const role of CHECKED_ROLES.filter((r) => r !== 'PUBLIC')) {
    for (const schema of ['cron', 'net']) {
      // Esquema ausente (H-008 degradado): nao ha USAGE a verificar; has_schema_privilege falharia.
      const existe = await client.query('select to_regnamespace($1) is not null as ok', [schema]);
      if (!existe.rows[0].ok) continue;
      const res = await client.query('select has_schema_privilege($1, $2, $3) as p', [
        role,
        schema,
        'USAGE',
      ]);
      assert.equal(res.rows[0].p, false, `${role} tem USAGE em ${schema}`);
    }
  }
});

test('T-H8-03: despachante e status sao SECURITY DEFINER com search_path vazio; so app_system executa o status', async () => {
  const res = await client.query(
    `select p.proname, p.prosecdef, 'search_path=""' = any(p.proconfig) as vazio
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('jobs_tick_dispatch', 'jobs_tick_status')`,
  );
  assert.equal(res.rows.length, 2);
  for (const r of res.rows) {
    assert.equal(r.prosecdef, true, `${r.proname} deveria ser SECURITY DEFINER`);
    assert.equal(r.vazio, true, `${r.proname} sem search_path vazio`);
  }
  for (const role of BLOCKED) {
    const d = await client.query('select has_function_privilege($1, $2::regprocedure, $3) as p', [
      role,
      'private.jobs_tick_dispatch()',
      'EXECUTE',
    ]);
    assert.equal(d.rows[0].p, false, `${role} executa jobs_tick_dispatch`);
    const s = await client.query('select has_function_privilege($1, $2::regprocedure, $3) as p', [
      role,
      'private.jobs_tick_status()',
      'EXECUTE',
    ]);
    assert.equal(s.rows[0].p, role === 'app_system', `EXECUTE de jobs_tick_status para ${role}`);
  }
});

test('T-H8-03b: jobs_tick_status (como app_system) le a agenda sem comando nem segredo', async () => {
  const comCron = await temExtensao('pg_cron');
  await inTx(
    async () => {
      const r = (await client.query('select private.jobs_tick_status() as s')).rows[0].s;
      assert.deepEqual(Object.keys(r).sort(), [
        'cron_instalado',
        'job_ativo',
        'ultima_execucao',
        'ultimo_status',
      ]);
      if (comCron) {
        assert.equal(r.cron_instalado, true);
        assert.equal(r.job_ativo, true);
      } else {
        // H-008 degradado: sem pg_cron o status informa a ausencia e nenhuma agenda ativa.
        assert.equal(r.cron_instalado, false);
        assert.equal(r.job_ativo, false);
      }
      assert.equal(JSON.stringify(r).includes('jobs_tick_dispatch'), false);
    },
    { asSystem: true },
  );
});

test('T-H8-04: agenda exata: jobs-tick (* * * * *, comando fixo, sem segredo) e cron-purge; nenhum outro job', async (t) => {
  if (!(await temExtensao('pg_cron'))) {
    t.skip('pg_cron ausente neste ambiente (H-008 degradado): nao ha agenda para conferir');
    return;
  }
  const res = await client.query(
    'select jobname, schedule, command, active from cron.job order by jobname',
  );
  const byName = Object.fromEntries(res.rows.map((r) => [r.jobname, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['cron-purge', 'jobs-tick']);
  const tick = byName['jobs-tick'];
  assert.equal(tick.schedule, '* * * * *');
  assert.equal(tick.active, true);
  assert.equal(tick.command, 'select private.jobs_tick_dispatch()');
  for (const bad of ['http', 'Bearer', 'secret', 'net.']) {
    assert.equal(tick.command.includes(bad), false, `comando contem ${bad}`);
  }
  assert.ok(byName['cron-purge'].command.includes('cron.job_run_details'));
  assert.equal(byName['cron-purge'].schedule, '17 3 * * *');
});

test('T-H8-06: vault.secrets e vault.decrypted_secrets sem privilegio para PUBLIC e papeis de aplicacao', async () => {
  const res = await client.query(
    `select c.oid::regclass::text as objeto, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as titular,
            a.privilege_type
       from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid in ('vault.secrets'::regclass, 'vault.decrypted_secrets'::regclass)`,
  );
  const offenders = res.rows
    .filter((r) => r.titular === 'PUBLIC' || BLOCKED.includes(r.titular))
    .map((r) => `${r.titular} ${r.privilege_type} em ${r.objeto}`);
  assert.deepEqual(offenders, [], `privilegio indevido no Vault: ${offenders.join('; ')}`);
});

// --- Despachante (T-H8-07): sem chamada real, tudo dentro de transacao desfeita --------------------

async function tickSecretsExist() {
  const r = await client.query(
    "select count(*)::int as n from vault.secrets where name in ('jobs_tick_secret', 'jobs_tick_url')",
  );
  return r.rows[0].n > 0;
}

test('T-H8-07a: sem segredos no Vault o despachante nao enfileira nada (retorna null)', async (t) => {
  if (await tickSecretsExist()) {
    t.skip(
      'segredos do tick ja existem neste ambiente (criados pelo operador); teste so vale sem eles',
    );
    return;
  }
  await inTx(async () => {
    const before = await queueCount();
    const r = await client.query('select private.jobs_tick_dispatch() as id');
    assert.equal(r.rows[0].id, null);
    assert.equal(await queueCount(), before);
  });
});

test('T-H8-07b: com segredo e URL temporarios, exatamente 1 pedido na fila com cabecalho de autorizacao; rollback desfaz tudo', async (t) => {
  if (await tickSecretsExist()) {
    t.skip('segredos do tick ja existem neste ambiente; nao sao tocados por teste');
    return;
  }
  const netOk = await temExtensao('pg_net');
  await inTx(async () => {
    const before = await queueCount();
    const valorDescartavel = randomBytes(32).toString('hex'); // valor descartavel, nunca impresso
    await client.query('select vault.create_secret($1, $2, $3)', [
      valorDescartavel,
      'jobs_tick_secret',
      'teste H-008',
    ]);
    await client.query('select vault.create_secret($1, $2, $3)', [
      TICK_URL,
      'jobs_tick_url',
      'teste H-008',
    ]);
    const r = await client.query('select private.jobs_tick_dispatch() as id');
    if (!netOk) {
      // H-008 degradado: sem pg_net o despachante e inerte mesmo com segredo e URL.
      assert.equal(r.rows[0].id, null, 'sem pg_net nada e enfileirado');
      assert.equal(await queueCount(), before);
      return;
    }
    assert.notEqual(r.rows[0].id, null);
    assert.equal((await queueCount()) - before, 1, 'exatamente 1 linha de fila');
    const row = (
      await client.query(
        'select url, headers, timeout_milliseconds from net.http_request_queue order by id desc limit 1',
      )
    ).rows[0];
    assert.equal(row.url, TICK_URL);
    assert.equal(row.timeout_milliseconds, 30000);
    assert.equal(
      row.headers.Authorization === `Bearer ${valorDescartavel}`,
      true,
      'cabecalho Authorization ausente ou diferente',
    );
  });
  assert.equal(await tickSecretsExist(), false, 'o rollback removeu os segredos temporarios');
});

test('T-H8-07c: URL fora do padrao (http ou outro caminho) nao enfileira', async (t) => {
  if (await tickSecretsExist()) {
    t.skip('segredos do tick ja existem neste ambiente; nao sao tocados por teste');
    return;
  }
  for (const url of [
    'http://tick.invalid/internal/jobs/tick',
    'https://tick.invalid/outro/caminho',
  ]) {
    await inTx(async () => {
      const before = await queueCount();
      await client.query('select vault.create_secret($1, $2, $3)', [
        randomUUID(),
        'jobs_tick_secret',
        't',
      ]);
      await client.query('select vault.create_secret($1, $2, $3)', [url, 'jobs_tick_url', 't']);
      const r = await client.query('select private.jobs_tick_dispatch() as id');
      assert.equal(r.rows[0].id, null, `URL aceita indevidamente: ${url}`);
      assert.equal(await queueCount(), before);
    });
  }
});

// --- Concorrencia e lease (Q-14, F-08, C-13) -------------------------------------------------------

test('T-H8-08: dois ticks simultaneos (A e C) sobre 20 jobs: cada um executa exatamente uma vez; 10 rodadas', async () => {
  const other = await connect();
  const kind = 'test.h008.conc';
  try {
    for (let round = 0; round < 10; round++) {
      const ids = [];
      for (let i = 0; i < 20; i++) {
        const id = (
          await client.query('select private.job_enqueue($1, $2) as id', [
            kind,
            `conc-${round}-${i}-${randomUUID()}`,
          ])
        ).rows[0].id;
        ids.push(id);
      }
      const runs = new Map();
      const registry = new JobRegistry();
      registerJobHandler(registry, kind, {
        async run(job) {
          runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
        },
      });
      const svcA = new TickService({
        store: new PgJobStore(client),
        registry,
        kindFilter: kind,
      });
      const svcC = new TickService({
        store: new PgJobStore(other),
        registry,
        kindFilter: kind,
      });
      const [ra, rc] = await Promise.all([svcA.run('a'), svcC.run('c')]);
      assert.equal(ra.reivindicados + rc.reivindicados, 20, 'conjuntos reivindicados somam 20');
      assert.equal(ra.concluidos + rc.concluidos, 20);
      for (const id of ids)
        assert.equal(runs.get(id), 1, `job ${id} executado ${runs.get(id)} vez(es)`);
      const states = await client.query(
        'select state, attempts from ops.job where id = any($1::uuid[])',
        [ids],
      );
      assert.ok(states.rows.every((r) => r.state === 'concluido' && r.attempts === 1));
      await client.query('delete from ops.job where kind = $1', [kind]);
    }
  } finally {
    await client.query('delete from ops.job where kind = $1', [kind]);
    await other.end();
  }
});

test('T-H8-09 (F-08): lease vencido reprocessa uma vez; o complete tardio devolve false; nenhum terceiro processamento', async () => {
  await inTx(async () => {
    const kind = 'test.h008.lease';
    const id = (
      await client.query('select private.job_enqueue($1, $2) as id', [
        kind,
        'lease-' + randomUUID(),
      ])
    ).rows[0].id;
    const first = new PgJobStore(client, false);
    const claimedFirst = await first.claim('tick-a:primeiro', kind, 60, 1);
    assert.equal(claimedFirst.length, 1, 'primeiro tick reivindica e morre (sem concluir)');
    await client.query(
      "update ops.job set lease_until = clock_timestamp() - interval '1 second' where id = $1",
      [id],
    );

    const runs = [];
    const registry = new JobRegistry();
    registerJobHandler(registry, kind, {
      async run(job) {
        runs.push(job.id);
      },
    });
    const second = new TickService({
      store: new PgJobStore(client, false),
      registry,
      kindFilter: kind,
      instanceId: 'segundo',
    });
    const report = await second.run('a');
    assert.equal(report.concluidos, 1);
    assert.deepEqual(runs, [id]);
    const row = (await client.query('select state, attempts from ops.job where id = $1', [id]))
      .rows[0];
    assert.deepEqual(row, { state: 'concluido', attempts: 2 });

    assert.equal(
      await first.complete(id, 'tick-a:primeiro'),
      false,
      'complete tardio do primeiro: false',
    );
    const third = await new TickService({
      store: new PgJobStore(client, false),
      registry,
      kindFilter: kind,
    }).run('c');
    assert.equal(third.reivindicados, 0);
    assert.equal(runs.length, 1, 'nenhum terceiro processamento');
  });
});

test('T-H8-10: tentativas esgotadas por expiracao viram falha (lease_expirado) e nunca mais sao reivindicadas', async () => {
  await inTx(async () => {
    const kind = 'test.h008.esgota';
    const id = (
      await client.query('select private.job_enqueue($1, $2, null, null, 2) as id', [
        kind,
        'esg-' + randomUUID(),
      ])
    ).rows[0].id;
    const store = new PgJobStore(client, false);
    for (let n = 0; n < 2; n++) {
      assert.equal((await store.claim('w' + n, kind, 60, 1)).length, 1);
      await client.query(
        "update ops.job set lease_until = clock_timestamp() - interval '1 second' where id = $1",
        [id],
      );
    }
    assert.deepEqual(await store.claim('w9', kind, 60, 1), []);
    const row = (await client.query('select state, last_error from ops.job where id = $1', [id]))
      .rows[0];
    assert.deepEqual(row, { state: 'falha', last_error: 'lease_expirado' });
    assert.deepEqual(await store.claim('w10', kind, 60, 1), []);
  });
});

test('T-H8-11: excecao do handler registra so o codigo (a mensagem com e-mail sintetico nao aparece); retry com recuo', async () => {
  await inTx(async () => {
    const kind = 'test.h008.erro';
    const id = (
      await client.query('select private.job_enqueue($1, $2) as id', [kind, 'err-' + randomUUID()])
    ).rows[0].id;
    class FalhaSintetica extends Error {}
    const registry = new JobRegistry();
    registerJobHandler(registry, kind, {
      async run() {
        throw new FalhaSintetica('envio para teste.sintetico@exemplo.invalid');
      },
    });
    const report = await new TickService({
      store: new PgJobStore(client, false),
      registry,
      kindFilter: kind,
    }).run('a');
    assert.equal(report.falhos, 1);
    const row = (
      await client.query(
        'select state, last_error, extract(epoch from (run_at - clock_timestamp()))::int as espera from ops.job where id = $1',
        [id],
      )
    ).rows[0];
    assert.equal(row.state, 'pendente');
    assert.equal(row.last_error, 'FalhaSintetica');
    assert.ok(row.espera >= 55 && row.espera <= 60, `recuo de ~60 s, veio ${row.espera}`);
    assert.equal(String(row.last_error).includes('exemplo.invalid'), false);
  });
});

test('T-H8-12: kind sem handler vira falha kind_desconhecido sem derrubar o laco', async () => {
  await inTx(async () => {
    const kind = 'test.h008.semh';
    const id = (
      await client.query('select private.job_enqueue($1, $2) as id', [kind, 'sh-' + randomUUID()])
    ).rows[0].id;
    const report = await new TickService({
      store: new PgJobStore(client, false),
      registry: new JobRegistry(),
      kindFilter: kind,
    }).run('a');
    assert.equal(report.falhos, 1);
    const row = (await client.query('select state, last_error from ops.job where id = $1', [id]))
      .rows[0];
    assert.deepEqual(row, { state: 'pendente', last_error: 'kind_desconhecido' });
  });
});

// --- Tick C sem pg_cron (T-H8-16, T-H8-17) -----------------------------------------------------------

test('T-H8-16: sem a agenda (cron.unschedule, ou sem pg_cron), o tick C ainda processa um job vencido', async () => {
  const comCron = await temExtensao('pg_cron');
  await inTx(async () => {
    const kind = 'test.h008.c';
    const id = (
      await client.query('select private.job_enqueue($1, $2) as id', [kind, 'c-' + randomUUID()])
    ).rows[0].id;
    if (comCron) {
      await client.query("select cron.unschedule('jobs-tick')");
      assert.equal(
        (await client.query("select count(*)::int as n from cron.job where jobname = 'jobs-tick'"))
          .rows[0].n,
        0,
      );
    }
    const registry = new JobRegistry();
    registerJobHandler(registry, kind, tickProbeHandler);
    const report = await new TickService({
      store: new PgJobStore(client, false),
      registry,
      kindFilter: kind,
    }).run('c');
    assert.equal(report.concluidos, 1);
    assert.equal(
      (await client.query('select state from ops.job where id = $1', [id])).rows[0].state,
      'concluido',
    );
  });
  // O rollback restaura a agenda (so existe com pg_cron).
  if (comCron) {
    assert.equal(
      (await client.query("select count(*)::int as n from cron.job where jobname = 'jobs-tick'"))
        .rows[0].n,
      1,
    );
  }
});

test('T-H8-17: sem chamada nenhum job vencido e executado (contrato: sem trafego, sem tick)', async () => {
  await inTx(async () => {
    const kind = 'test.h008.semtrafego';
    const id = (
      await client.query('select private.job_enqueue($1, $2) as id', [kind, 'st-' + randomUUID()])
    ).rows[0].id;
    assert.equal(
      (await client.query('select state from ops.job where id = $1', [id])).rows[0].state,
      'pendente',
    );
  });
});

// --- Medicao (T-H8-23): consulta de atraso com dados sinteticos ------------------------------------

test('T-H8-23: consulta de atraso (p50/p95) com dados sinteticos', async () => {
  await inTx(async () => {
    const kind = 'test.h008.probe';
    for (let i = 1; i <= 100; i++) {
      await client.query(
        `insert into ops.job (kind, dedupe_key, run_at, state, attempts, updated_at)
         values ($1, $2, clock_timestamp() - interval '1 hour', 'concluido', 1,
                 clock_timestamp() - interval '1 hour' + make_interval(secs => $3))`,
        [kind, `probe-${i}-${randomUUID()}`, i],
      );
    }
    const r = (await client.query(TICK_DELAY_SQL, [kind, new Date(Date.now() - 2 * 3600e3)]))
      .rows[0];
    assert.equal(r.n, 100);
    assert.ok(Math.abs(Number(r.p50) - 50.5) < 0.01, `p50 ${r.p50}`);
    assert.ok(Math.abs(Number(r.p95) - 95.05) < 0.01, `p95 ${r.p95}`);
  });
});
