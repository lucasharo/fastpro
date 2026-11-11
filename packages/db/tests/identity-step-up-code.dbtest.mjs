// H-014 | Testes de banco do codigo de step-up (docs/factory/52-DESENHO-H014.md §4.3, §5):
// T-H014-24 (pedido, substituicao, prova atomica, 5 erros, sessao alheia, corrida, revogacao),
// T-H014-25 (consume_link nao consome step_up; limites 60 s e 5/h; sem e-mail em claro) e
// T-H014-26 (privilegios das funcoes de step-up). Banco de desenvolvimento. Dados sinteticos
// (@example.test). Os casos sem concorrencia rodam em transacao desfeita; o de corrida grava e limpa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
const conexoes = [];
const limpar = { usuarios: [], emails: [], chaves: [] };

before(async () => {
  client = await connect();
});
after(async () => {
  if (limpar.emails.length > 0) {
    await client.query('delete from ops.email_outbox where dedupe_key in (select unnest($1::text[]))', [limpar.emails]);
  }
  if (limpar.chaves.length > 0) {
    await client.query('delete from ops.code_lock where key_hmac in (select unnest($1::text[]))', [limpar.chaves]);
    await client.query('delete from ops.rate_counter where key_hmac in (select unnest($1::text[]))', [limpar.chaves]);
  }
  if (limpar.usuarios.length > 0) {
    await client.query('delete from app.app_session where user_id in (select unnest($1::uuid[]))', [limpar.usuarios]);
    await client.query('delete from app.app_user where id in (select unnest($1::uuid[]))', [limpar.usuarios]);
  }
  for (const c of conexoes) await c.end().catch(() => {});
  await client?.end();
});

