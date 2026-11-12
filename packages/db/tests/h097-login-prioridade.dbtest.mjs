// H-097 (Issue 107) | Prioridade do login e cota no banco de desenvolvimento (T-H097-01, 02, 03 e 04).
// Executado no banco de desenvolvimento (APP_ENV=development) com: node --test --test-concurrency=1 <este arquivo>.
// Cada teste roda em transacao com rollback; relogio fixo em 2099; sem rede (provedor simulado).
// Desenho: docs/factory/86-DESENHO-H097.md §2 e §5. Resultado e contagem: relatorio da Issue 107.
// T-H097-07 (parte F-1) e T-H097-08 usam a regra de conta da migracao 20261112100000 (email_hmac). Antes de
// executar, a migracao precisa estar aplicada no banco de desenvolvimento (ver relatorio da Issue 107).
// Fora deste arquivo (pendente): aceite adiado a 90 (critico) e digest a 85, que dependem da ingestao de eventos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { challengeHmacHex } from '../dist/challenges-crypto.js';
import {
  ChallengeEmailProvider,
  ChallengeRecipientDirectory,
  PgChallengeStore,
  dispatchChallengeOutbox,
  requestChallenge,
} from '../dist/challenges.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';

const DIA = '2099-02-01';
const AMANHA = '2099-02-02T00:00:00.000Z';
const NOW_MS = Date.parse('2099-02-01T12:00:00.000Z');
const PIMENTA_EMAIL = randomBytes(24).toString('base64url');
const PIMENTA_CODIGO = randomBytes(24).toString('base64url');
const SITE = 'https://fastpro.example.test';
const KEY = randomBytes(32);
const SEGREDOS = {
  secrets: {
    key: KEY,
    pepperEmail: PIMENTA_EMAIL,
    pepperCode: PIMENTA_CODIGO,
  },
};

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

/** Guarda o resultado do create para saber o id da saida criada pelo pedido. */
class StoreCapturado extends PgChallengeStore {
  ultimo = null;
  async create(input) {
    const r = await super.create(input);
    this.ultimo = r;
    return r;
  }
}

async function semearCota(usadoDia) {
  await client.query(
    `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit)
     values ('email', 'dia_utc', $1, $2, 90, 100)
     on conflict (service, period, period_start) do update set used = excluded.used`,
    [DIA, usadoDia],
  );
  await client.query(
    `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit)
     values ('email', 'mes', '2099-02-01', 10, 2700, 3000)
     on conflict (service, period, period_start) do nothing`,
  );
}

