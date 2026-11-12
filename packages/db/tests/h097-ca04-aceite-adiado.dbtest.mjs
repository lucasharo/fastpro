// H-097 (Issue 107) | CA-04 no banco de desenvolvimento: contador do dia em 90; chega um aceite (classe digest,
// corte 85) e um pedido de login (corte 100). O aceite fica adiado_cota e nao sai; o login sai e o contador vai a 91.
// Transacao com rollback. Desenho: docs/factory/86-DESENHO-H097.md §2; criterio CA-04 da 83-REFINO-H097.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/h097-ca04-aceite-adiado.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import {
  ChallengeEmailProvider,
  ChallengeRecipientDirectory,
  PgChallengeStore,
  dispatchChallengeOutbox,
  requestChallenge,
} from '../dist/challenges.js';
import { processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';
import { challengeHmacHex } from '../dist/challenges-crypto.js';

const DIA = '2099-02-01';
const AMANHA = '2099-02-02T00:00:00.000Z';
const NOW_MS = Date.parse('2099-02-01T12:00:00.000Z');
const SITE = 'https://fastpro.example.test';
const KEY = randomBytes(32);
const PIMENTA_EMAIL = randomBytes(24).toString('base64url');
const PIMENTA_CODIGO = randomBytes(24).toString('base64url');

/** Guarda o resultado do create para saber o id da saida do login. */
class CapturaStore extends PgChallengeStore {
  ultimo = null;
  async create(input) {
    const r = await super.create(input);
    this.ultimo = r;
    return r;
  }
}

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

/** Cota do dia em `usado` e do mes em 10 (linha criada se faltar). */
async function semearCota(usado) {
  await client.query(
    `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit)
     values ('email', 'dia_utc', $1, $2, 90, 100)
     on conflict (service, period, period_start) do update set used = excluded.used`,
    [DIA, usado],
  );
  await client.query(
    `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit)
     values ('email', 'mes', '2099-02-01', 10, 2700, 3000)
     on conflict (service, period, period_start) do nothing`,
  );
}

async function usoDoDia() {
  const q = await client.query(
    "select used from ops.external_quota where service = 'email' and period = 'dia_utc' and period_start = $1",
    [DIA],
  );
  return q.rows[0]?.used ?? null;
}

/** Pipeline de envio: provedor simulado por baixo do decorador do login; diretorio com o destinatario do aceite. */
function pipeline(provedor, base) {
  const clock = new FakeClock(new Date(NOW_MS).toISOString());
  const store = new PgChallengeStore(client);
  return {
    d: {
      client,
      registry: new NotificationRuleRegistry(),
      provider: new ChallengeEmailProvider(provedor, store, {
        key: KEY,
        siteUrl: SITE,
        clock,
      }),
      directory: new ChallengeRecipientDirectory(base, store, KEY, clock),
      clock,
      useDbClock: false,
    },
  };
}

test('CA-04: contador em 90; aceite (digest, corte 85) fica adiado_cota e nao sai; login (corte 100) sai e o contador vai a 91', () =>
  tx(async () => {
    await semearCota(90);

    // 1. Aceite gerado com o contador em 90: linha de classe digest, destinatario com endereco conhecido.
    const destinatario = '00000000-0000-4000-8000-0000000ca004';
    await client.query(
      `insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, dedupe_key, template_params)
       values ($1, 'aceite', 'digest', 'aceite_resumo', 'aceite_resumo', 'h097-ca04-aceite-1', '{}'::jsonb)`,
      [destinatario],
    );
    const aceite = await client.query(
      "select id from ops.email_outbox where dedupe_key = 'h097-ca04-aceite-1'",
    );
    const aceiteId = aceite.rows[0].id;
    const base = new FakeRecipientDirectory().set(destinatario, {
      status: 'ok',
      email: 'aceite.ca04@example.test',
    });
    const provedor = new FakeEmailProvider();
    const { d } = pipeline(provedor, base);
    await processOutbox(d, aceiteId, new SendPacer(d.clock));

    const estadoAceite = await client.query(
      'select state, next_attempt_at from ops.email_outbox where id = $1',
      [aceiteId],
    );
    assert.equal(estadoAceite.rows[0].state, 'adiado_cota', 'aceite fica adiado pela cota de 85');
    assert.equal(
      new Date(estadoAceite.rows[0].next_attempt_at).toISOString(),
      AMANHA,
      'espera a virada UTC',
    );
    assert.equal(provedor.calls.length, 0, 'aceite nao chega ao provedor');
    assert.equal(await usoDoDia(), 90, 'o aceite adiado nao gasta cota');

    // 2. Login nesse mesmo momento (corte 100): conta cadastrada com o HMAC do e-mail, pedido real e envio.
    const emailLogin = "login.ca04@example.test";
    await client.query(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at, email_hmac)
       values (gen_random_uuid(), $1, gen_random_uuid(), 'ativo', clock_timestamp(), clock_timestamp(), $2)`,
      [emailLogin, challengeHmacHex(PIMENTA_EMAIL, emailLogin)],
    );
    const store = new CapturaStore(client);
    const r = await requestChallenge(
      {
        store,
        secrets: { key: KEY, pepperEmail: PIMENTA_EMAIL, pepperCode: PIMENTA_CODIGO },
        clock: new FakeClock(new Date(NOW_MS).toISOString()),
        dispatch: { schedule: () => undefined },
      },
      { email: emailLogin },
    );
    assert.equal(r.status, 202);
    await dispatchChallengeOutbox(d, store.ultimo.outboxId);

    assert.equal(provedor.calls.length, 1, "so o login foi ao provedor");
    assert.equal(provedor.calls[0].templateKey, "acesso_login");
    assert.equal(await usoDoDia(), 91, "o contador vai a 91 com o login");
    const depoisAceite = await client.query("select state from ops.email_outbox where id = $1", [aceiteId]);
    assert.equal(depoisAceite.rows[0].state, "adiado_cota", "o aceite continua adiado");
  }));
