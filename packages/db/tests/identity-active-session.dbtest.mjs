// H-014 | Testes de banco da sessao ativa (T-H014-01, 02, 06 parte no banco, 20, 21, 22, 23, 25 parte,
// 26; desenho 52 §1 a §3, §5). Banco de desenvolvimento. Os testes em transacao sao desfeitos; os
// de concorrencia gravam usuarios sinteticos (@example.test) e os removem no fim.
// Fora deste arquivo, sem cobertura ainda: T-H014-24 e T-H014-25 do step-up (migracao de step-up),
// e a API (T-H014-06/07/09/10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, MIGRATIONS_DIR } from '../scripts/lib/env.mjs';

const MIG = '20261111180000_identity_create_active_session';
let client;
const extras = [];
const criados = [];

before(async () => {
  client = await connect();
});
after(async () => {
  for (const c of extras) await c.end().catch(() => {});
  if (criados.length > 0) {
    await client.query('delete from app.app_session where user_id = any($1::uuid[])', [criados]);
    await client.query('delete from app.app_user where id = any($1::uuid[])', [criados]);
  }
  await client?.end();
});

const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const SEG = 1000;
const MIN = 60 * SEG;
const DIA = 24 * 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const novoSegredo = () => randomBytes(32).toString('base64url');

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Etapa de identificacao de um usuario sintetico. Commitada fora de transacao quando db e o cliente. */
async function semear(db, { nowMs = NOW, status = 'ativo' } = {}) {
  const userId = randomUUID();
  const email = `h014-${randomUUID()}@example.test`;
  await db.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)`,
    [userId, email, randomUUID(), status, iso(nowMs)],
  );
  criados.push(userId);
  const segredo = novoSegredo();
  const sessionId = randomUUID();
  await db.query(
    `select private.app_session_open_stage($1, $2, $3, 'login', null, $4, $5::timestamptz)`,
    [sessionId, userId, randomUUID(), sha(segredo), iso(nowMs)],
  );
  return { userId, sessionId, email, segredo, hash: sha(segredo) };
}

async function converter(db, hashAntigo, nowMs) {
  const novo = novoSegredo();
  const r = await db.query('select * from private.app_session_convert($1, $2, $3::timestamptz)', [
    hashAntigo,
    sha(novo),
    iso(nowMs),
  ]);
  return { novo, linha: r.rows[0] ?? null };
}

async function guarda(db, hash, nowMs) {
  const r = await db.query('select * from private.app_session_get($1, $2::timestamptz)', [
    hash,
    iso(nowMs),
  ]);
  return r.rows[0] ?? null;
}

/** Espera violacao de restricao no SAVEPOINT; desfaz so o comando (a transacao segue). */
async function viola(db, sql, params, codigo) {
  await db.query('savepoint h014');
  try {
    await db.query(sql, params);
  } catch (e) {
    assert.equal(e.code, codigo, `codigo SQL esperado ${codigo}, veio ${e.code}`);
    return;
  } finally {
    await db.query('rollback to savepoint h014');
  }
  assert.fail(`deveria violar ${codigo}`);
}

// ---------------------------------------------------------------------------------------------
// T-H014-01: conversao da etapa
// ---------------------------------------------------------------------------------------------

test('T-H014-01 conversao: etapa valida vira ativa, prazo fixo de 7 dias, prova recente e segredo novo', () =>
  tx(async () => {
    const s = await semear(client);
    const { novo, linha } = await converter(client, s.hash, NOW + MIN);
    assert.ok(linha, 'a etapa valida converte');
    assert.equal(linha.out_session_id, s.sessionId);
    assert.equal(linha.out_user_id, s.userId);
    const { rows } = await client.query(
      'select stage, expires_at, absolute_expires_at, recent_auth_at, auth_method, secret_hash from app.app_session where id = $1',
      [s.sessionId],
    );
    assert.equal(rows[0].stage, 'ativa');
    assert.equal(new Date(rows[0].expires_at).getTime(), NOW + 7 * DIA);
    assert.equal(new Date(rows[0].absolute_expires_at).getTime(), NOW + 7 * DIA);
    assert.equal(new Date(rows[0].recent_auth_at).getTime(), NOW + MIN);
    assert.equal(rows[0].auth_method, 'link');
    assert.equal(rows[0].secret_hash, sha(novo));
    assert.notEqual(sha(novo), s.hash, 'o hash do segredo muda na conversao');
    assert.equal(await guarda(client, s.hash, NOW + 2 * MIN), null, 'segredo antigo nao vale mais');
    assert.ok(await guarda(client, sha(novo), NOW + 2 * MIN), 'segredo novo vale');
  }));

// ---------------------------------------------------------------------------------------------
// T-H014-02: conversao negada, sem sessao criada
// ---------------------------------------------------------------------------------------------

test('T-H014-02 conversao negada: vencida no exato e +1 s, revogada, bloqueada, ja convertida, desconhecida', () =>
  tx(async () => {
    const vencida = await semear(client);
    assert.equal((await converter(client, vencida.hash, NOW + 15 * MIN)).linha, null);
    const vencidaMais = await semear(client);
    assert.equal((await converter(client, vencidaMais.hash, NOW + 15 * MIN + SEG)).linha, null);

    const revogada = await semear(client);
    await client.query('update app.app_session set revoked_at = $2::timestamptz where id = $1', [
      revogada.sessionId,
      iso(NOW),
    ]);
    assert.equal((await converter(client, revogada.hash, NOW + MIN)).linha, null);

    const bloqueada = await semear(client, { status: 'bloqueado' });
    assert.equal((await converter(client, bloqueada.hash, NOW + MIN)).linha, null);

    const convertida = await semear(client);
    assert.ok((await converter(client, convertida.hash, NOW + MIN)).linha);
    assert.equal((await converter(client, convertida.hash, NOW + 2 * MIN)).linha, null, 'uso unico');

    assert.equal((await converter(client, sha('desconhecido-sintetico'), NOW + MIN)).linha, null);

    const { rows } = await client.query(
      `select count(*)::int as n from app.app_session
        where id = any($1::uuid[]) and stage = 'ativa'`,
      [[vencida.sessionId, vencidaMais.sessionId, revogada.sessionId, bloqueada.sessionId]],
    );
    assert.equal(rows[0].n, 0, 'nenhuma das negadas virou sessao');
  }));

// ---------------------------------------------------------------------------------------------
// T-H014-06 (parte no banco): saida revoga so a sessao informada; sair de todos revoga o resto
// ---------------------------------------------------------------------------------------------

test('T-H014-06 saida: revoga so a sessao atual (idempotente); sair de todos revoga as demais', () =>
  tx(async () => {
    const s1 = await semear(client);
    const c1 = await converter(client, s1.hash, NOW + MIN);
    const seg2 = novoSegredo();
    const sessao2 = randomUUID();
    await client.query(
      `select private.app_session_open_stage($1, $2, $3, 'login', null, $4, $5::timestamptz)`,
      [sessao2, s1.userId, randomUUID(), sha(seg2), iso(NOW)],
    );
    const c2 = await converter(client, sha(seg2), NOW + 2 * MIN);
    assert.ok(c1.linha && c2.linha, 'duas sessoes da mesma pessoa');

    const revoga = (id, now) =>
      client.query('select private.app_session_revoke($1, $2::timestamptz) as ok', [id, iso(now)]);
    assert.equal((await revoga(s1.sessionId, NOW + 3 * MIN)).rows[0].ok, true);
    assert.equal((await revoga(s1.sessionId, NOW + 4 * MIN)).rows[0].ok, true, 'repetir nao falha');
    assert.equal(await guarda(client, sha(c1.novo), NOW + 5 * MIN), null);
    assert.ok(await guarda(client, sha(c2.novo), NOW + 5 * MIN), 'a outra sessao continua valida');

    const sairTodas = await client.query(
      'select private.app_session_revoke_all($1, $2::timestamptz) as n',
      [s1.userId, iso(NOW + 6 * MIN)],
    );
    assert.equal(sairTodas.rows[0].n, 1, 'so restava uma sessao nao revogada');
    assert.equal(await guarda(client, sha(c2.novo), NOW + 7 * MIN), null);
  }));

// ---------------------------------------------------------------------------------------------
// T-H014-20: 20 conversoes simultaneas da mesma etapa
// ---------------------------------------------------------------------------------------------

test('T-H014-20 20 conversoes simultaneas da mesma etapa: exatamente 1 sucesso e 1 linha', async () => {
  const s = await semear(client);
  const conns = await Promise.all(Array.from({ length: 20 }, () => connect()));
  extras.push(...conns);
  const resultados = await Promise.all(conns.map((c) => converter(c, s.hash, NOW + MIN)));
  const vencedores = resultados.filter((r) => r.linha !== null);
  assert.equal(vencedores.length, 1, 'uma so conversao vence');
  const { rows } = await client.query(
    'select count(*)::int as n, min(secret_hash) as h from app.app_session where id = $1 and stage = $2',
    [s.sessionId, 'ativa'],
  );
  assert.equal(rows[0].n, 1);
  assert.equal(rows[0].h, sha(vencedores[0].novo), 'a linha guarda o segredo do vencedor');
  for (const c of conns) await c.end();
  extras.length = 0;
});

// ---------------------------------------------------------------------------------------------
// T-H014-21: conversao x sair de todos, 50 rodadas: nunca sobra sessao ativa viva
// ---------------------------------------------------------------------------------------------

test('T-H014-21 conversao x sair de todos, 50 rodadas: nunca sobra sessao ativa viva', async () => {
  const a = await connect();
  const b = await connect();
  try {
    for (let i = 0; i < 50; i += 1) {
      const s = await semear(client);
      const [conv] = await Promise.all([
        converter(a, s.hash, NOW + MIN),
        b.query('select private.app_session_revoke_all($1, $2::timestamptz) as n', [
          s.userId,
          iso(NOW + 2 * MIN),
        ]),
      ]);
      const { rows } = await client.query(
        `select count(*)::int as vivas from app.app_session
          where user_id = $1 and stage = 'ativa' and revoked_at is null`,
        [s.userId],
      );
      assert.equal(rows[0].vivas, 0, `rodada ${i}: sessao viva depois de sair de todos`);
      if (conv.linha) {
        const { rows: r2 } = await client.query(
          `select revoked_at from app.app_session where id = $1`,
          [s.sessionId],
        );
        assert.notEqual(r2[0].revoked_at, null, `rodada ${i}: conversao ganhou e foi revogada`);
      }
    }
  } finally {
    await a.end();
    await b.end();
  }
});

// ---------------------------------------------------------------------------------------------
// T-H014-22: restricoes, migracao repetivel e rollback executavel
// ---------------------------------------------------------------------------------------------

test('T-H014-22 restricoes: ativa sem prova, prazo fora do teto, hash repetido, metodo invalido e etapa com prova', () =>
  tx(async () => {
    const s = await semear(client);
    const outra = await semear(client);
    await viola(
      client,
      `update app.app_session set stage = 'ativa', expires_at = absolute_expires_at where id = $1`,
      [s.sessionId],
      '23514',
    );
    await viola(
      client,
      `update app.app_session set stage = 'ativa', recent_auth_at = $2::timestamptz,
         expires_at = absolute_expires_at - interval '1 hour' where id = $1`,
      [s.sessionId, iso(NOW)],
      '23514',
    );
    await viola(
      client,
      `update app.app_session set secret_hash = $2 where id = $1`,
      [s.sessionId, outra.hash],
      '23505',
    );
    await viola(client, `update app.app_session set auth_method = 'sms' where id = $1`, [s.sessionId], '23514');
    await viola(
      client,
      `update app.app_session set recent_auth_at = $2::timestamptz where id = $1`,
      [s.sessionId, iso(NOW)],
      '23514',
    );
  }));

test('T-H014-22 migracao repetivel e rollback executavel (ensaio em transacao, desfeito)', () =>
  tx(async () => {
    const mig = readFileSync(join(MIGRATIONS_DIR, `${MIG}.sql`), 'utf8');
    await client.query(mig);
    const down = readFileSync(
      join(MIGRATIONS_DIR, '..', 'rollbacks', `${MIG}.down.sql`),
      'utf8',
    )
      .replace(/^begin;\s*$/gim, '')
      .replace(/^commit;\s*$/gim, '');
    await client.query(down);
    const { rows } = await client.query(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'app' and table_name = 'app_session'
          and column_name in ('recent_auth_at', 'auth_method')`,
    );
    assert.equal(rows[0].n, 0, 'o rollback tira as colunas nesta transacao');
  }));

