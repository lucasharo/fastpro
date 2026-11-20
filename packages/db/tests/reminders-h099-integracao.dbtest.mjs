// H-099 (Issue 109) | Integracao ponta a ponta dos lembretes: T-H099-25 a 30 (docs/factory/163-DESENHO-H099.md §9).
// Fluxo: private.reminder_scan -> reminder.fire (ReminderFireHandler) -> outbox.dispatch -> email.send (processOutbox).
// Cada teste roda numa transacao desfeita (rollback); dados 100 % sinteticos (fixtures h099-). Relogio injetado
// (FakeClock), provedor simulado (FakeEmailProvider), diretorio simulado. Nenhum e-mail real, nenhuma chamada
// de rede (fetch bloqueado), nenhum consumo da cota real (a cota e preenchida dentro da transacao).
// Fora deste arquivo: T-H099-28 (trial que virou pago) depende de concessao paga (fatia 7 / Issues #60 a #63 e
// desenho §8: sem fixtures de paid) e T-H099-33 (check:all) roda no fechamento, nao nesta fatia.
// Executar: node --test --test-concurrency=1 packages/db/tests/reminders-h099-integracao.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';
import { guard } from './fixtures/no-network.mjs';
import { HORA_MS, DIA_MS, iso, pedido, servico, trial } from './fixtures/reminders-h099.mjs';
import {
  dispatchOutbox,
  processOutbox,
  PgNotificationStore,
  SendPacer,
} from '../dist/notifications.js';
import { ReminderFireHandler, PgReminderSource } from '../dist/reminders.js';
import {
  NotificationRuleRegistry,
  PrazoNotificationRule,
  TrialNotificationRule,
  QUOTA_CUTS,
} from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';

globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes dos lembretes (H-099)');
};

const SYNTH_EMAIL = 'sintetico@teste.invalid';
const OK = { status: 'ok', email: SYNTH_EMAIL };
const P0 = Date.parse('2099-06-10T12:00:00.000Z'); // publicacao do pedido (relogio sintetico de 2099)
const T24 = P0 + 144 * HORA_MS; // marco do pedido: prazo - 24 h
const T0 = P0 + 168 * HORA_MS; // prazo do pedido (acceptance_deadline_at)
const FIM = Date.parse('2099-07-01T12:00:00.000Z'); // fim do trial sintetico
const T3D = FIM - 72 * HORA_MS; // trial: marco T-3d
const TRIAL_T0 = FIM; // trial: marco T0

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
  if (guard.denied.length > 0) throw new Error('tentativa de rede real durante os testes dos lembretes');
});

/** Transacao desfeita ao fim: nada do teste persiste no banco de desenvolvimento. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

function montaDeps(agoraMs) {
  const clock = new FakeClock(iso(agoraMs));
  const provider = new FakeEmailProvider();
  const directory = new FakeRecipientDirectory();
  const source = new PgReminderSource(client);
  const registry = new NotificationRuleRegistry();
  // ReminderClock das regras e uma funcao que devolve o instante ISO (relogio injetado, nunca o do sistema).
  const relogio = () => iso(clock.nowMs());
  registry.register(new PrazoNotificationRule(source, relogio));
  registry.register(new TrialNotificationRule(source, relogio));
  const deps = { client, registry, provider, directory, clock, useDbClock: false };
  return { deps, clock, provider, directory, pacer: new SendPacer(clock) };
}

/** Varredura no instante informado; devolve os jobs reminder.fire criados para as referencias pedidas. */
async function varre(agoraMs, refs) {
  await client.query('select private.reminder_scan($1::timestamptz) as n', [iso(agoraMs)]);
  return (
    await client.query(
      "select id, payload_ref from ops.job where kind = 'reminder.fire' and payload_ref = any($1::text[]) order by payload_ref",
      [refs],
    )
  ).rows;
}

/** reminder.fire (um por job) seguido do despacho do outbox. */
async function dispara(deps, jobs) {
  const handler = new ReminderFireHandler(client);
  for (const j of jobs) await handler.run({ payload_ref: j.payload_ref });
  return dispatchOutbox(deps);
}

