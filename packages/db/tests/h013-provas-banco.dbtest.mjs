// H-013 (Issue #26) | Provas de banco que estavam bloqueadas ate a migracao 20261112130000 entrar no banco:
//   T-H013-01 (parte de banco): pedido com cookie grava o SHA-256 do cookie no desafio.   [transacao + rollback]
//   T-H013-12 (atomicidade): anexacao falha => consumo desfeito, codigo volta a valer.      [transacao + rollback]
//   T-H013-20 (anexacao): 20 codigos corretos simultaneos => 1 ok, anexacao exatamente 1 vez. [commit real + limpeza]
//   T-H013-21 (anexacao x edicao): 20 rodadas, anexacao e troca de e-mail em paralelo.       [commit real + limpeza]
// Dados sinteticos (@example.test e hashes aleatorios). Cada prova roda sozinha com --test-name-pattern.
// Rodar: node --test --test-concurrency=1 --test-name-pattern="T-H013-12" packages/db/tests/h013-provas-banco.dbtest.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { PgChallengeStore, requestChallenge, challengeHmacHex } from '../dist/index.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const rnd = () => randomBytes(12).toString('hex');
const iso = (ms) => new Date(ms).toISOString();
const PEPPER_EMAIL = 'pepper-email-h13-' + rnd();
const PEPPER_CODE = 'pepper-code-h13-' + rnd();
const CODIGO = '654321';
const SEGREDOS = { key: Buffer.alloc(32, 7), pepperEmail: PEPPER_EMAIL, pepperCode: PEPPER_CODE };
const LIMITE = 50;
const ATTEMPT = 'select * from private.auth_code_attempt_attach($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)';
const IDENT = 'select * from private.draft_identity_set($1, $2::timestamptz, $3, $4, $5)';

// Todas as conexoes abertas pelas provas: fechadas ao fim do arquivo.
const abertas = [];
async function abrir() {
  const c = await connect();
  abertas.push(c);
  return c;
}
after(async () => {
  await Promise.allSettled(abertas.map((c) => c.end()));
});

/** Desafio sintetico vivo com nonce e e-mail; codigo calculado como a verificacao calcula. */
async function inserirDesafio(c, { id = randomUUID(), emailHash, nonce, agora }) {
  await c.query(
    `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc,
       browser_nonce_hash, expires_at, created_at)
     values ($1, $2, 'publish', $3, $4, $5, $6, $7, $8, $9)`,
    [id, emailHash, sha('tok-' + id), challengeHmacHex(PEPPER_CODE, `${id}|${CODIGO}`), Buffer.from('e'), Buffer.from('s'),
      nonce, iso(agora + 15 * 60000), iso(agora)],
  );
  return id;
}

async function inserirRascunho(c, { nonce, emailHmac, status = 'aguardando_email', agora }) {
  const r = await c.query(
    `insert into app.request_draft (browser_nonce_hash, ip_hmac, status, expires_at, created_at, updated_at,
       email, email_hmac)
     values ($1, $2, $3, $4, $5, $5, 'a@example.test', $6) returning id`,
    [nonce, sha('ip-h13'), status, iso(agora + 7 * 86400000), iso(agora), emailHmac],
  );
  return r.rows[0].id;
}

const lerRascunho = async (c, id) =>
  (await c.query('select status, email_hmac, email_verified_at from app.request_draft where id = $1', [id])).rows[0];

