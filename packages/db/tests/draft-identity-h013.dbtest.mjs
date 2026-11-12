// H-013 (Issue #26) | Codigo de 6 digitos, nonce do navegador e anexacao do rascunho (docs/factory/91-DESENHO-H013.md, §6).
// Provas de banco: T-H013-02, 08, 09, 10, 11, 13 e 22 (parcial), 14 (parte de banco). Concorrencia (19 a 21) fica
// para a rodada com varias conexoes e limpeza. Migracao aplicada DENTRO da transacao e desfeita com rollback.
// Dados sinteticos (@example.test). Nada persiste no banco de desenvolvimento.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/draft-identity-h013.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const ler = (nome) => readFileSync(join(REPO_ROOT, 'supabase', 'migrations', nome), 'utf8');
const BASE = [
  '20261111140000_identity_create_auth_challenge.sql',
  '20261111170000_identity_create_rate_limits.sql',
  '20261111440000_draft_create_request_draft.sql',
];
const MIGRACAO = ler('20261112130000_draft_expand_identity_attach.sql');
const DESFAZER = readFileSync(
  join(REPO_ROOT, 'supabase', 'rollbacks', '20261112130000_draft_expand_identity_attach.down.sql'),
  'utf8',
)
  .replace(/^begin;\s*$/gm, '')
  .replace(/^commit;\s*$/gm, '');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const COOKIE = sha('cookie-do-navegador-A');
const COOKIE_B = sha('cookie-do-navegador-B');
const EMAIL = 'cliente@example.test';
const EMAIL_HMAC = sha('hmac-do-email-cliente');
const OUTRO_HMAC = sha('hmac-de-outro-email');
const IP = sha('ip-sintetico');
const CODE_HMAC = sha('codigo-sintetico');

/** Transacao de teste: aplica a base e a migracao, e desfaz tudo no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    for (const nome of BASE) await client.query(ler(nome));
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Erro esperado dentro de savepoint: devolve o erro e mantem a transacao utilizavel. */
async function erroEm(sql, params = []) {
  await client.query('savepoint sp_erro');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
  return null;
}

/** Desafio sintetico: com e-mail (hash) e nonce opcional; consumido ou vivo. */
async function criarDesafio({ nonce = null, emailHash = EMAIL_HMAC, consumido = false } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc,
       browser_nonce_hash, expires_at, created_at, consumed_at)
     values ($1, $2, 'publish', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, emailHash, sha('token-' + id), CODE_HMAC, Buffer.from('e'), Buffer.from('s'), nonce,
      iso(T0 + 15 * 60000), iso(T0), consumido ? iso(T0 + 1000) : null],
  );
  return id;
}

/** Rascunho sintetico vivo do navegador informado. */
async function criarRascunho({ cookie = COOKIE, status = 'aberto', email = null, hmac = null, verificado = null, expira = T0 + 7 * 86400000 } = {}) {
  const r = await client.query(
    `insert into app.request_draft (browser_nonce_hash, ip_hmac, status, expires_at, created_at, updated_at,
       email, email_hmac, email_verified_at)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8) returning id`,
    [cookie, IP, status, iso(expira), iso(T0), email, hmac, verificado === null ? null : iso(verificado)],
  );
  return r.rows[0].id;
}

const lerRascunho = async (id) =>
  (
    await client.query(
      'select status, email, email_hmac, first_name, email_verified_at from app.request_draft where id = $1',
      [id],
    )
  ).rows[0];