async function linhaDo(dedupeKey) {
  return (
    await client.query(
      'select id, state, reason_code, template, class from ops.email_outbox where dedupe_key = $1',
      [dedupeKey],
    )
  ).rows[0];
}

/** Envio da linha (email.send). Devolve a linha depois do envio. */
async function envia(deps, pacer, dedupeKey) {
  const row = await linhaDo(dedupeKey);
  assert.ok(row, `linha de envio ausente para ${dedupeKey}`);
  await processOutbox(deps, row.id, pacer);
  return linhaDo(dedupeKey);
}

test('T-H099-25 pedido: scan -> fire -> dispatch -> envio a T-24 h com relogio em 6 d', () =>
  tx(async () => {
    const { deps, provider, directory, pacer } = montaDeps(T24);
    const svc = await servico(client);
    const p = await pedido(client, { svc, base: P0 - 2 * HORA_MS, publicadoEm: P0 });
    directory.set(p.cliente, OK);
    const jobs = await varre(T24, [`request|t24|${p.id}`]);
    assert.equal(jobs.length, 1, 'um job reminder.fire para o marco');
    await dispara(deps, jobs);
    const linha = await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    assert.equal(linha.state, 'enviado');
    assert.equal(linha.template, 'prazo_t24');
    assert.equal(provider.calls.length, 1, 'um unico envio');
    assert.equal(provider.calls[0].templateKey, 'prazo_t24');
    assert.equal(provider.calls[0].idempotencyKey, `req:prazo_t24:${p.id}`);
  }));

test('T-H099-26a pedido: envio a T0 (prazo encerrado) com relogio em 7 d', () =>
  tx(async () => {
    const { deps, provider, directory, pacer } = montaDeps(T0);
    const svc = await servico(client);
    const p = await pedido(client, { svc, base: P0 - 2 * HORA_MS, publicadoEm: P0 });
    directory.set(p.cliente, OK);
    const jobs = await varre(T0, [`request|t0|${p.id}`]);
    assert.equal(jobs.length, 1);
    await dispara(deps, jobs);
    const linha = await envia(deps, pacer, `req:prazo_t0:${p.id}`);
    assert.equal(linha.state, 'enviado');
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].templateKey, 'prazo_t0');
  }));

test('T-H099-26b trial: T-3d e T0 enviam um e-mail cada, com a classe lembrete', () =>
  tx(async () => {
    const prof = await trial(client, { base: FIM - 15 * 24 * HORA_MS, fimMs: FIM });
    // T-3d (relogio em 11 d)
    {
      const { deps, provider, directory, pacer } = montaDeps(T3D);
      directory.set(prof.professionalId, OK);
      const jobs = await varre(T3D, [`trial|t3d|${prof.grantId}`]);
      assert.equal(jobs.length, 1);
      await dispara(deps, jobs);
      const linha = await envia(deps, pacer, `trial:t3d:${prof.grantId}`);
      assert.equal(linha.state, 'enviado');
      assert.equal(linha.class, 'lembrete');
      assert.equal(provider.calls.length, 1);
      assert.equal(provider.calls[0].templateKey, 'acesso_trial_t3d');
    }
    // T0 (relogio em 14 d): o mesmo trial, outra chave de envio
    {
      const { deps, provider, directory, pacer } = montaDeps(TRIAL_T0);
      directory.set(prof.professionalId, OK);
      const jobs = await varre(TRIAL_T0, [`trial|t0|${prof.grantId}`]);
      assert.equal(jobs.length, 1);
      await dispara(deps, jobs);
      const linha = await envia(deps, pacer, `trial:t0:${prof.grantId}`);
      assert.equal(linha.state, 'enviado');
      assert.equal(provider.calls.length, 1);
      assert.equal(provider.calls[0].templateKey, 'acesso_trial_t0');
    }
  }));

