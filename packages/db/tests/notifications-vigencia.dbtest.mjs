// H-100 | Testes de vigencia do despachante (Issue 110; docs/factory/49-DESENHO-H100.md, §2).
// T-H100-07: evento anterior ao marco (2026-11-11T00:00:00Z) so recebe dispatched_at: nenhum item,
// linha de envio ou chamada ao provedor. No limite exato, o evento e processado normalmente.
// T-H100-08: contraprova: evento valido depois do marco, com provedor simulado, gera exatamente 1 chamada.
// Cada teste roda numa transacao desfeita. Provedor simulado; a guarda de rede bloqueia as demais conexoes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { guard } from './fixtures/no-network.mjs';
import { dispatchOutbox, processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory, StubRule } from '@fastpro/testkit';

after(() => {
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante os testes de vigencia');
});

const NOW = '2099-01-01T12:00:00.000Z';
const ANTES_DO_MARCO = '2026-11-10T23:59:59.000Z';
const NO_MARCO = '2026-11-11T00:00:00.000Z';
const SYNTH_EMAIL = 'sintetico@teste.invalid';
const EVENT_TYPE = 'test.h100.aceite';

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
      eventType: EVENT_TYPE,
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
  return { provider, directory, deps, pacer: new SendPacer(clock) };
}

/** Insere um evento de outbox com instante de ocorrencia dado; devolve o id e o destinatario. */
async function evento(ocorrido, s) {
  const rec = randomUUID();
  s.directory.set(rec, { status: 'ok', email: SYNTH_EMAIL });
  const ev = randomUUID();
  await client.query(
    'insert into ops.outbox_event (id, type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload) ' +
      'values ($1, $2, $3, $4, 1, $5::timestamptz, $6::jsonb)',
    [
      ev,
      EVENT_TYPE,
      'test_h100',
      randomUUID(),
      ocorrido,
      JSON.stringify({ recipient: rec, scope: randomUUID() }),
    ],
  );
  return { ev, rec };
}

test('T-H100-07: evento antes do marco so recebe dispatched_at (sem item, linha ou envio)', () =>
  tx(async () => {
    const s = setup();
    const { ev, rec } = await evento(ANTES_DO_MARCO, s);
    const d = await dispatchOutbox(s.deps);
    assert.equal(d.falhas, 0);
    const disp = (
      await client.query(
        'select dispatched_at is not null as ok from ops.outbox_event where id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(disp.ok, true);
    const itens = (
      await client.query(
        'select count(*)::int as n from ops.notification_item where source_event_id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(itens.n, 0);
    const linhas = (
      await client.query(
        'select count(*)::int as n from ops.email_outbox where recipient_user_id = $1',
        [rec],
      )
    ).rows[0];
    assert.equal(linhas.n, 0);
    assert.equal(s.provider.calls.length, 0);
  }));

test('T-H100-07 (limite): evento em 2026-11-11T00:00:00Z gera 1 item e 1 linha de envio', () =>
  tx(async () => {
    const s = setup();
    const { ev, rec } = await evento(NO_MARCO, s);
    const d = await dispatchOutbox(s.deps);
    assert.equal(d.falhas, 0);
    const itens = (
      await client.query(
        'select count(*)::int as n from ops.notification_item where source_event_id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(itens.n, 1);
    const linhas = (
      await client.query(
        'select count(*)::int as n from ops.email_outbox where recipient_user_id = $1',
        [rec],
      )
    ).rows[0];
    assert.equal(linhas.n, 1);
  }));

test('T-H100-08: contraprova, evento valido apos o marco envia exatamente 1 vez ao provedor simulado', () =>
  tx(async () => {
    const s = setup();
    const { ev } = await evento(NO_MARCO, s);
    await dispatchOutbox(s.deps);
    const item = (
      await client.query(
        'select state, outbox_id from ops.notification_item where source_event_id = $1',
        [ev],
      )
    ).rows[0];
    assert.equal(item.state, 'enviado');
    await processOutbox(s.deps, item.outbox_id, s.pacer);
    assert.equal(s.provider.calls.length, 1);
    assert.equal(s.provider.calls[0].to, SYNTH_EMAIL);
  }));
