// H-012 | Testes de banco da etapa de identificacao (T-H012-20, 21, 22, 23; desenho 46 §3, §4, §6).
// Banco de desenvolvimento. Os testes em transacao sao desfeitos (rollback); o de concorrencia
// (T-H012-23) e o de criacao concorrente (T-H012-21) gravam linhas sinteticas e as removem no fim.
// Valores sinteticos (@example.test; tokens derivados de UUID). Sem rede externa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
const extras = [];

before(async () => {
  client = await connect();
});
after(async () => {
  for (const c of extras) await c.end().catch(() => {});
  await client?.end();
});

const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const EMAIL_HASH = (email) => sha(`email:${email}`);

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Insere um desafio direto (sem fila de envio) com token derivado do id. Commitado se pedido. */
async function inserirDesafio(id, email, createdMs = NOW_MS, db = client) {
  await db.query(
    `insert into app.auth_challenge
       (id, email_hash, purpose, token_hash, code_hmac, email_enc, secrets_enc, draft_id,
        expires_at, created_at)
     values ($1, $2, 'login', $3, $4, $5, null, null, $6::timestamptz, $7::timestamptz)`,
    [
      id,
      EMAIL_HASH(email),
      sha(`t:${id}`),
      sha(`c:${id}`),
      Buffer.from('blob-sintetico'),
      iso(createdMs + 15 * 60 * 1000),
      iso(createdMs),
    ],
  );
}

