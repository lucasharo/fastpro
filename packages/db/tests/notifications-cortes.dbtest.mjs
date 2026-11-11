// H-092 | Cortes de cota no caminho real do envio (processOutbox consulta o corte da classe da linha).
// aceite e mensagem (classe digest) param em 85/dia e 2.550/mes; lembrete em 70/dia e 2.100/mes.
// Transacoes desfeitas, relogio em 2099-01-01 (isolado). Sem rede (guarda de rede ativa).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry, QUOTA_CUTS } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory, StubRule } from '@fastpro/testkit';
import { guard } from './fixtures/no-network.mjs';

const NOW = '2099-01-01T12:00:00.000Z';
const DAY = '2099-01-01';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante os testes de cortes');
});

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function setQuota(period, used) {
  const [soft, hard, reserved] = period === 'dia_utc' ? [90, 100, 10] : [2700, 3000, 300];
  await client.query(
    'insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth) ' +
      "values ('email', $1, $2::date, $3, $4, $5, $6) on conflict (service, period, period_start) do update set used = excluded.used",
    [period, DAY, used, soft, hard, reserved],
  );
}

/** Envia uma linha de classe dada e devolve o estado e o motivo gravados. */
async function enviar(rec, { category, cls, emailType, s }) {
  const id = (
    await client.query(
      'insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params, dedupe_key, next_attempt_at) ' +
        'values ($1, $2, $3, $4, $4, $5::jsonb, $6, $7::timestamptz) returning id',
      [
        rec,
        category,
        cls,
        emailType,
        JSON.stringify({ request_ref: randomUUID() }),
        `test.h092.corte:${randomUUID()}`,
        NOW,
      ],
    )
  ).rows[0].id;
  await processOutbox(s.deps, id, new SendPacer(s.clock));
  return (await client.query('select state, reason_code from ops.email_outbox where id = $1', [id]))
    .rows[0];
}

function setup() {
  const clock = new FakeClock(NOW);
  const provider = new FakeEmailProvider();
  const directory = new FakeRecipientDirectory();
  const registry = new NotificationRuleRegistry();
  registry.register(new StubRule({ eventType: 'test.h092.corte', emailTypes: ['aceite_aviso'] }));
  return {
    clock,
    provider,
    deps: { client, registry, provider, directory, clock, useDbClock: false },
  };
}

for (const category of ['aceite', 'mensagem']) {
  test(`T-H92-cortes (${category}, classe digest): corte 85/dia e 2.550/mes no envio real`, () =>
    tx(async () => {
      const s = setup();
      const rec = randomUUID();
      s.deps.directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
      const emailType = category === 'aceite' ? 'aceite_resumo' : 'mensagem_resumo';
      assert.deepEqual(QUOTA_CUTS.digest, { dia: 85, mes: 2550 });

      await setQuota('dia_utc', 85);
      await setQuota('mes', 0);
      assert.deepEqual(await enviar(rec, { category, cls: 'digest', emailType, s }), {
        state: 'adiado_cota',
        reason_code: 'cota_dia',
      });

      await setQuota('dia_utc', 84);
      assert.equal((await enviar(rec, { category, cls: 'digest', emailType, s })).state, 'enviado');

      await setQuota('dia_utc', 0);
      await setQuota('mes', 2550);
      assert.deepEqual(await enviar(rec, { category, cls: 'digest', emailType, s }), {
        state: 'adiado_cota',
        reason_code: 'cota_mes',
      });

      await setQuota('mes', 2549);
      assert.equal((await enviar(rec, { category, cls: 'digest', emailType, s })).state, 'enviado');
    }));
}

test('T-H92-cortes (lembrete): corte 70/dia e 2.100/mes no envio real', () =>
  tx(async () => {
    const s = setup();
    const rec = randomUUID();
    s.deps.directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
    assert.deepEqual(QUOTA_CUTS.lembrete, { dia: 70, mes: 2100 });

    await setQuota('dia_utc', 70);
    await setQuota('mes', 0);
    assert.deepEqual(
      await enviar(rec, { category: 'prazo', cls: 'lembrete', emailType: 'prazo_t24', s }),
      { state: 'adiado_cota', reason_code: 'cota_dia' },
    );

    await setQuota('dia_utc', 69);
    assert.equal(
      (await enviar(rec, { category: 'prazo', cls: 'lembrete', emailType: 'prazo_t24', s })).state,
      'enviado',
    );

    await setQuota('dia_utc', 0);
    await setQuota('mes', 2100);
    assert.deepEqual(
      await enviar(rec, { category: 'prazo', cls: 'lembrete', emailType: 'prazo_t24', s }),
      { state: 'adiado_cota', reason_code: 'cota_mes' },
    );

    await setQuota('mes', 2099);
    assert.equal(
      (await enviar(rec, { category: 'prazo', cls: 'lembrete', emailType: 'prazo_t24', s })).state,
      'enviado',
    );
  }));
