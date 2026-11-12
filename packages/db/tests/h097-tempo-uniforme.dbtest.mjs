// H-097 (Issue 107) | CA-07 (apoio): tempo do pedido de login com conta e sem conta, no banco de desenvolvimento.
// 40 pedidos por caso, alternados (A com conta, B sem conta). Transacao unica com rollback no fim; nada fica gravado.
// Medido: tempo de requestChallenge (ate a resposta 202). Limites do desenho 86 §5: diferenca de medianas
// <= 30 ms e diferenca de p95 <= 120 ms. Cada pedido usa um e-mail diferente (intervalo minimo por e-mail).
// Usa o caminho store.create (sem os limites de taxa de H-015), para nao consumir o contador global do banco.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/h097-tempo-uniforme.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { PgChallengeStore, requestChallenge } from '../dist/challenges.js';
import { challengeHmacHex } from '../dist/challenges-crypto.js';
import { FakeClock } from '@fastpro/testkit';

const N = 40;
const NOW_MS = Date.parse('2099-02-01T12:00:00.000Z');
const SEGREDOS = {
  key: randomBytes(32),
  pepperEmail: randomBytes(24).toString('base64url'),
  pepperCode: randomBytes(24).toString('base64url'),
};

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

function mediana(valores) {
  const s = [...valores].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** p95 pelo metodo do posto mais proximo (ceil(0,95 n)). */
function p95(valores) {
  const s = [...valores].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

test('CA-07 (apoio): 40 pedidos com conta e 40 sem conta, alternados; medianas e p95', async () => {
  await client.query('begin');
  try {
    const sufixo = randomBytes(3).toString('hex');
    const comConta = [];
    for (let i = 0; i < N; i++) {
      const email = `h097-ca07-a-${sufixo}-${i}@example.test`;
      comConta.push(email);
      await client.query(
        `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at, email_hmac)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'ativo', clock_timestamp(), clock_timestamp(), $2)`,
        [email, challengeHmacHex(SEGREDOS.pepperEmail, email)],
      );
    }

    const tempoA = [];
    const tempoB = [];
    for (let i = 0; i < N; i++) {
      for (const caso of ['A', 'B']) {
        const email =
          caso === 'A' ? comConta[i] : `h097-ca07-b-${sufixo}-${i}@example.test`;
        const store = new PgChallengeStore(client);
        const inicio = performance.now();
        const r = await requestChallenge(
          {
            store,
            secrets: SEGREDOS,
            clock: new FakeClock(new Date(NOW_MS).toISOString()),
            dispatch: { schedule: () => undefined },
          },
          { email, purpose: 'login' },
        );
        const decorrido = performance.now() - inicio;
        assert.equal(r.status, 202, 'a resposta e 202 nos dois casos');
        (caso === 'A' ? tempoA : tempoB).push(decorrido);
      }
    }

    const medA = mediana(tempoA);
    const medB = mediana(tempoB);
    const p95A = p95(tempoA);
    const p95B = p95(tempoB);
    console.log(
      `CA07 n=${N} por caso | com conta: mediana=${medA.toFixed(2)} ms p95=${p95A.toFixed(2)} ms` +
        ` | sem conta: mediana=${medB.toFixed(2)} ms p95=${p95B.toFixed(2)} ms` +
        ` | dif. medianas=${Math.abs(medA - medB).toFixed(2)} ms (limite 30) |` +
        ` dif. p95=${Math.abs(p95A - p95B).toFixed(2)} ms (limite 120)`,
    );
    assert.ok(Math.abs(medA - medB) <= 30, 'diferenca de medianas acima de 30 ms');
    assert.ok(Math.abs(p95A - p95B) <= 120, 'diferenca de p95 acima de 120 ms');
  } finally {
    await client.query('rollback');
  }
});
