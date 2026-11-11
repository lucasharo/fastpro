// H-093 | Integracao do pipeline com os codigos de provedor de e-mail (desenho 37 §3.3, §5).
// Provedor simulado (FakeEmailProvider) com o nome do adaptador: nenhuma conexao de rede, nenhum envio real.
// Cada teste roda numa transacao desfeita (rollback). fetch global e bloqueado no setup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { guard } from './fixtures/no-network.mjs';

after(() => {
  if (guard.denied.length > 0)
    throw new Error('tentativa de rede real durante os testes de e-mail');
});
import { processOutbox, SendPacer } from '../dist/notifications.js';
import { NotificationRuleRegistry } from '@fastpro/domain';
import { FakeClock, FakeEmailProvider, FakeRecipientDirectory } from '@fastpro/testkit';

globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes (H-093)');
};

const NOW = '2099-01-01T12:00:00.000Z';

/** Provedor simulado que se apresenta com o nome de um adaptador (resend). */
class NamedProvider extends FakeEmailProvider {
  constructor(name) {
    super();
    this.name = name;
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

function setup(provider) {
  const clock = new FakeClock(NOW);
  const directory = new FakeRecipientDirectory();
  const rec = randomUUID();
  directory.set(rec, { status: 'ok', email: 'sintetico@teste.invalid' });
  const deps = {
    client,
    registry: new NotificationRuleRegistry(),
    provider,
    directory,
    clock,
    useDbClock: false,
  };
  return { rec, deps, pacer: new SendPacer(clock) };
}

async function insertRow(rec) {
  const r = await client.query(
    'insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params, ' +
      'dedupe_key, next_attempt_at, created_at) values ($1, $2, $3, $4, $4, $5::jsonb, $6, $7::timestamptz, $7::timestamptz) returning id',
    [rec, 'acesso', 'auth', 'acesso_login', '{}', `test.h093.m:${randomUUID()}`, NOW],
  );
  return r.rows[0].id;
}

async function rowOf(id) {
  return (
    await client.query(
      'select state, attempts, reason_code, provider, provider_message_id from ops.email_outbox where id = $1',
      [id],
    )
  ).rows[0];
}

test('T-H93-01: aceito pelo adaptador Resend grava o provedor resend (CA-H093-03)', () =>
  tx(async () => {
    const provider = new NamedProvider('resend');
    const s = setup(provider);
    const id = await insertRow(s.rec);
    provider.queue({ kind: 'aceito', providerMessageId: '<id@fastpro.invalid>' });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'enviado');
    assert.equal(row.provider, 'resend');
    assert.equal(provider.calls.length, 1);
  }));

test('T-H93-02: aceito pelo adaptador Resend grava o provedor resend (CA-H093-02)', () =>
  tx(async () => {
    const provider = new NamedProvider('resend');
    const s = setup(provider);
    const id = await insertRow(s.rec);
    provider.queue({ kind: 'aceito', providerMessageId: 're_ficticio_1' });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'enviado');
    assert.equal(row.provider, 'resend');
  }));

test('T-H93-03: segredo_ausente deixa a linha pendente sem gastar tentativa (CA-H093-06)', () =>
  tx(async () => {
    const provider = new NamedProvider('resend');
    const s = setup(provider);
    const id = await insertRow(s.rec);
    provider.queue({ kind: 'nao_configurado', code: 'segredo_ausente' });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'pendente');
    assert.equal(row.attempts, 0);
    assert.equal(row.reason_code, 'segredo_ausente');
  }));

test('T-H93-04: destinatario_nao_permitido e falha definitiva imediata, sem nova tentativa', () =>
  tx(async () => {
    const provider = new NamedProvider('resend');
    const s = setup(provider);
    const id = await insertRow(s.rec);
    provider.queue({ kind: 'recusa_permanente', code: 'destinatario_nao_permitido' });
    await processOutbox(s.deps, id, s.pacer);
    const row = await rowOf(id);
    assert.equal(row.state, 'falha');
    assert.equal(row.reason_code, 'destinatario_nao_permitido');
    assert.equal(provider.calls.length, 1);
  }));
