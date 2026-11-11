// H-092 | Resumo cancelado quando o pedido muda antes do envio (CA-H092-10, CA-H092-11, CA-H092-09).
// Montagem: 1 aceite imediato (abre a janela de 15 min); 1 aceite pendente; o pedido muda (a regra
// marca o item como obsoleto) antes do fim da janela. Esperado: nenhum resumo sai e o cooldown NAO
// e consumido (cooldown_until fica igual). O controle positivo, sem mudanca, prova que o mesmo
// cenario sai um resumo e consome a janela. Transacoes desfeitas. Sem rede (guarda de rede ativa).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { flushGroup, processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory, StubRule } from '@fastpro/testkit';
import { guard } from './fixtures/no-network.mjs';

const NOW = '2099-01-01T12:00:00.000Z';
const iso = (s) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const INGEST_SQL =
  'select * from private.notification_ingest($1::uuid,$2,$3,$4::uuid,$5::timestamptz,$6,$7,$8::jsonb,$9,$10::integer,$11::timestamptz)';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante os testes de cancelamento');
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
  const stub = new StubRule({
    eventType: 'test.h092.cancel',
    emailTypes: ['aceite_aviso', 'aceite_resumo'],
  });
  registry.register(stub);
  const deps = { client, registry, provider, directory, clock, useDbClock: false };
  return { clock, provider, directory, stub, deps };
}

const ingest = (rec, scope, nowIso) =>
  client
    .query(INGEST_SQL, [
      rec,
      'aceite',
      scope,
      randomUUID(),
      nowIso,
      'aceite_aviso',
      'digest',
      JSON.stringify({ request_ref: scope }),
      null,
      900,
      nowIso,
    ])
    .then((r) => r.rows[0]);

const cooldownOf = async (rec) =>
  (
    await client.query(
      'select cooldown_until::text as c from ops.notification_cooldown where recipient_user_id = $1',
      [rec],
    )
  ).rows[0].c;

const resumosOf = async (rec) =>
  Number(
    (
      await client.query(
        "select count(*)::int as n from ops.email_outbox where recipient_user_id = $1 and email_type = 'aceite_resumo'",
        [rec],
      )
    ).rows[0].n,
  );

/** Monta: 1 imediato + 1 pendente, e avanca o relogio ate o fim da janela. Devolve o item pendente. */
async function montar(s, rec, scope) {
  const primeiro = await ingest(rec, scope, NOW);
  assert.equal(primeiro.out_resultado, 'enviado_agora');
  const pendente = await ingest(rec, scope, iso(100));
  assert.equal(pendente.out_resultado, 'pendente');
  s.clock.advance(900 * 1000);
  return pendente.out_item_id;
}

test('T-H92-cancel: pedido muda antes do envio do resumo -> resumo nao sai e cooldown nao e consumido', () =>
  tx(async () => {
    const s = setup();
    const rec = randomUUID();
    const scope = randomUUID();
    s.directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
    const itemPendente = await montar(s, rec, scope);
    const cooldownAntes = await cooldownOf(rec);

    s.stub.setVerdict(itemPendente, 'obsoleto'); // o pedido foi selecionado/cancelado
    await flushGroup(s.deps, { recipientUserId: rec, category: 'aceite', scopeKey: scope });

    assert.equal(s.provider.calls.length, 0, 'nenhum e-mail pode sair');
    assert.equal(await resumosOf(rec), 0, 'nenhuma linha de resumo');
    assert.equal(await cooldownOf(rec), cooldownAntes, 'cooldown nao pode ser consumido');
    const item = (
      await client.query('select state, discard_reason from ops.notification_item where id = $1', [
        itemPendente,
      ])
    ).rows[0];
    assert.equal(item.state, 'descartado');
    assert.equal(item.discard_reason, 'obsoleto');
  }));

test('T-H92-cancel (controle): sem mudanca do pedido o mesmo cenario sai um resumo e consome a janela', () =>
  tx(async () => {
    const s = setup();
    const rec = randomUUID();
    const scope = randomUUID();
    s.directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
    await montar(s, rec, scope);
    const cooldownAntes = await cooldownOf(rec);

    await flushGroup(s.deps, { recipientUserId: rec, category: 'aceite', scopeKey: scope });

    assert.equal(await resumosOf(rec), 1, 'o resumo e gravado');
    assert.notEqual(await cooldownOf(rec), cooldownAntes, 'a janela e reiniciada');
    const linha = (
      await client.query(
        "select id from ops.email_outbox where recipient_user_id = $1 and email_type = 'aceite_resumo'",
        [rec],
      )
    ).rows[0];
    await processOutbox(s.deps, linha.id, new SendPacer(s.clock));
    assert.equal(s.provider.calls.length, 1, 'o resumo sai pelo provedor simulado');
    assert.equal(s.provider.calls[0].params.count, 1, 'contagem do resumo');
  }));
