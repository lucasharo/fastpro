// H-092 | Testes de integracao do motor com o provedor simulado (desenho 35 §10: T-H92-30..38).
// Cada teste roda numa transacao desfeita (rollback). O relogio e controlado (FakeClock em 2099-01-01,
// isolado dos dados reais). Provedor simulado: nenhuma conexao de rede. fetch e bloqueado no setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import {
  dispatchOutbox,
  processOutbox,
  PgNotificationStore,
  SendPacer,
} from '../dist/notifications.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory, StubRule } from '@fastpro/testkit';

globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes (H-092)');
};

const NOW = '2099-01-01T12:00:00.000Z';
const DAY = '2099-01-01';
const MONTH = '2099-01-01';
const SYNTH_EMAIL = 'sintetico@teste.invalid';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

function setup() {
  const clock = new FakeClock(NOW);
  const provider = new FakeEmailProvider();
  const directory = new FakeRecipientDirectory();
  const registry = new NotificationRuleRegistry();
  registry.register(
    new StubRule({
      eventType: 'test.h092.aceite',
      emailTypes: ['aceite_aviso', 'aceite_resumo'],
      resolve: (ev) => [
        {
          recipientUserId: String(ev.payload.recipient),
          category: 'aceite',
          emailType: 'aceite_aviso',
          mailClass: 'digest',
          scopeKey: String(ev.payload.scope),
          templateParams: { request_ref: String(ev.payload.scope) },
        },
      ],
    }),
  );
  const deps = { client, registry, provider, directory, clock, useDbClock: false };
  return { clock, provider, directory, registry, deps, pacer: new SendPacer(clock) };
}

const stubOf = (s) => s.registry.forEvent('test.h092.aceite');

async function recipient(s) {
  const rec = randomUUID();
  s.directory.set(rec, { status: 'ok', email: SYNTH_EMAIL });
  return rec;
}

// Linha de envio direta (sem itens): envio simples, para testar o motor de envio.
async function insertRow({
  rec,
  cls = 'auth',
  category = 'acesso',
  emailType = 'acesso_login',
  params = {},
}) {
  const r = await client.query(
    'insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params, ' +
      'dedupe_key, next_attempt_at, created_at) values ($1, $2, $3, $4, $4, $5::jsonb, $6, $7::timestamptz, $7::timestamptz) returning id',
    [rec, category, cls, emailType, JSON.stringify(params), `test.h092.m:${randomUUID()}`, NOW],
  );
  return r.rows[0].id;
}

async function rowOf(id) {
  return (
    await client.query(
      'select state, attempts, reason_code, quota_reserved, next_attempt_at::text as next, provider, dedupe_key from ops.email_outbox where id = $1',
      [id],
    )
  ).rows[0];
}

async function setQuota(period, start, used) {
  const [soft, hard, reserved] = period === 'dia_utc' ? [90, 100, 10] : [2700, 3000, 300];
  await client.query(
    'insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth) ' +
      "values ('email', $1, $2::date, $3, $4, $5, $6) on conflict (service, period, period_start) do update set used = excluded.used",
    [period, start, used, soft, hard, reserved],
  );
}

async function usedOf(period, start) {
  const r = await client.query(
    "select used from ops.external_quota where service = 'email' and period = $1 and period_start = $2::date",
    [period, start],
  );
  return r.rows[0]?.used ?? null;
}