test('T-H014-22 RLS forcada na app_session e so app_system executa as 5 funcoes novas', async () => {
  const rls = await client.query(
    `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = 'app_session'`,
  );
  assert.equal(rls.rows[0].relrowsecurity, true);
  assert.equal(rls.rows[0].relforcerowsecurity, true);

  const { rows } = await client.query(`
    select p.proname,
      has_function_privilege('app_system', p.oid, 'execute') as sistema,
      exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('service_role', p.oid, 'execute') as service_role
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('app_session_convert', 'app_session_get', 'app_session_revoke',
                         'app_session_revoke_all', 'app_session_mark_recent_auth')`);
  assert.equal(rows.length, 5, 'as 5 funcoes existem');
  for (const r of rows) {
    assert.equal(r.sistema, true, `${r.proname}: app_system executa`);
    assert.equal(r.publico, false, `${r.proname}: PUBLIC nao executa`);
    assert.equal(r.anon, false, `${r.proname}: anon nao executa`);
    assert.equal(r.authenticated, false, `${r.proname}: authenticated nao executa`);
    assert.equal(r.service_role, false, `${r.proname}: service_role nao executa`);
  }
});

// ---------------------------------------------------------------------------------------------
// T-H014-23: guarda com relogio (7 d - 1 s, 7 d, 7 d + 1 s), revogada e usuario bloqueado
// ---------------------------------------------------------------------------------------------

