// H-099 (Issue 109) | Testes de banco dos lembretes: T-H099-17 a 24 (docs/factory/163-DESENHO-H099.md §9).
// Relogio injetado (p_now): nenhum teste le o relogio do sistema nem dorme.
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before; cada teste roda num savepoint desfeito;
// rollback no after. Dados 100 % sinteticos (prefixo h099-), sem rede, sem envio.
// Exceto o T-H099-19 (concorrencia): exige conexoes reais com commit; usa datas de 2000 para que as linhas
// commitadas nunca apareçam na descoberta, e remove os jobs que criou. Linhas de pedido e de concessao nao podem
// ser apagadas (gatilhos sem_delete); ficam inertes por datas antigas.
// Executar: node --test --test-concurrency=1 packages/db/tests/reminders-h099.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import {
  HORA_MS,
  DIA_MS,
  iso,
  pedido,
  servico,
  trial,
} from './fixtures/reminders-h099.mjs';

const P = Date.parse('2099-06-10T12:00:00.000Z');
const MIN = 60 * 1000;

let client;
before(async () => {
  client = await connect();
  await client.query('begin');
});
after(async () => {
  await client.query('rollback');
  await client.end();
});

async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

/** Executa a consulta esperando erro; devolve o erro. Falha se a consulta passar. */
async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a consulta devolveu resultado');
}

async function varre(c, agoraMs) {
  return (await c.query('select private.reminder_scan($1::timestamptz) as n', [iso(agoraMs)])).rows[0].n;
}

async function jobs(c, chaves) {
  return (
    await c.query(
      'select dedupe_key, kind, run_at, payload_ref from ops.job where dedupe_key = any($1::text[]) order by dedupe_key',
      [chaves],
    )
  ).rows;
}

/** Pedido cujo prazo (acceptance_deadline_at) e prazoMs; publicado 168 h antes. */
function pedidoComPrazo(svc, prazoMs, status = 'publicado') {
  return pedido(client, {
    svc,
    base: prazoMs - 169 * HORA_MS,
    publicadoEm: prazoMs - 168 * HORA_MS,
    status,
  });
}

/** Trial que termina em fimMs. */
function trialQueTermina(fimMs, status = 'ativa') {
  return trial(client, { base: fimMs - 15 * DIA_MS, fimMs, status });
}

const k = {
  t24: (id) => `reminder:request:t24:${id}`,
  t0: (id) => `reminder:request:t0:${id}`,
  t3d: (id) => `reminder:trial:t3d:${id}`,
  trialT0: (id) => `reminder:trial:t0:${id}`,
};

test('T-H099-17 reminder_scan enfileira reminder.fire no instante exato do marco T-24h', () =>
  isolado(async () => {
    const svc = await servico(client);
    const pd = await pedidoComPrazo(svc, P + 24 * HORA_MS);
    const n = await varre(client, P);
    assert.ok(n >= 1, 'a varredura deve contar o job criado');
    const linhas = await jobs(client, [k.t24(pd.id)]);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].kind, 'reminder.fire');
    assert.equal(new Date(linhas[0].run_at).toISOString(), iso(P), 'run_at = marco exato (deadline - 24 h)');
    assert.equal(linhas[0].payload_ref, `request|t24|${pd.id}`);
  }));

test('T-H099-18 janelas: lookahead de 15 min, tolerancia de 6 h (T-24h) e 24 h (T0), limites inclusivos', () =>
  isolado(async () => {
    const svc = await servico(client);
    const casos = {
      // T-24h: marco = prazo - 24 h
      t24_mais14min: await pedidoComPrazo(svc, P + 24 * HORA_MS + 14 * MIN),
      t24_mais16min: await pedidoComPrazo(svc, P + 24 * HORA_MS + 16 * MIN),
      t24_atraso5h: await pedidoComPrazo(svc, P + 24 * HORA_MS - 5 * HORA_MS),
      t24_atraso6hExatas: await pedidoComPrazo(svc, P + 24 * HORA_MS - 6 * HORA_MS),
      t24_atraso6hMais1ms: await pedidoComPrazo(svc, P + 24 * HORA_MS - 6 * HORA_MS - 1),
      // T0: marco = prazo
      t0_atraso24hExatas: await pedidoComPrazo(svc, P - 24 * HORA_MS),
      t0_atraso24hMais1ms: await pedidoComPrazo(svc, P - 24 * HORA_MS - 1),
      t0_mais14min: await pedidoComPrazo(svc, P + 14 * MIN),
      t0_mais16min: await pedidoComPrazo(svc, P + 16 * MIN),
    };
    await varre(client, P);
    const esperado = {
      t24_mais14min: [k.t24(casos.t24_mais14min.id)],
      t24_mais16min: [],
      t24_atraso5h: [k.t24(casos.t24_atraso5h.id)],
      t24_atraso6hExatas: [k.t24(casos.t24_atraso6hExatas.id)],
      t24_atraso6hMais1ms: [],
      t0_atraso24hExatas: [k.t0(casos.t0_atraso24hExatas.id)],
      t0_atraso24hMais1ms: [],
      t0_mais14min: [k.t0(casos.t0_mais14min.id)],
      t0_mais16min: [],
    };
    for (const [nome, chaves] of Object.entries(esperado)) {
      const achados = (await jobs(client, [...Object.values(casos).flatMap((c) => [k.t24(c.id), k.t0(c.id)])]))
        .filter((j) => j.payload_ref.endsWith(casos[nome].id))
        .map((j) => j.dedupe_key);
      assert.deepEqual(achados.sort(), [...chaves].sort(), `caso ${nome}`);
    }
  }));

