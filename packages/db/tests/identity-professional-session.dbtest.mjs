// H-016 | Testes de banco da sessao do profissional (docs/factory/33-DESENHO-H016.md §5.1 passo 5, §7; CA-H016-18
// e CA-H016-19). Usa private.professional_session_open, private.app_session_get, private.app_session_revoke e
// private.app_session_revoke_all. Cada teste roda numa transacao que termina em ROLLBACK: nada e gravado no banco
// de desenvolvimento. Dados sinteticos (e-mail example.test).
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-professional-session.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

const AGORA = Date.UTC(2099, 0, 1, 12);
const iso = (ms) => new Date(ms).toISOString();
const DIA_MS = 24 * 60 * 60 * 1000;

let client;
let aplicada = false;

before(async () => {
  client = await connect();
  const res = await client.query(
    `select to_regprocedure('private.professional_session_open(uuid,uuid,text,timestamptz)') is not null
        and to_regprocedure('private.app_session_get(text,timestamptz)') is not null as ok`,
  );
  aplicada = res.rows[0].ok === true;
});

after(async () => {
  await client?.end();
});

const hex = () => randomBytes(32).toString('hex');

async function criarUsuario(c, status = 'ativo') {
  const id = randomUUID();
  const email = `sintetico.${randomBytes(6).toString('hex')}@example.test`;
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)`,
    [id, email, randomUUID(), status, iso(AGORA)],
  );
  return { id };
}

/** Abre uma sessao de senha pela funcao real e devolve o id e o hash do segredo. */
async function abrirSessao(c, userId, agora = AGORA) {
  const id = randomUUID();
  const hash = hex();
  await c.query('select * from private.professional_session_open($1, $2, $3, $4::timestamptz)', [
    id,
    userId,
    hash,
    iso(agora),
  ]);
  return { id, hash };
}

async function emTransacao(corpo) {
  await client.query('begin');
  try {
    return await corpo(client);
  } finally {
    await client.query('rollback');
  }
}

const pular = (t) => t.skip('funcoes de sessao do profissional nao aplicadas no banco de desenvolvimento');

test('CA-H016-18: a sessao do profissional nasce com 7 dias absolutos (expires_at e absolute_expires_at)', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const s = await abrirSessao(c, u.id);
    const r = await c.query(
      `select extract(epoch from (expires_at - created_at)) as prazo,
              extract(epoch from (absolute_expires_at - created_at)) as absoluto
         from app.app_session where id = $1`,
      [s.id],
    );
    assert.equal(Number(r.rows[0].prazo), 7 * 24 * 60 * 60);
    assert.equal(Number(r.rows[0].absoluto), 7 * 24 * 60 * 60);
  });
});

test('CA-H016-18: o uso no 6o dia nao prorroga: os prazos gravados nao mudam e a sessao deixa de valer no 7o dia', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const s = await abrirSessao(c, u.id);
    const antes = await c.query('select expires_at, absolute_expires_at from app.app_session where id = $1', [s.id]);
    const usoNoSexto = await c.query('select * from private.app_session_get($1, $2::timestamptz)', [
      s.hash,
      iso(AGORA + 6 * DIA_MS),
    ]);
    assert.equal(usoNoSexto.rows.length, 1, 'no 6o dia a sessao vale');
    const depois = await c.query('select expires_at, absolute_expires_at from app.app_session where id = $1', [s.id]);
    assert.equal(depois.rows[0].expires_at.getTime(), antes.rows[0].expires_at.getTime(), 'uso nao prorroga o prazo');
    assert.equal(
      depois.rows[0].absolute_expires_at.getTime(),
      antes.rows[0].absolute_expires_at.getTime(),
      'uso nao mexe no prazo absoluto',
    );
    const noSetimo = await c.query('select * from private.app_session_get($1, $2::timestamptz)', [
      s.hash,
      iso(AGORA + 7 * DIA_MS),
    ]);
    assert.equal(noSetimo.rows.length, 0, 'no 7o dia a sessao ja nao vale');
  });
});

test('CA-H016-18: um segundo antes do limite a sessao ainda vale; no limite exato nao (fronteira)', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const s = await abrirSessao(c, u.id);
    const umSegundoAntes = await c.query('select * from private.app_session_get($1, $2::timestamptz)', [
      s.hash,
      iso(AGORA + 7 * DIA_MS - 1000),
    ]);
    assert.equal(umSegundoAntes.rows.length, 1);
    const exato = await c.query('select * from private.app_session_get($1, $2::timestamptz)', [
      s.hash,
      iso(AGORA + 7 * DIA_MS),
    ]);
    assert.equal(exato.rows.length, 0);
  });
});

test('CA-H016-19: sair revoga so a sessao informada; a outra sessao da mesma pessoa segue valida', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const atual = await abrirSessao(c, u.id);
    const outra = await abrirSessao(c, u.id);
    const r = await c.query('select private.app_session_revoke($1, $2::timestamptz) as ok', [atual.id, iso(AGORA + 1000)]);
    assert.equal(r.rows[0].ok, true);
    assert.equal((await c.query('select * from private.app_session_get($1, $2::timestamptz)', [atual.hash, iso(AGORA + 2000)])).rows.length, 0);
    assert.equal((await c.query('select * from private.app_session_get($1, $2::timestamptz)', [outra.hash, iso(AGORA + 2000)])).rows.length, 1);
  });
});

test('CA-H016-19: sair de todos revoga todas as sessoes da pessoa e nenhuma de outra pessoa', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const outro = await criarUsuario(c);
    const a = await abrirSessao(c, u.id);
    const b = await abrirSessao(c, u.id);
    const alheia = await abrirSessao(c, outro.id);
    const agora = iso(AGORA + 1000);
    const n = await c.query('select private.app_session_revoke_all($1, $2::timestamptz) as n', [u.id, agora]);
    assert.equal(n.rows[0].n, 2);
    assert.equal((await c.query('select * from private.app_session_get($1, $2::timestamptz)', [a.hash, iso(AGORA + 2000)])).rows.length, 0);
    assert.equal((await c.query('select * from private.app_session_get($1, $2::timestamptz)', [b.hash, iso(AGORA + 2000)])).rows.length, 0);
    assert.equal((await c.query('select * from private.app_session_get($1, $2::timestamptz)', [alheia.hash, iso(AGORA + 2000)])).rows.length, 1);
  });
});

test('CA-H016-19: conta bloqueada derruba a sessao (a guarda nao devolve linha)', async (t) => {
  if (!aplicada) return pular(t);
  await emTransacao(async (c) => {
    const u = await criarUsuario(c);
    const s = await abrirSessao(c, u.id);
    await c.query("update app.app_user set status = 'bloqueado' where id = $1", [u.id]);
    const r = await c.query('select * from private.app_session_get($1, $2::timestamptz)', [s.hash, iso(AGORA + 1000)]);
    assert.equal(r.rows.length, 0);
  });
});