test('T-H014-23 guarda: 7 d - 1 s serve; 7 d e 7 d + 1 s nao; leitura nao adia prazo; bloqueio e revogacao derrubam', () =>
  tx(async () => {
    const s = await semear(client);
    const { novo, linha } = await converter(client, s.hash, NOW + MIN);
    assert.ok(linha);
    const h = sha(novo);

    assert.ok(await guarda(client, h, NOW + 7 * DIA - SEG), 'um segundo antes do teto serve');
    const { rows } = await client.query('select expires_at from app.app_session where id = $1', [
      s.sessionId,
    ]);
    assert.equal(new Date(rows[0].expires_at).getTime(), NOW + 7 * DIA, 'a leitura nao adia o prazo');
    assert.equal(await guarda(client, h, NOW + 7 * DIA), null, 'no instante exato, nao serve');
    assert.equal(await guarda(client, h, NOW + 7 * DIA + SEG), null, 'depois do teto, nao serve');

    await client.query('update app.app_user set status = $2 where id = $1', [s.userId, 'bloqueado']);
    assert.equal(await guarda(client, h, NOW + 2 * MIN), null, 'usuario bloqueado derruba a sessao');
    await client.query('update app.app_user set status = $2 where id = $1', [s.userId, 'ativo']);
    assert.ok(await guarda(client, h, NOW + 2 * MIN));

    await client.query('update app.app_session set revoked_at = $2::timestamptz where id = $1', [
      s.sessionId,
      iso(NOW + 3 * MIN),
    ]);
    assert.equal(await guarda(client, h, NOW + 4 * MIN), null, 'revogada nao serve');
  }));

test('T-H014-25 (parte) sessao nao grava e-mail em claro: to_jsonb da linha nao contem o endereco', () =>
  tx(async () => {
    const s = await semear(client);
    await converter(client, s.hash, NOW + MIN);
    const { rows } = await client.query(
      'select to_jsonb(x)::text as t from app.app_session x where x.id = $1',
      [s.sessionId],
    );
    assert.equal(rows[0].t.includes(s.email), false);
    assert.equal(rows[0].t.includes('@'), false);
  }));