// ---------------------------------------------------------------------------------------------------
test('T-H013-01 (banco): pedido com cookie grava o SHA-256 do cookie no desafio', async () => {
  const c = await abrir();
  await c.query('begin');
  try {
    const cookie = 'cookie-sintetico-' + rnd() + rnd() + rnd();
    const nonce = sha(cookie);
    const email = `cliente-${rnd()}@example.test`;
    const r = await requestChallenge(
      {
        store: new PgChallengeStore(c),
        secrets: SEGREDOS,
        clock: { nowMs: () => Date.now(), sleep: async () => undefined },
        dispatch: { schedule: () => undefined },
      },
      { email, purpose: 'publish' },
      '127.0.0.1',
      { browserNonceHash: nonce },
    );
    assert.equal(r.status, 202);
    const linha = (
      await c.query('select browser_nonce_hash from app.auth_challenge where email_hash = $1', [challengeHmacHex(PEPPER_EMAIL, email)])
    ).rows[0];
    assert.equal(linha.browser_nonce_hash, nonce, 'nonce = SHA-256 do cookie');
    assert.match(linha.browser_nonce_hash, /^[0-9a-f]{64}$/);
    // Sem cookie, o desafio nasce sem nonce (fecha para o lado seguro).
    const email2 = `sem-cookie-${rnd()}@example.test`;
    await requestChallenge(
      { store: new PgChallengeStore(c), secrets: SEGREDOS, clock: { nowMs: () => Date.now(), sleep: async () => undefined }, dispatch: { schedule: () => undefined } },
      { email: email2, purpose: 'publish' },
      '127.0.0.1',
      { browserNonceHash: null },
    );
    const sem = (
      await c.query('select browser_nonce_hash from app.auth_challenge where email_hash = $1', [challengeHmacHex(PEPPER_EMAIL, email2)])
    ).rows[0];
    assert.equal(sem.browser_nonce_hash, null);
  } finally {
    await c.query('rollback');
  }
});

// ---------------------------------------------------------------------------------------------------
test('T-H013-12 (atomicidade): anexacao que falha desfaz o consumo; o codigo segue valendo', async () => {
  const c = await abrir();
  await c.query('begin');
  try {
    const agora = Date.now();
    const cookie = sha('cookie-atomico-' + rnd());
    const emailHash = sha('email-atomico-' + rnd());
    const desafio = await inserirDesafio(c, { emailHash, nonce: cookie, agora });
    const rascunho = await inserirRascunho(c, { nonce: cookie, emailHmac: emailHash, agora });
    const chave = { ip: sha('ip-' + rnd()), email: sha('em-' + rnd()) };
    const args = [desafio, emailHash, 'publish', challengeHmacHex(PEPPER_CODE, `${desafio}|${CODIGO}`), 5, iso(agora + 1000), chave.ip, chave.email, LIMITE, LIMITE, cookie];

    // Forca a falha: um gatilho que recusa qualquer escrita no rascunho (so dentro desta transacao).
    await c.query(`create or replace function public.h13_forca_falha() returns trigger language plpgsql as $$
      begin raise exception 'forcado_h13' using errcode = 'P0001'; end $$`);
    await c.query('create trigger h13_forca_falha before update on app.request_draft for each row execute function public.h13_forca_falha()');

    await c.query('savepoint antes');
    let erro = null;
    try {
      await c.query(ATTEMPT, args);
    } catch (e) {
      erro = e;
    }
    assert.ok(erro, 'a anexacao com falha forcada levanta erro');
    await c.query('rollback to savepoint antes');

    const consumido = (await c.query('select consumed_at, attempts from app.auth_challenge where id = $1', [desafio])).rows[0];
    assert.equal(consumido.consumed_at, null, 'consumo desfeito junto com a anexacao');
    assert.equal(consumido.attempts, 0);
    const depois = await lerRascunho(c, rascunho);
    assert.equal(depois.email_verified_at, null, 'rascunho intacto');

    // Sem a falha, o mesmo codigo ainda vale e anexa.
    await c.query('drop trigger h13_forca_falha on app.request_draft');
    const ok = (await c.query(ATTEMPT, args)).rows[0];
    assert.equal(ok.out_resultado, 'ok');
    assert.equal(ok.out_attached, true);
  } finally {
    await c.query('rollback');
  }
});

// ---------------------------------------------------------------------------------------------------
const limpezaRodada = async (c, { desafios, rascunhos, ips, emails }) => {
  await c.query('delete from app.auth_challenge where id = any($1::uuid[])', [desafios]);
  await c.query('delete from app.request_draft where id = any($1::uuid[])', [rascunhos]);
  await c.query('delete from ops.rate_counter where key_hmac = any($1::text[])', [[...ips, ...emails]]);
  await c.query('delete from ops.code_lock where key_hmac = any($1::text[])', [emails]);
};