test('T-H099-19 reminder_scan repetida na mesma transacao: exatamente 1 job por recurso e marco', () =>
  isolado(async () => {
    const svc = await servico(client);
    const pd = await pedidoComPrazo(svc, P + 24 * HORA_MS);
    const tr = await trialQueTermina(P + 72 * HORA_MS);
    await varre(client, P);
    await varre(client, P);
    const linhas = await jobs(client, [k.t24(pd.id), k.t3d(tr.grantId)]);
    assert.equal(linhas.length, 2, 'uma linha por chave, nao duas');
  }));

test('T-H099-20 pedido selecionado ou cancelado nao aparece na varredura (controle: publicado aparece)', () =>
  isolado(async () => {
    const svc = await servico(client);
    const sel = await pedidoComPrazo(svc, P + 24 * HORA_MS, 'selecionado');
    const can = await pedidoComPrazo(svc, P + 24 * HORA_MS, 'cancelado');
    const ok = await pedidoComPrazo(svc, P + 24 * HORA_MS, 'publicado');
    await varre(client, P);
    assert.equal((await jobs(client, [k.t24(sel.id), k.t0(sel.id), k.t24(can.id), k.t0(can.id)])).length, 0);
    assert.equal((await jobs(client, [k.t24(ok.id)])).length, 1, 'controle: o publicado entra');
  }));

test('T-H099-21 trial: T-3d e T0 achados por ends_at; trial revogado fora da varredura', () =>
  isolado(async () => {
    const t3d = await trialQueTermina(P + 72 * HORA_MS);
    const t0 = await trialQueTermina(P);
    const revog = await trialQueTermina(P + 72 * HORA_MS, 'revogada');
    await varre(client, P);
    const a = await jobs(client, [k.t3d(t3d.grantId)]);
    assert.equal(a.length, 1);
    assert.equal(new Date(a[0].run_at).toISOString(), iso(P), 'T-3d = ends_at - 72 h');
    assert.equal(a[0].payload_ref, `trial|t3d|${t3d.grantId}`);
    const b = await jobs(client, [k.trialT0(t0.grantId)]);
    assert.equal(b.length, 1);
    assert.equal(new Date(b[0].run_at).toISOString(), iso(P), 'T0 = ends_at');
    assert.equal((await jobs(client, [k.t3d(revog.grantId), k.trialT0(revog.grantId)])).length, 0);
  }));

test('T-H099-22 reminder_emit grava 1 evento por marco com payload so {marco}; recurso inexistente -> ignorado', () =>
  isolado(async () => {
    const svc = await servico(client);
    const pd = await pedidoComPrazo(svc, P + 24 * HORA_MS);
    const tr = await trialQueTermina(P + 72 * HORA_MS);
    const emite = async (assunto, marco, id) =>
      (await client.query('select private.reminder_emit($1, $2, $3::uuid) as r', [assunto, marco, id])).rows[0].r;

    assert.equal(await emite('request', 't24', pd.id), 'emitido');
    assert.equal(await emite('request', 't24', pd.id), 'ja_emitido', 'reemitir o mesmo marco nao cria segundo evento');
    assert.equal(await emite('request', 't0', pd.id), 'emitido', 'T0 e outro marco do mesmo pedido');
    assert.equal(await emite('request', 't0', randomUUID()), 'ignorado');
    assert.equal(await emite('trial', 't3d', tr.grantId), 'emitido');
    assert.equal(await emite('trial', 't0', tr.grantId), 'emitido');
    assert.equal(await emite('trial', 't0', randomUUID()), 'ignorado');

    const eventos = (
      await client.query(
        `select type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload
           from ops.outbox_event where aggregate_id = any($1::uuid[]) order by type, aggregate_seq`,
        [[pd.id, tr.grantId]],
      )
    ).rows;
    assert.equal(eventos.length, 4);
    const t24 = eventos.find((e) => e.type === 'reminder.request' && Number(e.aggregate_seq) === 1);
    assert.equal(t24.aggregate_type, 'lembrete_pedido');
    assert.equal(new Date(t24.occurred_at).toISOString(), iso(P), 'occurred_at = marco T-24h');
    assert.deepEqual(t24.payload, { marco: 't24' }, 'payload so com o marco (sem PII)');
    const t3d = eventos.find((e) => e.type === 'reminder.trial' && Number(e.aggregate_seq) === 1);
    assert.equal(new Date(t3d.occurred_at).toISOString(), iso(P), 'occurred_at = ends_at - 72 h');
    assert.deepEqual(t3d.payload, { marco: 't3d' });
    const err = await erroEm('select private.reminder_emit($1, $2, $3::uuid)', ['request', 't3d', pd.id]);
    assert.match(err.message, /reminder_marco_invalido/);
  }));