test('T-H099-27 pedido selecionado entre o fire e o envio: descartado, nenhum e-mail', () =>
  tx(async () => {
    const { deps, provider, directory, pacer } = montaDeps(T24);
    const svc = await servico(client);
    const p = await pedido(client, { svc, base: P0 - 2 * HORA_MS, publicadoEm: P0 });
    directory.set(p.cliente, OK);
    await dispara(deps, await varre(T24, [`request|t24|${p.id}`]));
    await client.query("update app.service_request set status = 'selecionado' where id = $1", [p.id]);
    const linha = await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    assert.equal(linha.state, 'descartado');
    assert.equal(linha.reason_code, 'sem_item_valido');
    assert.equal(provider.calls.length, 0, 'nenhum envio');
  }));

test('T-H099-29 duplo disparo do mesmo marco: uma linha de envio e um envio', () =>
  tx(async () => {
    const { deps, provider, directory, pacer } = montaDeps(T24);
    const svc = await servico(client);
    const p = await pedido(client, { svc, base: P0 - 2 * HORA_MS, publicadoEm: P0 });
    directory.set(p.cliente, OK);
    const refs = [`request|t24|${p.id}`];
    // Varredura repetida: o mesmo job (dedupe_key do marco) nao se duplica.
    await varre(T24, refs);
    const jobs = await varre(T24, refs);
    assert.equal(jobs.length, 1, 'varredura repetida nao duplica o job');
    // Reexecucao do fire e do despacho: eventos novos, uma unica linha de envio.
    await dispara(deps, jobs);
    await dispara(deps, jobs);
    const total = (
      await client.query('select count(*)::int as n from ops.email_outbox where dedupe_key = $1', [
        `req:prazo_t24:${p.id}`,
      ])
    ).rows[0].n;
    assert.equal(total, 1, 'uma linha de envio por dedupe_key');
    await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    assert.equal(provider.calls.length, 1, 'um unico envio mesmo com reenvio do job');
  }));

test('T-H099-30 cota do dia da classe lembrete em 70: adiado_cota; no dia seguinte, obsoleto sem envio', () =>
  tx(async () => {
    const { deps, clock, provider, directory, pacer } = montaDeps(T24);
    const svc = await servico(client);
    const p = await pedido(client, { svc, base: P0 - 2 * HORA_MS, publicadoEm: P0 });
    directory.set(p.cliente, OK);
    // Preenche a cota do dia (70) com linhas sinteticas da classe lembrete, reservadas no mesmo relogio.
    const store = new PgNotificationStore(deps);
    const corte = QUOTA_CUTS.lembrete;
    let usado = 0;
    for (let i = 0; i < corte.dia; i += 1) {
      const r = await client.query(
        "insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params, " +
          "dedupe_key, next_attempt_at, created_at) values ($1, 'prazo', 'lembrete', 'prazo_t24', 'prazo_t24', " +
          "'{}'::jsonb, $2, $3::timestamptz, $3::timestamptz) returning id",
        [p.cliente, `h099-cota:${p.id}:${i}`, iso(T24)],
      );
      const res = await store.reserveQuota(r.rows[0].id, corte.dia, corte.mes);
      usado = res.usadoDia;
    }
    assert.equal(usado, corte.dia, 'cota do dia cheia');
    // Marco T-24 h: a cota bloqueia, a linha fica adiada (nenhum envio).
    await dispara(deps, await varre(T24, [`request|t24|${p.id}`]));
    const adiada = await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    assert.equal(adiada.state, 'adiado_cota');
    assert.equal(provider.calls.length, 0);
    // Dia seguinte: o prazo ja venceu (T0); a linha e revalidada e vira obsoleto, sem envio atrasado.
    clock.advance(DIA_MS);
    const depois = await envia(deps, pacer, `req:prazo_t24:${p.id}`);
    assert.equal(depois.state, 'descartado');
    assert.equal(depois.reason_code, 'sem_item_valido');
    assert.equal(provider.calls.length, 0, 'nenhum envio atrasado');
  }));