test('T-H013-20 (anexacao): 20 codigos corretos simultaneos => 1 ok e anexacao exatamente 1 vez', async () => {
  const admin = await abrir();
  const conexoes = [];
  for (let i = 0; i < 20; i++) conexoes.push(await abrir());
  const agora = Date.now();
  const cookie = sha('cookie-uso-unico-' + rnd());
  const emailHash = sha('email-uso-unico-' + rnd());
  const ips = [sha('ip-uu-' + rnd())];
  const emails = [sha('em-uu-' + rnd())];
  const desafio = await inserirDesafio(admin, { emailHash, nonce: cookie, agora });
  const rascunho = await inserirRascunho(admin, { nonce: cookie, emailHmac: emailHash, agora });
  try {
    const codeHmac = challengeHmacHex(PEPPER_CODE, `${desafio}|${CODIGO}`);
    const linhas = await Promise.all(
      conexoes.map((c) => c.query(ATTEMPT, [desafio, emailHash, 'publish', codeHmac, 5, iso(agora + 1000), ips[0], emails[0], LIMITE, LIMITE, cookie]).then((r) => r.rows[0])),
    );
    assert.equal(linhas.filter((l) => l.out_resultado === 'ok').length, 1, 'exatamente um ok');
    assert.equal(linhas.filter((l) => l.out_attached === true).length, 1, 'anexacao exatamente 1 vez');
    assert.equal(linhas.filter((l) => l.out_resultado === 'invalido').length, 19);
    const d = await lerRascunho(admin, rascunho);
    assert.notEqual(d.email_verified_at, null);
    assert.equal(d.status, 'aberto');
  } finally {
    await limpezaRodada(admin, { desafios: [desafio], rascunhos: [rascunho], ips, emails });
  }
});

// ---------------------------------------------------------------------------------------------------
test('T-H013-21 (anexacao x edicao): 20 rodadas em paralelo; nunca confirmado com e-mail diferente do desafio', async () => {
  const admin = await abrir();
  const c1 = await abrir();
  const c2 = await abrir();
  const desafios = [];
  const rascunhos = [];
  const ips = [];
  const emails = [];
  const resumo = { anexou: 0, trocou_antes: 0 };
  try {
    for (let i = 0; i < 20; i++) {
      const agora = Date.now();
      const cookie = sha('cookie-21-' + i + '-' + rnd());
      const emailHash = sha('email-21-' + i + '-' + rnd());
      const emailNovo = sha('novo-21-' + i + '-' + rnd());
      const ip = sha('ip-21-' + i + '-' + rnd());
      const em = sha('em-21-' + i + '-' + rnd());
      ips.push(ip);
      emails.push(em);
      const desafio = await inserirDesafio(admin, { emailHash, nonce: cookie, agora });
      desafios.push(desafio);
      const rascunho = await inserirRascunho(admin, { nonce: cookie, emailHmac: emailHash, agora });
      rascunhos.push(rascunho);
      const codeHmac = challengeHmacHex(PEPPER_CODE, `${desafio}|${CODIGO}`);
      const [anexa, troca] = await Promise.all([
        c1.query(ATTEMPT, [desafio, emailHash, 'publish', codeHmac, 5, iso(agora + 1000), ip, em, LIMITE, LIMITE, cookie]).then((r) => r.rows[0]),
        c2.query(IDENT, [cookie, iso(agora + 1000), 'Bia', 'novo@example.test', emailNovo]).then((r) => r.rows[0]),
      ]);
      if (anexa.out_attached) resumo.anexou += 1;
      if (troca && troca.out_email_verified === false) resumo.trocou_antes += 1;
      // Invariante: verificado so com o e-mail do desafio; desafio consumido se houve anexacao.
      const d = await lerRascunho(admin, rascunho);
      if (d.email_verified_at !== null) {
        assert.equal(d.email_hmac, emailHash, `rodada ${i}: confirmado com e-mail diferente do desafio`);
      }
      assert.equal(d.email_hmac, emailNovo, `rodada ${i}: a troca de e-mail sempre prevalece no campo`);
      if (anexa.out_attached) {
        const ch = (await admin.query('select consumed_at from app.auth_challenge where id = $1', [desafio])).rows[0];
        assert.notEqual(ch.consumed_at, null);
      }
    }
    assert.equal(desafios.length, 20);
  } finally {
    await limpezaRodada(admin, { desafios, rascunhos, ips, emails });
  }
});