test('T-H099-23 views de leitura: so as colunas do contrato; estado do trial coerente com commercial_access', () =>
  isolado(async () => {
    const svc = await servico(client);
    const pd = await pedidoComPrazo(svc, P + 24 * HORA_MS);
    const tr = await trialQueTermina(P + 72 * HORA_MS);
    const req = (await client.query('select * from private.reminder_request_view($1::uuid)', [pd.id])).rows;
    assert.equal(req.length, 1);
    assert.deepEqual(Object.keys(req[0]).sort(), [
      'acceptance_deadline_at',
      'customer_status',
      'customer_user_id',
      'request_id',
      'request_status',
    ]);
    assert.equal(req[0].request_status, 'publicado');
    assert.equal(req[0].customer_status, 'ativo');
    assert.equal(req[0].customer_user_id, pd.cliente);
    assert.equal(
      (await client.query('select * from private.reminder_request_view($1::uuid)', [randomUUID()])).rows.length,
      0,
    );

    const tv = (
      await client.query('select * from private.reminder_trial_view($1::uuid, $2::timestamptz)', [
        tr.grantId,
        iso(P),
      ])
    ).rows;
    assert.equal(tv.length, 1);
    assert.deepEqual(Object.keys(tv[0]).sort(), [
      'ends_at',
      'estado',
      'grant_id',
      'grant_status',
      'professional_user_id',
      'user_status',
    ]);
    assert.equal(tv[0].grant_status, 'ativa');
    assert.equal(tv[0].user_status, 'ativo');
    const ca = (
      await client.query('select estado from private.commercial_access($1::uuid, $2::timestamptz)', [
        tr.professionalId,
        iso(P),
      ])
    ).rows;
    assert.equal(tv[0].estado, ca[0]?.estado ?? null, 'estado da view = estado do commercial_access no mesmo instante');
  }));

test('T-H099-24 privilegios: anon, authenticated, service_role e app_api nao executam as funcoes novas', async () => {
  const funcoes = [
    'private.reminder_request_view(uuid)',
    'private.reminder_trial_view(uuid,timestamp with time zone)',
    'private.reminder_scan(timestamp with time zone)',
    'private.reminder_emit(text,text,uuid)',
  ];
  for (const f of funcoes) {
    for (const papel of ['anon', 'authenticated', 'service_role', 'app_api']) {
      const r = await client.query('select has_function_privilege($1, $2, $3) as ok', [papel, f, 'EXECUTE']);
      assert.equal(r.rows[0].ok, false, `${papel} nao pode executar ${f}`);
    }
    const sistema = await client.query('select has_function_privilege($1, $2, $3) as ok', [
      'app_system',
      f,
      'EXECUTE',
    ]);
    assert.equal(sistema.rows[0].ok, true, `app_system executa ${f}`);
  }
});

test('T-H099-19 (concorrencia real, duas conexoes): exatamente 1 job por recurso e marco', async () => {
  // Dados commitados em 2000: a varredura no instante 2000 os enxerga, e a descoberta real (relogio de hoje) nao.
  const C2000 = Date.parse('2000-06-10T12:00:00.000Z');
  const admin = await connect();
  const c1 = await connect();
  const c2 = await connect();
  const chaves = [];
  try {
    // Uma transacao so: grupo e servico precisam estar juntos no commit (gatilho de catalogo).
    await admin.query('begin');
    const svc = await servico(admin);
    for (let i = 0; i < 4; i += 1) {
      const pd = await pedido(admin, {
        svc,
        base: C2000 - 169 * HORA_MS,
        publicadoEm: C2000 + 24 * HORA_MS - 168 * HORA_MS - i,
      });
      chaves.push(k.t24(pd.id));
    }
    const tr = await trial(admin, { base: C2000 - 15 * DIA_MS, fimMs: C2000 + 72 * HORA_MS });
    chaves.push(k.t3d(tr.grantId));
    await admin.query('commit');

    await Promise.all([varre(c1, C2000), varre(c2, C2000), varre(c1, C2000), varre(c2, C2000)]);

    const contagem = (
      await admin.query(
        'select dedupe_key, count(*)::int as n from ops.job where dedupe_key = any($1::text[]) group by dedupe_key',
        [chaves],
      )
    ).rows;
    assert.equal(contagem.length, chaves.length, 'todas as chaves enfileiradas');
    for (const linha of contagem) assert.equal(linha.n, 1, `chave ${linha.dedupe_key} com um job so`);
  } finally {
    await admin.query('delete from ops.job where dedupe_key = any($1::text[])', [chaves]);
    await Promise.all([c1.end(), c2.end(), admin.end()]);
  }
});