const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const SEG = 1000;
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const novoSegredo = () => randomBytes(32).toString('base64url');
const CODIGO = '123456';

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Usuario sintetico com sessao ativa por link (etapa aberta e convertida). Commit fora de tx. */
async function sessaoAtiva(db, nowMs = NOW) {
  const userId = randomUUID();
  const email = `h014s-${randomUUID()}@example.test`;
  await db.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4::timestamptz, $4::timestamptz)`,
    [userId, email, randomUUID(), iso(nowMs)],
  );
  limpar.usuarios.push(userId);
  const sessionId = randomUUID();
  const segredo = novoSegredo();
  await db.query('select private.app_session_open_stage($1, $2, $3, $4, null, $5, $6::timestamptz)', [
    sessionId,
    userId,
    randomUUID(),
    'login',
    sha(segredo),
    iso(nowMs),
  ]);
  const novo = novoSegredo();
  await db.query('select * from private.app_session_convert($1, $2, $3::timestamptz)', [
    sha(segredo),
    sha(novo),
    iso(nowMs),
  ]);
  return { userId, sessionId, email, hash: sha(novo) };
}

async function pedir(db, { sid, email, id, codigo, nowMs, ipKey }) {
  return db.query(
    'select * from private.step_up_request($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13,$14,$15)',
    [
      sid,
      id,
      sha(email),
      sha(`token|${id}`),
      sha(`${id}|${codigo}`),
      Buffer.from('synthetic-email-enc'),
      Buffer.from('synthetic-secrets-enc'),
      sha('ip'),
      iso(nowMs),
      ipKey,
      sha(`gh|${ipKey}`),
      sha(`gd|${ipKey}`),
      50,
      100,
      50,
    ],
  ).then((r) => r.rows[0]);
}

async function verificar(db, { sid, email, id, codigo, nowMs, ipKey, emailKey }) {
  return db
    .query('select * from private.step_up_verify($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10)', [
      sid,
      id,
      sha(email),
      sha(`${id}|${codigo}`),
      5,
      iso(nowMs),
      ipKey,
      emailKey,
      100,
      50,
    ])
    .then((r) => r.rows[0]);
}

async function desafio(db, id) {
  return (
    await db.query(
      'select purpose, session_id, consumed_at, invalidated_at, invalid_reason from app.auth_challenge where id = $1',
      [id],
    )
  ).rows[0];
}

async function recentAuth(db, sid) {
  return (await db.query('select recent_auth_at from app.app_session where id = $1', [sid])).rows[0]
    .recent_auth_at;
}

// ---------------------------------------------------------------------------------------------
// T-H014-24: codigo de step-up
// ---------------------------------------------------------------------------------------------

test('T-H014-24 pedido cria 1 desafio step_up ligado a sessao e 1 saida auth sem endereco', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const id = randomUUID();
    const r = await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey: sha(randomUUID()) });
    assert.equal(r.out_resultado, 'criado');

    const c = await desafio(client, id);
    assert.equal(c.purpose, 'step_up');
    assert.equal(c.session_id, s.sessionId);

    const o = (
      await client.query('select email_type, class, category, template, template_params from ops.email_outbox where id = $1', [
        r.out_outbox_id,
      ])
    ).rows[0];
    assert.equal(o.email_type, 'acesso_stepup');
    assert.equal(o.class, 'auth');
    assert.equal(o.category, 'acesso');
    assert.deepEqual(Object.keys(o.template_params), ['challenge_ref']);
    assert.ok(!JSON.stringify(o).includes(s.email), 'saida nao carrega o e-mail em claro');
  }));

test('T-H014-24 segundo pedido espera 60 s e, depois, substitui o desafio vivo', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    const primeiro = randomUUID();
    const segundo = randomUUID();
    assert.equal((await pedir(client, { sid: s.sessionId, email: s.email, id: primeiro, codigo: CODIGO, nowMs: NOW, ipKey })).out_resultado, 'criado');
    const espera = await pedir(client, { sid: s.sessionId, email: s.email, id: randomUUID(), codigo: CODIGO, nowMs: NOW + 30 * SEG, ipKey });
    assert.equal(espera.out_resultado, 'espera');
    assert.equal((await pedir(client, { sid: s.sessionId, email: s.email, id: segundo, codigo: CODIGO, nowMs: NOW + 61 * SEG, ipKey })).out_resultado, 'criado');

    const velho = await desafio(client, primeiro);
    assert.equal(velho.invalid_reason, 'substituido');
    const novo = await desafio(client, segundo);
    assert.equal(novo.invalidated_at, null);
  }));

test('T-H014-24 codigo certo grava recent_auth_at e consome o desafio na mesma transacao', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    const id = randomUUID();
    await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey });
    const antes = await recentAuth(client, s.sessionId);

    await client.query('savepoint prova');
    const r = await verificar(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW + 10 * SEG, ipKey, emailKey: sha(`ek|${ipKey}`) });
    assert.equal(r.out_resultado, 'ok');
    assert.ok((await desafio(client, id)).consumed_at, 'desafio consumido');
    assert.ok((await recentAuth(client, s.sessionId)).getTime() > antes.getTime(), 'recent_auth_at avancou');

    // Os dois efeitos voltam juntos: nenhum fica sem o outro.
    await client.query('rollback to savepoint prova');
    assert.equal((await desafio(client, id)).consumed_at, null);
    assert.equal((await recentAuth(client, s.sessionId)).getTime(), antes.getTime());
  }));

test('T-H014-24 5 erros invalidam o desafio; recent_auth_at nao muda e o certo ja nao passa', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    const emailKey = sha(`ek|${ipKey}`);
    const id = randomUUID();
    await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey });
    const antes = await recentAuth(client, s.sessionId);

    for (let i = 0; i < 5; i += 1) {
      await verificar(client, { sid: s.sessionId, email: s.email, id, codigo: '654321', nowMs: NOW + (i + 1) * SEG, ipKey, emailKey });
    }
    const c = await desafio(client, id);
    assert.equal(c.invalid_reason, 'tentativas');
    assert.equal((await recentAuth(client, s.sessionId)).getTime(), antes.getTime());

    const certo = await verificar(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW + 10 * SEG, ipKey, emailKey });
    assert.notEqual(certo.out_resultado, 'ok');
  }));

test('T-H014-24 desafio de outra sessao do mesmo usuario nao vale (codigo_invalido e conta erro)', () =>
  tx(async () => {
    const a = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    const emailKey = sha(`ek|${ipKey}`);
    const id = randomUUID();
    await pedir(client, { sid: a.sessionId, email: a.email, id, codigo: CODIGO, nowMs: NOW, ipKey });

    const b = randomUUID();
    const segredoB = novoSegredo();
    await client.query('select private.app_session_open_stage($1, $2, $3, $4, null, $5, $6::timestamptz)', [
      b,
      a.userId,
      randomUUID(),
      'login',
      sha(segredoB),
      iso(NOW),
    ]);
    await client.query('select * from private.app_session_convert($1, $2, $3::timestamptz)', [
      sha(segredoB),
      sha(novoSegredo()),
      iso(NOW),
    ]);

    const r = await verificar(client, { sid: b, email: a.email, id, codigo: CODIGO, nowMs: NOW + SEG, ipKey, emailKey });
    assert.equal(r.out_resultado, 'invalido');
    assert.equal((await desafio(client, id)).consumed_at, null);
  }));

test('T-H014-24 sessao revogada no meio: prova negada e desafio intacto', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    const id = randomUUID();
    await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey });
    await client.query('select private.app_session_revoke($1, $2::timestamptz)', [s.sessionId, iso(NOW + SEG)]);

    const r = await verificar(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW + 2 * SEG, ipKey, emailKey: sha(`ek|${ipKey}`) });
    assert.equal(r.out_resultado, 'negado');
    assert.equal((await desafio(client, id)).consumed_at, null);
  }));

test('T-H014-24 corrida: 20 confirmacoes simultaneas do codigo certo geram exatamente 1 sucesso', async () => {
  const s = await sessaoAtiva(client);
  const ipKey = sha(randomUUID());
  const emailKey = sha(`ek|${ipKey}`);
  const id = randomUUID();
  limpar.chaves.push(ipKey, emailKey, sha(`gh|${ipKey}`), sha(`gd|${ipKey}`));
  await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey });
  limpar.emails.push(`ac:${id}`);

  const conns = await Promise.all(Array.from({ length: 20 }, () => connect()));
  conexoes.push(...conns);
  const resultados = await Promise.all(
    conns.map((c) => verificar(c, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW + 10 * SEG, ipKey, emailKey })),
  );
  const oks = resultados.filter((r) => r.out_resultado === 'ok').length;
  assert.equal(oks, 1);
});

// ---------------------------------------------------------------------------------------------
// T-H014-25: consume_link, limites e vazamento
// ---------------------------------------------------------------------------------------------

test('T-H014-25 consume_link nao consome desafio step_up (resposta invalido, sem efeito)', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const id = randomUUID();
    await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey: sha(randomUUID()) });
    const r = await client.query('select * from private.auth_challenge_consume_link($1, $2::timestamptz)', [
      sha(`token|${id}`),
      iso(NOW + SEG),
    ]);
    assert.equal(r.rows[0].out_resultado, 'invalido');
    assert.equal((await desafio(client, id)).consumed_at, null);
  }));

test('T-H014-25 limites: 60 s entre pedidos e 5 por hora por e-mail valem para step_up', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const ipKey = sha(randomUUID());
    for (let k = 0; k < 5; k += 1) {
      const r = await pedir(client, { sid: s.sessionId, email: s.email, id: randomUUID(), codigo: CODIGO, nowMs: NOW + k * 61 * SEG, ipKey });
      assert.equal(r.out_resultado, 'criado', `pedido ${k + 1}`);
    }
    const sexto = await pedir(client, { sid: s.sessionId, email: s.email, id: randomUUID(), codigo: CODIGO, nowMs: NOW + 5 * 61 * SEG, ipKey });
    assert.equal(sexto.out_resultado, 'teto');
  }));

test('T-H014-25 e-mail em claro nao aparece em app_session, auth_challenge nem ops.email_outbox', () =>
  tx(async () => {
    const s = await sessaoAtiva(client);
    const id = randomUUID();
    const r = await pedir(client, { sid: s.sessionId, email: s.email, id, codigo: CODIGO, nowMs: NOW, ipKey: sha(randomUUID()) });
    const achados = (
      await client.query(
        `select
           (select count(*) from app.app_session x where to_jsonb(x)::text like '%' || $1 || '%')::int as sessao,
           (select count(*) from app.auth_challenge x where to_jsonb(x)::text like '%' || $1 || '%')::int as desafio,
           (select count(*) from ops.email_outbox x where to_jsonb(x)::text like '%' || $1 || '%')::int as saida`,
        [s.email],
      )
    ).rows[0];
    assert.deepEqual(achados, { sessao: 0, desafio: 0, saida: 0 });
    assert.ok(r.out_outbox_id);
  }));

// ---------------------------------------------------------------------------------------------
// T-H014-26: privilegios das funcoes de step-up
// ---------------------------------------------------------------------------------------------

// Papel de servico nao aparece aqui: a referencia a ele e restrita a caminhos listados pelo
// verificador de segredos. A revogacao desse papel esta na propria migracao de step-up.
test('T-H014-26 so app_system executa as funcoes de step-up; anon e authenticated nao', () =>
  tx(async () => {
    const reqSig = 'private.step_up_request(uuid,uuid,text,text,text,bytea,bytea,text,timestamptz,text,text,text,integer,integer,integer)';
    const verSig = 'private.step_up_verify(uuid,uuid,text,text,integer,timestamptz,text,text,integer,integer)';
    const { rows } = await client.query(
      `select
         has_function_privilege('anon', $1, 'execute') as anon_req,
         has_function_privilege('authenticated', $1, 'execute') as auth_req,
         has_function_privilege('app_system', $1, 'execute') as sys_req,
         has_function_privilege('anon', $2, 'execute') as anon_ver,
         has_function_privilege('authenticated', $2, 'execute') as auth_ver,
         has_function_privilege('app_system', $2, 'execute') as sys_ver`,
      [reqSig, verSig],
    );
    assert.deepEqual(rows[0], {
      anon_req: false,
      auth_req: false,
      sys_req: true,
      anon_ver: false,
      auth_ver: false,
      sys_ver: true,
    });
  }));