test('T-H92-30: evento -> item -> linha -> aceito (fluxo completo, CA-01 e CA-03)', () =>
  tx(async () => {
    const s = setup();
    stubOf(s); // regra registrada
    const rec = await recipient(s);
    const ev = randomUUID();
    await client.query(
      'insert into ops.outbox_event (id, type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload) ' +
        "values ($1, 'test.h092.aceite', 'test_h092', $2, 1, $3::timestamptz, $4::jsonb)",
      [ev, randomUUID(), NOW, JSON.stringify({ recipient: rec, scope: randomUUID() })],
    );
    const d = await dispatchOutbox(s.deps);
    assert.equal(d.falhas, 0);
    const disp = (
      await client.query(
        'select dispatched_at is not null as ok from ops.outbox_event where id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(disp.ok, true);
    const item = (
      await client.query(
        'select id, state, outbox_id from ops.notification_item where source_event_id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(item.state, 'enviado');
    await processOutbox(s.deps, item.outbox_id, s.pacer);
    assert.equal(s.provider.calls.length, 1);
    assert.equal(s.provider.calls[0].to, SYNTH_EMAIL);
    const row = await rowOf(item.outbox_id);
    assert.equal(row.state, 'enviado');
    assert.equal(row.provider, 'simulado');
    assert.equal(await usedOf('dia_utc', DAY), 1);
  }));

test('T-H92-31: limite_taxa devolve a cota, volta a pendente e respeita o retryAfter (CA-22)', () =>
  tx(async () => {
    const s = setup();
    const rec = await recipient(s);
    const id = await insertRow({ rec });
    s.provider.queue({ kind: 'limite_taxa', retryAfterSeconds: 120 });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'pendente');
    assert.equal(row.quota_reserved, false);
    assert.equal(row.attempts, 0);
    assert.equal(row.reason_code, 'limite_taxa');
    assert.equal(new Date(row.next).toISOString(), '2099-01-01T12:02:00.000Z');
    assert.equal(await usedOf('dia_utc', DAY), 0);
  }));

test('T-H92-32: indisponivel 8 vezes vira falha; recusa permanente vira falha; cota devolvida nos dois casos', () =>
  tx(async () => {
    const s = setup();
    const rec = await recipient(s);
    const id = await insertRow({ rec });
    s.provider.queue(
      ...Array.from({ length: 8 }, () => ({ kind: 'indisponivel', code: 'timeout' })),
    );
    for (let i = 1; i <= 8; i += 1) {
      if (i > 1) s.clock.advance(3601 * 1000);
      await processOutbox(s.deps, id, s.pacer);
      const row = await rowOf(id);
      if (i < 8) {
        assert.equal(row.state, 'pendente', `tentativa ${i}`);
        assert.equal(row.attempts, i);
      }
    }
    const fim = await rowOf(id);
    assert.equal(fim.state, 'falha');
    assert.equal(fim.reason_code, 'timeout');
    assert.equal(fim.quota_reserved, false);
    assert.equal(await usedOf('dia_utc', DAY), 0);

    const outra = await insertRow({ rec });
    s.provider.queue({ kind: 'recusa_permanente', code: 'validation_error' });
    await processOutbox(s.deps, outra, s.pacer);
    const recusado = await rowOf(outra);
    assert.equal(recusado.state, 'falha');
    assert.equal(recusado.reason_code, 'validation_error');
    assert.equal(await usedOf('dia_utc', DAY), 0);
  }));

test('T-H92-33: nao_configurado mantem a linha pendente, sem gastar tentativa (N-10)', () =>
  tx(async () => {
    const s = setup();
    const rec = await recipient(s);
    const id = await insertRow({ rec });
    s.provider.queue({ kind: 'nao_configurado', code: 'dominio_nao_verificado' });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'pendente');
    assert.equal(row.attempts, 0);
    assert.equal(row.reason_code, 'dominio_nao_verificado');
    assert.equal(new Date(row.next).toISOString(), '2099-01-01T13:00:00.000Z');
    assert.equal(await usedOf('dia_utc', DAY), 0);
  }));

test('T-H92-34: cota 90/dia e 2.700/mes: auth passa; critico vira adiado_cota; no dia seguinte sai (CA-17..21, Q-10, Q-11)', () =>
  tx(async () => {
    const s = setup();
    const rec = await recipient(s);
    await setQuota('dia_utc', DAY, 90);
    await setQuota('mes', MONTH, 0);

    const critico = await insertRow({
      rec,
      cls: 'critico',
      category: 'selecao',
      emailType: 'selecao',
      params: { request_ref: randomUUID() },
    });
    await processOutbox(s.deps, critico, s.pacer);
    const adiado = await rowOf(critico);
    assert.equal(adiado.state, 'adiado_cota');
    assert.equal(adiado.reason_code, 'cota_dia');
    assert.equal(adiado.attempts, 0);
    assert.equal(new Date(adiado.next).toISOString(), '2099-01-02T00:00:00.000Z');
    assert.equal(s.provider.calls.length, 0);

    const auth = await insertRow({ rec });
    await processOutbox(s.deps, auth, s.pacer);
    assert.equal((await rowOf(auth)).state, 'enviado');
    assert.equal(await usedOf('dia_utc', DAY), 91);

    // Mes: dia livre, mes no corte do critico (2.700) -> bloqueio por mes com proximo horario do mes.
    await setQuota('dia_utc', DAY, 0);
    await setQuota('mes', MONTH, 2700);
    const critico2 = await insertRow({
      rec,
      cls: 'critico',
      category: 'selecao',
      emailType: 'selecao',
      params: { request_ref: randomUUID() },
    });
    await processOutbox(s.deps, critico2, s.pacer);
    const porMes = await rowOf(critico2);
    assert.equal(porMes.state, 'adiado_cota');
    assert.equal(porMes.reason_code, 'cota_mes');
    assert.equal(new Date(porMes.next).toISOString(), '2099-02-01T00:00:00.000Z');
    const authMes = await insertRow({ rec });
    await processOutbox(s.deps, authMes, s.pacer);
    assert.equal((await rowOf(authMes)).state, 'enviado');

    // Dia seguinte: a linha adiada (ainda valida, sem itens) sai quando o mes volta a ter folga.
    s.clock.advance(24 * 3600 * 1000);
    await setQuota('mes', MONTH, 0);
    await processOutbox(s.deps, critico, s.pacer);
    assert.equal((await rowOf(critico)).state, 'enviado');
  }));

test(
  'T-H92-35: cota esgotada nao afeta o chat (NAO_VERIFICADO: o dominio de chat ainda nao existe no banco)',
  {
    skip: 'NAO_VERIFICADO: tabelas de chat e mensagem ainda nao existem (H-059/H-066 e seguintes)',
  },
  () => {},
);

test('T-H92-37: item valido no flush e obsoleto no envio -> descartado, sem chamar o provedor (CA-10, CA-11)', () =>
  tx(async () => {
    const s = setup();
    stubOf(s);
    const rec = await recipient(s);
    const scope = randomUUID();
    const ing = (
      await client.query(
        'select * from private.notification_ingest($1::uuid,$2,$3,$4::uuid,$5::timestamptz,$6,$7,$8::jsonb,$9,$10::integer,$11::timestamptz)',
        [
          rec,
          'aceite',
          scope,
          randomUUID(),
          NOW,
          'aceite_aviso',
          'digest',
          JSON.stringify({ request_ref: scope }),
          null,
          900,
          NOW,
        ],
      )
    ).rows[0];
    assert.equal(ing.out_resultado, 'enviado_agora');
    s.registry.forEmailType('aceite_aviso');
    stubOf(s).setVerdict(ing.out_item_id, 'obsoleto');
    await processOutbox(s.deps, ing.out_outbox_id, s.pacer);
    assert.equal(s.provider.calls.length, 0);
    assert.equal((await rowOf(ing.out_outbox_id)).state, 'descartado');
    const item = (
      await client.query('select state, discard_reason from ops.notification_item where id = $1', [
        ing.out_item_id,
      ])
    ).rows[0];
    assert.equal(item.state, 'descartado');
    assert.equal(item.discard_reason, 'obsoleto');
    assert.equal(await usedOf('dia_utc', DAY), null);
  }));

test('T-H92-38: falha depois da reserva: a segunda execucao nao reserva de novo e usa a mesma chave de idempotencia', () =>
  tx(async () => {
    const s = setup();
    const rec = await recipient(s);
    const id = await insertRow({ rec });
    // Simula a queda: reivindica e reserva, mas nao chega ao provedor nem grava o resultado.
    await client.query('select * from private.email_outbox_claim($1::uuid, $2::timestamptz)', [
      id,
      NOW,
    ]);
    const reserva = (
      await client.query(
        'select * from private.email_outbox_reservar_cota($1::uuid, 100, 3000, $2::timestamptz)',
        [id, NOW],
      )
    ).rows[0];
    assert.equal(reserva.out_permitido, true);
    assert.equal(await usedOf('dia_utc', DAY), 1);

    // O lease de 60 s vence; a nova execucao retoma a linha.
    s.clock.advance(61 * 1000);
    await processOutbox(s.deps, id, s.pacer);
    assert.equal(await usedOf('dia_utc', DAY), 1, 'nao pode reservar de novo');
    assert.equal(s.provider.calls.length, 1);
    assert.equal(s.provider.calls[0].idempotencyKey, (await rowOf(id)).dedupe_key);
    assert.equal((await rowOf(id)).state, 'enviado');
  }));

test('T-H92-39: nenhum teste faz chamada de rede (fetch bloqueado no setup do arquivo)', () => {
  assert.throws(() => globalThis.fetch(), /rede bloqueada/);
});

// Mantem a classe do armazenamento exercitada (nao so o motor): leitura de itens por linha.
test('armazenamento: itens de uma linha so aparecem enquanto enviados', () =>
  tx(async () => {
    const s = setup();
    const store = new PgNotificationStore(s.deps);
    const rec = await recipient(s);
    const scope = randomUUID();
    const ing = (
      await client.query(
        'select * from private.notification_ingest($1::uuid,$2,$3,$4::uuid,$5::timestamptz,$6,$7,$8::jsonb,$9,$10::integer,$11::timestamptz)',
        [
          rec,
          'aceite',
          scope,
          randomUUID(),
          NOW,
          'aceite_aviso',
          'digest',
          JSON.stringify({ request_ref: scope }),
          null,
          900,
          NOW,
        ],
      )
    ).rows[0];
    const itens = await store.itemsOfOutbox(ing.out_outbox_id);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].mailClass, 'digest');
  }));