async function consumir(db, token, nowMs) {
  const r = await db.query('select * from private.auth_challenge_consume_link($1, $2::timestamptz)', [
    sha(token),
    iso(nowMs),
  ]);
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------
// T-H012-20: postura de acesso e unicidade da etapa
// ---------------------------------------------------------------------------------------------

test('T-H012-20 RLS forçada, sem acesso de papeis publicos; app_system so pelas funcoes', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname in ('app_user', 'app_session')`);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname} com RLS`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname} com RLS forcada`);
    }

    const { rows: p } = await client.query(`
      select
        has_table_privilege('anon', 'app.app_session', 'select') as anon_select,
        has_table_privilege('authenticated', 'app.app_session', 'select') as auth_select,
        has_table_privilege('app_system', 'app.app_session', 'insert') as system_insert,
        has_table_privilege('app_system', 'app.app_session', 'delete') as system_session_delete,
        has_table_privilege('app_system', 'app.app_user', 'delete') as system_user_delete,
        has_function_privilege('authenticated',
          'private.app_user_ensure(text,uuid,timestamptz)', 'execute') as auth_exec,
        has_function_privilege('app_system',
          'private.app_session_open_stage(uuid,uuid,uuid,text,uuid,text,timestamptz)', 'execute') as system_exec`);
    // DELETE so em app_session (expurgo de etapas vencidas). app_user nunca e apagado pela H-012
    // (revisao S-3, migracao 20261111160000).
    assert.deepEqual(p[0], {
      anon_select: false,
      auth_select: false,
      system_insert: true,
      system_session_delete: true,
      system_user_delete: false,
      auth_exec: false,
      system_exec: true,
    });

    // Varredura generica de papeis (mesmo criterio do T-H011-27): so o dono, app_system e os
    // leitores aceitos da plataforma tem acesso. Superusuarios ficam de fora (bypass do motor).
    const LEITORES_ACEITOS = [
      'app_backup_reader',
      'pg_read_all_data',
      'pg_write_all_data',
      'supabase_etl_admin',
      'supabase_read_only_user',
    ];
    for (const tabela of ['app.app_user', 'app.app_session']) {
      const { rows: acesso } = await client.query(
        `select r.rolname
           from pg_roles r
          where not r.rolsuper
            and r.rolname <> 'app_system'
            and r.oid <> (select c.relowner from pg_class c where c.oid = $1::regclass)
            and (has_table_privilege(r.oid, $1, 'SELECT')
              or has_table_privilege(r.oid, $1, 'INSERT')
              or has_table_privilege(r.oid, $1, 'UPDATE')
              or has_table_privilege(r.oid, $1, 'DELETE'))
          order by r.rolname`,
        [tabela],
      );
      assert.deepEqual(
        acesso.map((r) => r.rolname).filter((nome) => !LEITORES_ACEITOS.includes(nome)),
        [],
        `${tabela}: papel sem acesso permitido`,
      );
    }
  }));

test('T-H012-20 challenge_id unico: um desafio nao abre segunda etapa; hash e estagio validos', () =>
  tx(async () => {
    const usuario = await client.query(
      'select out_user_id from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      ['etapa.h012@example.test', randomUUID(), iso(NOW_MS)],
    );
    const userId = usuario.rows[0].out_user_id;
    const challengeId = randomUUID();
    const abrir = (sessionId) =>
      client.query(
        'select private.app_session_open_stage($1,$2,$3,$4,$5,$6,$7::timestamptz) as id',
        [sessionId, userId, challengeId, 'login', null, sha('segredo-1'), iso(NOW_MS)],
      );

    const primeira = await abrir(randomUUID());
    assert.ok(primeira.rows[0].id, 'primeira etapa e criada');
    const segunda = await abrir(randomUUID());
    assert.equal(segunda.rows[0].id, null, 'segunda etapa do mesmo desafio nao entra');

    const linha = await client.query(
      `select stage,
              (expires_at - created_at) = interval '15 minutes' as janela_15min,
              (absolute_expires_at - created_at) = interval '7 days' as teto_7dias,
              secret_hash
         from app.app_session where challenge_id = $1`,
      [challengeId],
    );
    assert.equal(linha.rows[0].stage, 'identificacao');
    assert.equal(linha.rows[0].janela_15min, true);
    assert.equal(linha.rows[0].teto_7dias, true);
    assert.equal(linha.rows[0].secret_hash, sha('segredo-1'));
  }));

test('T-H012-20 a validade de 15 min da etapa e garantida pelo banco', () =>
  tx(async () => {
    const usuario = await client.query(
      'select out_user_id from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      ['validade.h012@example.test', randomUUID(), iso(NOW_MS)],
    );
    await client.query('savepoint antes');
    await assert.rejects(
      client.query(
        `insert into app.app_session
           (id, user_id, stage, secret_hash, challenge_id, purpose, created_at, expires_at, absolute_expires_at)
         values ($1, $2, 'identificacao', $3, $4, 'login', $5::timestamptz,
                 $5::timestamptz + interval '1 hour', $5::timestamptz + interval '7 days')`,
        [randomUUID(), usuario.rows[0].out_user_id, sha('x'), randomUUID(), iso(NOW_MS)],
      ),
      /app_session_identificacao_15min/,
    );
    await client.query('rollback to savepoint antes');
  }));

// ---------------------------------------------------------------------------------------------
// T-H012-21: app_user_ensure idempotente, sem tocar em email_verified_at
// ---------------------------------------------------------------------------------------------

test('T-H012-21 mesmo e-mail nao cria segunda linha e nao altera email_verified_at', () =>
  tx(async () => {
    const email = 'idem.h012@example.test';
    const t1 = NOW_MS;
    const primeira = await client.query(
      'select * from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      [email, randomUUID(), iso(t1)],
    );
    assert.equal(primeira.rows[0].out_criado, true);
    const segunda = await client.query(
      'select * from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      [email, randomUUID(), iso(t1 + 60_000)],
    );
    assert.equal(segunda.rows[0].out_criado, false);
    assert.equal(segunda.rows[0].out_user_id, primeira.rows[0].out_user_id);

    const { rows } = await client.query(
      'select count(*)::int as n, min(email_verified_at) as verificado from app.app_user where email = $1',
      [email],
    );
    assert.equal(rows[0].n, 1);
    assert.equal(new Date(rows[0].verificado).toISOString(), iso(t1));
  }));

test('T-H012-21 20 criacoes concorrentes do mesmo e-mail geram 1 linha', async () => {
  const email = `corrida.${randomUUID()}@example.test`;
  const conexoes = await Promise.all(Array.from({ length: 20 }, () => connect()));
  extras.push(...conexoes);
  try {
    const resultados = await Promise.all(
      conexoes.map((c) =>
        c.query('select * from private.app_user_ensure($1, $2::uuid, $3::timestamptz)', [
          email,
          randomUUID(),
          iso(NOW_MS),
        ]),
      ),
    );
    assert.equal(resultados.filter((r) => r.rows[0].out_criado === true).length, 1);
    assert.equal(new Set(resultados.map((r) => r.rows[0].out_user_id)).size, 1);
    const { rows } = await client.query('select count(*)::int as n from app.app_user where email = $1', [
      email,
    ]);
    assert.equal(rows[0].n, 1);
  } finally {
    await client.query('delete from app.app_user where email = $1', [email]);
  }
});

// ---------------------------------------------------------------------------------------------
// T-H012-22: nenhum e-mail em claro nas tabelas de sessao, desafio, job e outbox
// ---------------------------------------------------------------------------------------------

test('T-H012-22 apos um consumo completo, o e-mail sentinela nao aparece em claro (exceto app_user)', () =>
  tx(async () => {
    const SENTINELA = 'sentinela.h012.varredura@example.test';
    const id = randomUUID();
    await client.query(
      `select * from private.auth_challenge_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        EMAIL_HASH(SENTINELA),
        'login',
        sha(`t:${id}`),
        sha(`c:${id}`),
        Buffer.from('blob-cifrado-sintetico'),
        Buffer.from('segredos-sinteticos'),
        null,
        null,
        iso(NOW_MS),
      ],
    );
    const consumo = await consumir(client, `t:${id}`, NOW_MS + 10_000);
    assert.equal(consumo.out_resultado, 'ok');
    const usuario = await client.query(
      'select out_user_id from private.app_user_ensure($1, $2::uuid, $3::timestamptz)',
      [SENTINELA, randomUUID(), iso(NOW_MS)],
    );
    await client.query('select private.app_session_open_stage($1,$2,$3,$4,$5,$6,$7::timestamptz)', [
      randomUUID(),
      usuario.rows[0].out_user_id,
      id,
      'login',
      null,
      sha('segredo-varredura'),
      iso(NOW_MS + 10_000),
    ]);

    for (const tabela of ['app.app_session', 'app.auth_challenge', 'ops.job', 'ops.outbox_event']) {
      const { rows } = await client.query(`select to_jsonb(t)::text as j from ${tabela} t`);
      for (const r of rows) {
        assert.equal(r.j.includes(SENTINELA), false, `${tabela} sem e-mail em claro`);
        assert.equal(r.j.includes(`t:${id}`), false, `${tabela} sem token em claro`);
      }
    }
  }));

// ---------------------------------------------------------------------------------------------
// T-H012-23: 20 consumos simultaneos do mesmo token, em conexoes separadas, no banco real
// ---------------------------------------------------------------------------------------------

test('T-H012-23 20 consumos concorrentes do mesmo token: exatamente 1 ok', async () => {
  const id = randomUUID();
  const email = `concorre.${id}@example.test`;
  await inserirDesafio(id, email); // commitado: as conexoes separadas precisam enxergar a linha
  const conexoes = await Promise.all(Array.from({ length: 20 }, () => connect()));
  extras.push(...conexoes);
  try {
    const resultados = await Promise.all(
      conexoes.map((c) => consumir(c, `t:${id}`, NOW_MS + 60_000)),
    );
    const oks = resultados.filter((r) => r.out_resultado === 'ok');
    assert.equal(oks.length, 1, 'exatamente um consumo vence');
    assert.equal(resultados.filter((r) => r.out_resultado === 'invalido').length, 19);
  } finally {
    await client.query('delete from app.auth_challenge where id = $1', [id]);
  }
});