/** Conta do cliente com o HMAC do e-mail (como o consumo grava; F-1). E-mail sintetico, minusculo. */
async function criarConta(email) {
  const hmac = challengeHmacHex(SEGREDOS.secrets.pepperEmail, email);
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at, email_hmac)
     values (gen_random_uuid(), $1, gen_random_uuid(), ativo, clock_timestamp(), clock_timestamp(), $2)`,
    [email, hmac],
  );
}

/** Pedido real (segredos cifrados de verdade). Devolve o id da saida criada. */
async function pedir(nowMs, email, purpose) {
  const store = new StoreCapturado(client);
  const r = await requestChallenge(
    {
      store,
      ...SEGREDOS,
      clock: new FakeClock(new Date(nowMs).toISOString()),
      dispatch: { schedule: () => undefined },
    },
    { email, purpose },
  );
  assert.equal(r.status, 202);
  return store.ultimo.outboxId;
}

/** Login de uma conta cadastrada criada na propria transacao. */
async function criarDesafio(nowMs, email = `h097-${randomBytes(4).toString('hex')}@example.test`) {
  await criarConta(email);
  return pedir(nowMs, email, 'login');
}

/** Pipeline de envio com o provedor simulado por baixo do decorador do login. */
function pipeline(provedor, nowMs) {
  const clock = new FakeClock(new Date(nowMs).toISOString());
  const store = new PgChallengeStore(client);
  const diretorioBase = new FakeRecipientDirectory();
  const provider = new ChallengeEmailProvider(provedor, store, { key: KEY, siteUrl: SITE, clock });
  return {
    client,
    registry: new NotificationRuleRegistry(),
    provider,
    directory: new ChallengeRecipientDirectory(diretorioBase, store, KEY, clock),
    clock,
    useDbClock: false,
  };
}

async function usoDoDia(dia) {
  const q = await client.query(
    "select used from ops.external_quota where service = 'email' and period = 'dia_utc' and period_start = $1",
    [dia],
  );
  return q.rows[0]?.used ?? null;
}

test('T-H097-01: 200 saidas de aceite e digest pendentes na fila; o login vai ao provedor antes de todas', () =>
  tx(async () => {
    await semearCota(0);
    await client.query(
      `insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, dedupe_key, template_params)
       select gen_random_uuid(),
              case when g <= 100 then 'aceite' else 'mensagem' end,
              'digest',
              case when g <= 100 then 'aceite_resumo' else 'mensagem_resumo' end,
              case when g <= 100 then 'aceite_resumo' else 'mensagem_resumo' end,
              'h097-t01-' || g,
              '{}'::jsonb
         from generate_series(1, 200) as g`,
    );
    const pendentesAntes = await contarPendentesT01();
    assert.equal(pendentesAntes, 200);

    const email = `h097-t01-${randomBytes(4).toString('hex')}@example.test`;
    await criarConta(email);
    const saida = await pedir(NOW_MS, email, 'login');

    // Envio logo apos a resposta: so a linha do login e reivindicada, sem varrer a fila.
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);

    assert.equal(provedor.calls.length, 1, 'so o login foi ao provedor');
    assert.equal(provedor.calls[0].templateKey, 'acesso_login', 'o primeiro envio e o login');
    assert.equal(await contarPendentesT01(), 200, 'as 200 saidas continuam pendentes');
    const login = await client.query('select state from ops.email_outbox where id = $1', [saida]);
    assert.equal(login.rows[0].state, 'enviado');
  }));

async function contarPendentesT01() {
  const q = await client.query(
    "select count(*)::int as n from ops.email_outbox where dedupe_key like 'h097-t01-%' and state = 'pendente'",
  );
  return q.rows[0].n;
}

test('T-H097-07 (F-1): login sem conta: 202, saida descartada (conta_inexistente), provedor nao chamado, cota intacta', () =>
  tx(async () => {
    await semearCota(0);
    const email = `h097-sem-conta-${randomBytes(4).toString('hex')}@example.test`;
    const saida = await pedir(NOW_MS, email, 'login');
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);
    assert.equal(provedor.calls.length, 0);
    const r = await client.query('select state, reason_code from ops.email_outbox where id = $1', [saida]);
    assert.equal(r.rows[0].state, 'descartado');
    assert.equal(r.rows[0].reason_code, 'conta_inexistente');
    assert.equal(await usoDoDia(DIA), 0);
  }));

test('T-H097-08: finalidade publish sem conta envia (a conta nasce no consumo)', () =>
  tx(async () => {
    await semearCota(0);
    const email = `h097-publish-${randomBytes(4).toString('hex')}@example.test`;
    const saida = await pedir(NOW_MS, email, 'publish');
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);
    assert.equal(provedor.calls.length, 1);
    const r = await client.query('select state from ops.email_outbox where id = $1', [saida]);
    assert.equal(r.rows[0].state, 'enviado');
  }));

test('T-H097-02: uso do dia 50, o login sai e o contador passa a 51', () =>
  tx(async () => {
    await semearCota(50);
    const saida = await criarDesafio(NOW_MS);
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);
    assert.equal(provedor.calls.length, 1);
    assert.equal(await usoDoDia(DIA), 51);
  }));

test('T-H097-03: dia em 100, o login espera; o provedor nao e chamado; proxima tentativa em 00:00 UTC do dia seguinte', () =>
  tx(async () => {
    await semearCota(100);
    const saida = await criarDesafio(NOW_MS);
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);
    assert.equal(provedor.calls.length, 0);
    const r = await client.query('select state, next_attempt_at from ops.email_outbox where id = $1', [saida]);
    assert.equal(r.rows[0].state, 'adiado_cota');
    assert.equal(new Date(r.rows[0].next_attempt_at).toISOString(), AMANHA);
  }));

test('T-H097-03 (dia 90): o login ainda sai e o contador vai a 91', () =>
  tx(async () => {
    await semearCota(90);
    const saida = await criarDesafio(NOW_MS);
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, NOW_MS), saida);
    assert.equal(provedor.calls.length, 1);
    assert.equal(await usoDoDia(DIA), 91);
  }));

test('T-H097-04: virada com desafio vivo envia uma vez e conta no dia novo; desafio vencido vira descartado sem cota', () =>
  tx(async () => {
    await semearCota(100);
    const vivo = await criarDesafio(Date.parse('2099-02-01T23:50:00.000Z'));
    const vencido = await criarDesafio(Date.parse('2099-02-01T22:00:00.000Z'));

    // Virada: 00:01 do dia seguinte. O desafio vivo (vence 00:05) ainda vale; o vencido (22:15) nao.
    const depoisDaVirada = Date.parse('2099-02-02T00:01:00.000Z');
    const provedor = new FakeEmailProvider();
    await dispatchChallengeOutbox(pipeline(provedor, depoisDaVirada), vivo);
    assert.equal(provedor.calls.length, 1);
    assert.equal(await usoDoDia('2099-02-02'), 1);

    const antes = await usoDoDia('2099-02-02');
    await dispatchChallengeOutbox(pipeline(provedor, depoisDaVirada), vencido);
    assert.equal(provedor.calls.length, 1, 'desafio vencido nao chama o provedor');
    const estado = await client.query('select state from ops.email_outbox where id = $1', [vencido]);
    assert.equal(estado.rows[0].state, 'descartado');
    assert.equal(await usoDoDia('2099-02-02'), antes, 'cota intacta para o vencido');
  }));