test('T-H013-13: colunas, funcoes novas e restricoes de identificacao existem', async () => {
  await tx(async () => {
    const cols = (
      await client.query(
        `select column_name from information_schema.columns where table_schema='app' and table_name='request_draft'
           and column_name in ('first_name','email','email_hmac','email_verified_at')`,
      )
    ).rows.map((r) => r.column_name).sort();
    assert.deepEqual(cols, ['email', 'email_hmac', 'email_verified_at', 'first_name']);

    const fns = (
      await client.query(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
           and proname in ('draft_bind_challenge','draft_attach_challenge','auth_code_attempt_attach',
             'auth_challenge_consume_link_attach','draft_identity_get','draft_identity_set')`,
      )
    ).rows.map((r) => r.proname);
    assert.equal(new Set(fns).size, 6);

    const id = await criarRascunho();
    assert.ok(await erroEm(`update app.request_draft set email = 'Cliente@example.test' where id = $1`, [id]));
    assert.ok(await erroEm(`update app.request_draft set first_name = 'A' where id = $1`, [id]));
    assert.ok(await erroEm(`update app.request_draft set email_hmac = $2 where id = $1`, [id, EMAIL_HMAC]));
  });
});

test('T-H013-02: bind grava o nonce uma so vez e leva a aguardando_email so com o e-mail conferindo', async () => {
  await tx(async () => {
    const rascunho = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC });
    const desafio = await criarDesafio();
    const r1 = await client.query('select private.draft_bind_challenge($1, $2, $3::timestamptz) as ok', [desafio, COOKIE, iso(T0)]);
    assert.equal(r1.rows[0].ok, true);
    const nonce = (await client.query('select browser_nonce_hash from app.auth_challenge where id = $1', [desafio])).rows[0];
    assert.equal(nonce.browser_nonce_hash, COOKIE);
    assert.equal((await lerRascunho(rascunho)).status, 'aguardando_email');
    const r2 = await client.query('select private.draft_bind_challenge($1, $2, $3::timestamptz) as ok', [desafio, COOKIE_B, iso(T0)]);
    assert.equal(r2.rows[0].ok, false, 'nonce ja gravado nao e trocado');
  });
  await tx(async () => {
    const rascunho = await criarRascunho({ email: 'outra@example.test', hmac: OUTRO_HMAC });
    const desafio = await criarDesafio();
    await client.query('select private.draft_bind_challenge($1, $2, $3::timestamptz)', [desafio, COOKIE, iso(T0)]);
    assert.equal((await lerRascunho(rascunho)).status, 'aberto', 'e-mail diferente: status intacto');
  });
});

test('T-H013-09 e T-H013-08: anexa pelo codigo e pelo link; depois do consumo, o outro caminho nao vale', async () => {
  await tx(async () => {
    const rascunho = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC, status: 'aguardando_email' });
    const desafio = await criarDesafio({ nonce: COOKIE });
    const r = await client.query(
      'select * from private.auth_code_attempt_attach($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)',
      [desafio, EMAIL_HMAC, 'publish', CODE_HMAC, 5, iso(T0 + 1000), sha('ip-chave'), sha('email-chave'), 50, 15, COOKIE],
    );
    assert.equal(r.rows[0].out_resultado, 'ok');
    assert.equal(r.rows[0].out_attached, true);
    const depois = await lerRascunho(rascunho);
    assert.equal(depois.status, 'aberto');
    assert.equal(new Date(depois.email_verified_at).toISOString(), iso(T0 + 1000));
  });
  await tx(async () => {
    const rascunho = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC });
    const token = sha('token-do-link');
    const desafio = randomUUID();
    await client.query(
      `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc,
         browser_nonce_hash, expires_at, created_at) values ($1,$2,'publish',$3,$4,$5,$6,$7,$8,$9)`,
      [desafio, EMAIL_HMAC, token, CODE_HMAC, Buffer.from('e'), Buffer.from('s'), COOKIE, iso(T0 + 900000), iso(T0)],
    );
    const r = await client.query('select * from private.auth_challenge_consume_link_attach($1, $2::timestamptz, $3)', [token, iso(T0 + 1000), COOKIE]);
    assert.equal(r.rows[0].out_resultado, 'ok');
    assert.equal(r.rows[0].out_attached, true);
    assert.equal((await lerRascunho(rascunho)).status, 'aberto');
    const codigo = await client.query(
      'select * from private.auth_code_attempt_attach($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)',
      [desafio, EMAIL_HMAC, 'publish', CODE_HMAC, 5, iso(T0 + 2000), sha('ip-chave'), sha('email-chave'), 50, 15, COOKIE],
    );
    assert.notEqual(codigo.rows[0].out_resultado, 'ok');
    assert.equal(codigo.rows[0].out_attached, false);
  });
});

test('T-H013-10: nao anexa com outro cookie, sem cookie, sem nonce, e-mail diferente ou rascunho vencido', async () => {
  await tx(async () => {
    const rascunho = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC });
    // Desafios ja consumidos: o indice de desafio vivo (um por e-mail e intencao) nao colide.
    const comNonce = await criarDesafio({ nonce: COOKIE, consumido: true });
    const semNonce = await criarDesafio({ nonce: null, consumido: true });
    const outroEmail = await criarDesafio({ nonce: COOKIE, emailHash: OUTRO_HMAC, consumido: true });
    const casos = [
      [comNonce, COOKIE_B],
      [comNonce, null],
      [semNonce, COOKIE],
      [outroEmail, COOKIE],
    ];
    for (const [desafio, cookie] of casos) {
      const r = await client.query('select private.draft_attach_challenge($1, $2, $3::timestamptz) as ok', [desafio, cookie, iso(T0 + 1000)]);
      assert.equal(r.rows[0].ok, false);
    }
    const depois = await lerRascunho(rascunho);
    assert.equal(depois.status, 'aberto');
    assert.equal(depois.email_verified_at, null, 'nenhuma coluna do rascunho muda');
  });
  await tx(async () => {
    const vencido = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC, expira: T0 - 1000 });
    const desafio = await criarDesafio({ nonce: COOKIE, consumido: true });
    const r = await client.query('select private.draft_attach_challenge($1, $2, $3::timestamptz) as ok', [desafio, COOKIE, iso(T0 + 1000)]);
    assert.equal(r.rows[0].ok, false);
    assert.equal((await lerRascunho(vencido)).email_verified_at, null);
  });
});

test('T-H013-11: o cookie escolhe o rascunho; o rascunho de outro navegador nao muda', async () => {
  await tx(async () => {
    const a = await criarRascunho({ cookie: COOKIE, email: EMAIL, hmac: EMAIL_HMAC });
    const b = await criarRascunho({ cookie: COOKIE_B, email: EMAIL, hmac: EMAIL_HMAC });
    const desafio = await criarDesafio({ nonce: COOKIE, consumido: true });
    const r = await client.query('select private.draft_attach_challenge($1, $2, $3::timestamptz) as ok', [desafio, COOKIE, iso(T0 + 1000)]);
    assert.equal(r.rows[0].ok, true);
    assert.notEqual((await lerRascunho(a)).email_verified_at, null);
    assert.equal((await lerRascunho(b)).email_verified_at, null, 'rascunho de outro navegador intacto');
  });
});

test('T-H013-14 (banco): identidade zera a confirmacao so quando o e-mail muda; sem rascunho, zero linhas', async () => {
  await tx(async () => {
    const rascunho = await criarRascunho({ email: EMAIL, hmac: EMAIL_HMAC, status: 'aguardando_email', verificado: T0 + 500 });
    const mesmo = await client.query('select * from private.draft_identity_set($1, $2::timestamptz, $3, $4, $5)', [COOKIE, iso(T0 + 2000), 'Ana', EMAIL, EMAIL_HMAC]);
    assert.equal(mesmo.rows[0].out_email_verified, true, 'mesmo e-mail mantem a confirmacao');
    assert.equal((await lerRascunho(rascunho)).status, 'aguardando_email');

    const trocado = await client.query('select * from private.draft_identity_set($1, $2::timestamptz, $3, $4, $5)', [COOKIE, iso(T0 + 3000), 'Ana', 'nova@example.test', OUTRO_HMAC]);
    assert.equal(trocado.rows[0].out_email_verified, false);
    const depois = await lerRascunho(rascunho);
    assert.equal(depois.status, 'aberto', 'troca de e-mail volta aguardando_email a aberto');
    assert.equal(depois.email_verified_at, null);
  });
  await tx(async () => {
    const vazio = await client.query('select * from private.draft_identity_get($1, $2::timestamptz)', [COOKIE_B, iso(T0)]);
    assert.equal(vazio.rows.length, 0, 'sem rascunho vivo: zero linhas (404)');
    await criarRascunho({ cookie: COOKIE_B });
    const sem = await client.query('select * from private.draft_identity_get($1, $2::timestamptz)', [COOKIE_B, iso(T0)]);
    assert.deepEqual(
      { n: sem.rows[0].out_first_name, e: sem.rows[0].out_email, v: sem.rows[0].out_email_verified },
      { n: null, e: null, v: false },
    );
  });
});

test('T-H013-22 (parcial): o rollback remove funcoes e colunas novas dentro da transacao', async () => {
  await tx(async () => {
    await client.query(DESFAZER);
    const cols = (
      await client.query(
        `select count(*)::int as n from information_schema.columns where table_schema='app' and table_name='request_draft'
           and column_name in ('first_name','email','email_hmac','email_verified_at')`,
      )
    ).rows[0].n;
    assert.equal(cols, 0);
    const fns = (
      await client.query(
        `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='private'
           and proname = 'draft_attach_challenge'`,
      )
    ).rows[0].n;
    assert.equal(fns, 0);
  });
});
