// H-011 | Store Pg do desafio (PgChallengeStore) contra o banco de desenvolvimento. Transacao com
// rollback. Valores sinteticos; nenhuma conexao de rede externa; nenhum envio.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';
import { PgChallengeStore } from '../dist/challenges.js';
import {
  challengeAad,
  challengeHmacHex,
  challengeSha256Hex,
  sealChallengeBlob,
} from '../dist/challenges-crypto.js';

const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const key = randomBytes(32);
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

function entrada(emailHash, id = randomUUID(), nowMs = NOW_MS) {
  return {
    id,
    emailHash,
    purpose: 'login',
    linkHash: challengeSha256Hex(`t:${id}`),
    codeHmac: challengeHmacHex('pepCodeTeste', `${id}|123456`),
    emailEnc: sealChallengeBlob(key, 'cliente@example.test', challengeAad(id, 'email_enc')),
    secretsEnc: sealChallengeBlob(
      key,
      JSON.stringify({ token: 't', code: '123456' }),
      challengeAad(id, 'secrets_enc'),
    ),
    draftId: null,
    nowMs,
  };
}

test('store Pg: criacao, leitura ativa, entrega e segundo pedido com espera', () =>
  tx(async () => {
    const store = new PgChallengeStore(client);
    const emailHash = challengeHmacHex('pepEmailTeste', 'store@example.test');
    const primeiro = entrada(emailHash);
    const criado = await store.create(primeiro);
    assert.equal(criado.resultado, 'criado');
    assert.equal(criado.challengeId, primeiro.id);
    assert.match(criado.outboxId, /^[0-9a-f-]{36}$/);

    const linha = await store.findRow(primeiro.id, NOW_MS + 1000);
    assert.equal(linha.active, true);
    assert.equal(linha.delivered, false);
    assert.ok(Buffer.isBuffer(linha.emailEnc));
    assert.ok(linha.emailEnc.equals(primeiro.emailEnc));

    const expirada = await store.findRow(primeiro.id, NOW_MS + 15 * 60 * 1000);
    assert.equal(expirada.active, false);

    await store.markDelivered(primeiro.id, NOW_MS + 2000);
    const entregue = await store.findRow(primeiro.id, NOW_MS + 3000);
    assert.equal(entregue.delivered, true);
    assert.equal(entregue.secretsEnc, null);

    const segundo = await store.create(entrada(emailHash, randomUUID(), NOW_MS + 30_000));
    assert.equal(segundo.resultado, 'espera');
    assert.equal(segundo.retryAfterSeconds, 30);
    assert.equal(await store.findRow(randomUUID(), NOW_MS), null);
  }));
