// H-011 | Testes de banco do desafio de acesso (T-H011-20, 21, 23, 24, 25, 26, 27; desenho 39 §6).
// Banco de desenvolvimento, cada teste numa transacao desfeita (rollback). Sem rede; sem envio.
// Os valores sao sinteticos (e-mails @example.test; tokens e codigos derivados de UUID).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const at = (seconds) => new Date(NOW_MS + seconds * 1000);
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

/** Cria um desafio com os hashes derivados do id (token = t:<id>, codigo = c:<id>). */
async function criar({
  email = 'cliente@example.test',
  id = randomUUID(),
  seconds = 0,
  purpose = 'login',
} = {}) {
  const { rows } = await client.query(
    `select * from private.auth_challenge_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      EMAIL_HASH(email),
      purpose,
      sha(`t:${id}`),
      sha(`c:${id}`),
      Buffer.from('blob-email'),
      Buffer.from('blob-segredos'),
      null,
      null,
      at(seconds),
    ],
  );
  return { id, ...rows[0] };
}

const consumirLink = (token, seconds) =>
  client.query('select * from private.auth_challenge_consume_link($1,$2)', [
    sha(token),
    at(seconds),
  ]);

const verificar = (id, email, codigo, seconds, max = 5) =>
  client.query('select * from private.auth_challenge_verify_code($1,$2,$3,$4,$5,$6)', [
    id,
    EMAIL_HASH(email),
    'login',
    sha(codigo),
    max,
    at(seconds),
  ]);

test('T-H011-20 criacao: validade de 15 min, hashes em 64 hex e nada em claro', () =>
  tx(async () => {
    const email = 'sentinela.h011@example.test';
    const c = await criar({ email });
    assert.equal(c.out_resultado, 'criado');
    const { rows } = await client.query(
      `select to_jsonb(a)::text as json, extract(epoch from (a.expires_at - a.created_at)) as validade,
              a.token_hash, a.code_hmac
         from app.auth_challenge a where a.id = $1`,
      [c.id],
    );
    assert.equal(Number(rows[0].validade), 900);
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
    assert.match(rows[0].code_hmac, /^[0-9a-f]{64}$/);
    assert.equal(rows[0].json.includes(email), false, 'endereco nao pode aparecer em claro');
    assert.equal(rows[0].json.includes(`t:${c.id}`), false, 'token nao pode aparecer em claro');
  }));

test('T-H011-21 novo pedido substitui o anterior; so um desafio vivo por e-mail', () =>
  tx(async () => {
    const email = 'substituicao.h011@example.test';
    const primeiro = await criar({ email, seconds: 0 });
    const segundo = await criar({ email, seconds: 61 });
    assert.equal(segundo.out_resultado, 'criado');
    const { rows } = await client.query(
      'select invalid_reason, email_enc from app.auth_challenge where id = $1',
      [primeiro.id],
    );
    assert.equal(rows[0].invalid_reason, 'substituido');
    assert.equal(rows[0].email_enc, null);
    const link = await consumirLink(`t:${primeiro.id}`, 62);
    assert.equal(link.rows[0].out_resultado, 'invalido');
  }));

test('T-H011-21 indice unico impede segundo desafio vivo para o mesmo par', () =>
  tx(async () => {
    const email = 'indice.h011@example.test';
    await criar({ email, seconds: 0 });
    await client.query('savepoint sp');
    await assert.rejects(
      client.query(
        `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, expires_at, created_at)
         values ($1, $2, 'login', $3, $4, $5, $6)`,
        [randomUUID(), EMAIL_HASH(email), sha('x'), sha('y'), at(900), at(0)],
      ),
      (err) => err.code === '23505',
    );
    await client.query('rollback to savepoint sp');
  }));

test('T-H011-22/21 limites: 59 s espera; 5 pedidos na hora; sexto recebe teto com retry_after', () =>
  tx(async () => {
    const email = 'limite.h011@example.test';
    await criar({ email, seconds: 0 });
    const espera = await criar({ email, seconds: 59 });
    assert.equal(espera.out_resultado, 'espera');
    assert.equal(espera.out_retry_after, 1);
    for (const s of [61, 122, 183, 244]) {
      assert.equal((await criar({ email, seconds: s })).out_resultado, 'criado');
    }
    const teto = await criar({ email, seconds: 305 });
    assert.equal(teto.out_resultado, 'teto');
    assert.equal(teto.out_retry_after, 3600 - 305);
    const { rows } = await client.query(
      `select count(*)::int as n from app.auth_challenge where email_hash = $1`,
      [EMAIL_HASH(email)],
    );
    assert.equal(rows[0].n, 5, 'pedido barrado nao cria linha');
  }));

test('T-H011-23 link: uso unico; reuso, inexistente e expirado devolvem o mesmo invalido', () =>
  tx(async () => {
    const usado = await criar({ email: 'link1.h011@example.test', seconds: 0 });
    const ok = await consumirLink(`t:${usado.id}`, 10);
    assert.equal(ok.rows[0].out_resultado, 'ok');
    assert.equal(ok.rows[0].out_purpose, 'login');
    assert.ok(ok.rows[0].out_email_enc, 'o endereco cifrado e devolvido uma vez');
    const reuso = await consumirLink(`t:${usado.id}`, 11);
    assert.deepEqual(
      reuso.rows[0],
      (await consumirLink('inexistente-' + randomUUID(), 11)).rows[0],
    );
    assert.equal(reuso.rows[0].out_resultado, 'invalido');

    const expira = await criar({ email: 'link2.h011@example.test', seconds: 0 });
    const tarde = await consumirLink(`t:${expira.id}`, 900 + 1);
    assert.equal(tarde.rows[0].out_resultado, 'invalido');
    const lin = await client.query(
      'select invalid_reason, secrets_enc, email_enc from app.auth_challenge where id = $1',
      [expira.id],
    );
    assert.equal(lin.rows[0].secrets_enc, null);
    assert.equal(lin.rows[0].email_enc, null);
  }));

test('T-H011-24 codigo: 4 erros e o certo valem; 5 erros invalidam; o 6o certo nao vale', () =>
  tx(async () => {
    const a = await criar({ email: 'codigo1.h011@example.test', seconds: 0 });
    for (let i = 1; i <= 4; i += 1) {
      const r = await verificar(a.id, 'codigo1.h011@example.test', `erro-${i}`, i);
      assert.equal(r.rows[0].out_resultado, 'errado');
      assert.equal(r.rows[0].out_attempts_restantes, 5 - i);
    }
    const certo = await verificar(a.id, 'codigo1.h011@example.test', `c:${a.id}`, 6);
    assert.equal(certo.rows[0].out_resultado, 'ok');

    const b = await criar({ email: 'codigo2.h011@example.test', seconds: 0 });
    for (let i = 1; i <= 4; i += 1)
      await verificar(b.id, 'codigo2.h011@example.test', `erro-${i}`, i);
    const quinto = await verificar(b.id, 'codigo2.h011@example.test', 'erro-5', 5);
    assert.equal(quinto.rows[0].out_resultado, 'invalido');
    const sexto = await verificar(b.id, 'codigo2.h011@example.test', `c:${b.id}`, 6);
    assert.equal(sexto.rows[0].out_resultado, 'invalido');
  }));

test('T-H011-24 usar o link mata o codigo e vice-versa', () =>
  tx(async () => {
    const email = 'cruzado.h011@example.test';
    const a = await criar({ email, seconds: 0 });
    assert.equal((await consumirLink(`t:${a.id}`, 5)).rows[0].out_resultado, 'ok');
    assert.equal((await verificar(a.id, email, `c:${a.id}`, 6)).rows[0].out_resultado, 'invalido');
  }));

test('T-H011-25 saida de e-mail: classe auth, so challenge_ref, dedupe por desafio', () =>
  tx(async () => {
    const email = 'saida.h011@example.test';
    const c = await criar({ email, seconds: 0 });
    assert.ok(c.out_outbox_id, 'a saida foi criada');
    const { rows } = await client.query(
      `select class, email_type, template, template_params, dedupe_key, recipient_user_id
         from ops.email_outbox where id = $1`,
      [c.out_outbox_id],
    );
    assert.equal(rows[0].class, 'auth');
    assert.equal(rows[0].email_type, 'acesso_login');
    assert.equal(rows[0].dedupe_key, `ac:${c.id}`);
    assert.deepEqual(rows[0].template_params, { challenge_ref: c.id });
    assert.equal(rows[0].recipient_user_id, c.id);
  }));

test('T-H011-26 expurgo: zera blobs de vencidos e remove linhas com mais de 24 h', () =>
  tx(async () => {
    const velho = await criar({ email: 'velho.h011@example.test', seconds: -25 * 3600 });
    const recente = await criar({ email: 'recente.h011@example.test', seconds: -3600 });
    const { rows } = await client.query('select * from private.auth_challenge_purge($1)', [at(0)]);
    assert.ok(rows[0].out_removidos >= 1);
    const sobra = await client.query(
      'select id from app.auth_challenge where id in ($1,$2) order by id',
      [velho.id, recente.id],
    );
    assert.deepEqual(
      sobra.rows.map((r) => r.id),
      [recente.id],
    );
  }));

test('T-H011-27 permissoes: anon e authenticated sem acesso; app_system com o minimo', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select
        has_table_privilege('anon', 'app.auth_challenge', 'select') as anon_select,
        has_table_privilege('authenticated', 'app.auth_challenge', 'select') as auth_select,
        has_table_privilege('app_system', 'app.auth_challenge', 'select') as system_select,
        has_function_privilege('anon',
          'private.auth_challenge_create(uuid,text,text,text,text,bytea,bytea,uuid,text,timestamptz)',
          'execute') as anon_exec,
        has_function_privilege('app_system',
          'private.auth_challenge_create(uuid,text,text,text,text,bytea,bytea,uuid,text,timestamptz)',
          'execute') as system_exec`);
    assert.equal(rows[0].anon_select, false);
    assert.equal(rows[0].auth_select, false);
    assert.equal(rows[0].system_select, true);
    assert.equal(rows[0].anon_exec, false);
    assert.equal(rows[0].system_exec, true);

    // Verificacao generica de todos os papeis. Superusuarios ficam fora (bypass implicito do motor,
    // nao concedido). Leitores aceitos, com motivo:
    //  - app_backup_reader: politica de backup de H-010 (leitura de todo o esquema app para o dump);
    //  - pg_read_all_data, pg_write_all_data, supabase_etl_admin, supabase_read_only_user: papeis
    //    da plataforma Supabase, fora do controle da migracao.
    // Escrita (INSERT, UPDATE, DELETE): so o dono, app_system e pg_write_all_data (papel
    // predefinido da plataforma Supabase, concedido pela plataforma e fora do controle desta
    // migracao). Qualquer outro papel reprova. PUBLIC nao pode ter ACL na tabela.
    const LEITORES_ACEITOS = [
      'app_backup_reader',
      'pg_read_all_data',
      'pg_write_all_data',
      'supabase_etl_admin',
      'supabase_read_only_user',
    ];
    const { rows: leitores } = await client.query(
      `select r.rolname
         from pg_roles r
        where not r.rolsuper
          and r.rolname <> 'app_system'
          and r.oid <> (select c.relowner from pg_class c where c.oid = 'app.auth_challenge'::regclass)
          and has_table_privilege(r.oid, 'app.auth_challenge', 'SELECT')
        order by r.rolname`,
    );
    assert.deepEqual(
      leitores.map((r) => r.rolname).filter((nome) => !LEITORES_ACEITOS.includes(nome)),
      [],
    );

    const { rows: escritores } = await client.query(
      `select r.rolname
         from pg_roles r
        where not r.rolsuper
          and r.rolname <> 'app_system'
          and r.oid <> (select c.relowner from pg_class c where c.oid = 'app.auth_challenge'::regclass)
          and (has_table_privilege(r.oid, 'app.auth_challenge', 'INSERT')
            or has_table_privilege(r.oid, 'app.auth_challenge', 'UPDATE')
            or has_table_privilege(r.oid, 'app.auth_challenge', 'DELETE'))
        order by r.rolname`,
    );
    assert.deepEqual(
      escritores.map((r) => r.rolname).filter((nome) => nome !== 'pg_write_all_data'),
      [],
    );

    const { rows: publico } = await client.query(`
      select exists (
        select 1 from pg_class c, aclexplode(c.relacl) a
         where c.oid = 'app.auth_challenge'::regclass and a.grantee = 0) as public_grant`);
    assert.equal(publico[0].public_grant, false);
  }));
