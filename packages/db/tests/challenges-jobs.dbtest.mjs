// H-011 | Agendamento do expurgo (auth.challenge.purge) e privilegio de enfileirar, contra o banco de
// desenvolvimento. Transacao com rollback. Nenhum envio; nenhuma conexao de rede externa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';
import { PgChallengeStore } from '../dist/challenges.js';
import { AuthChallengePurgeHandler } from '../dist/challenges-jobs.js';
import { challengeHmacHex } from '../dist/challenges-crypto.js';

const NOW_MS = Date.parse('2099-02-01T12:00:00.000Z');
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

test('criar desafio enfileira o expurgo do dia (job idempotente por dia)', () =>
  tx(async () => {
    const store = new PgChallengeStore(client);
    const id = '44444444-4444-4444-8444-444444444444';
    const blob = Buffer.from(randomBytes(64));
    await store.create({
      id,
      emailHash: challengeHmacHex('pepEmailTeste', 'purge@example.test'),
      purpose: 'login',
      linkHash: challengeHmacHex('pepCodeTeste', `link:${id}`),
      codeHmac: challengeHmacHex('pepCodeTeste', `${id}|000000`),
      emailEnc: blob,
      secretsEnc: blob,
      draftId: null,
      nowMs: NOW_MS,
    });
    const { rows } = await client.query(
      "select count(*)::int as n from ops.job where kind = 'auth.challenge.purge' and dedupe_key = $1",
      ['auth.challenge.purge:2099-02-01'],
    );
    assert.equal(rows[0].n, 1);
    // Segundo pedido no mesmo dia nao cria segundo expurgo (dedupe).
    await client.query('savepoint sp');
    await client.query('select private.job_enqueue($1, $2, null, null, 5)', [
      'auth.challenge.purge',
      'auth.challenge.purge:2099-02-01',
    ]);
    const depois = await client.query(
      "select count(*)::int as n from ops.job where kind = 'auth.challenge.purge' and dedupe_key = $1",
      ['auth.challenge.purge:2099-02-01'],
    );
    assert.equal(depois.rows[0].n, 1);
  }));

test('expurgo executa a funcao SQL e devolve contagens nao negativas', () =>
  tx(async () => {
    const handler = new AuthChallengePurgeHandler(client, {
      nowMs: () => NOW_MS,
      sleep: async () => {},
    });
    const rep = await handler.purge();
    assert.ok(rep.zerados >= 0 && rep.removidos >= 0);
  }));

test('app_system pode enfileirar o expurgo (funcao de job) e nao ha leitura publica', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select has_function_privilege('app_system',
        'private.job_enqueue(text,text,timestamptz,text,integer)', 'execute') as sistema,
             has_function_privilege('anon',
        'private.job_enqueue(text,text,timestamptz,text,integer)', 'execute') as anonimo`);
    assert.equal(rows[0].sistema, true);
    assert.equal(rows[0].anonimo, false);
  }));
