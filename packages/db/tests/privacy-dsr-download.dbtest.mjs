// Issue 120 (H-111) | Download do extrato por token de uso unico (147-DESENHO-H111 D-A6, §7). Banco de desenvolvimento.
// Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const hex = () => randomBytes(32).toString('hex');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function protocolo() {
  let sufixo = '';
  for (let i = 0; i < 6; i += 1) sufixo += B32[randomBytes(1)[0] % 32];
  return `DSR-20261120-${sufixo}`;
}

function novoToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro (ou falha o teste). */
async function erroDe(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  assert.fail(`deveria ter falhado: ${sql.slice(0, 80)}`);
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

/** Caso de acesso deferido e extrato registrado (fixture direta nas funcoes do banco). */
async function extratoRegistrado(sujeito) {
  const { rows } = await client.query(
    `insert into app.dsr_case (protocol, subject_user_id, kind, deadline_at)
     values ($1, $2, 'acesso', now() + interval '15 days') returning id`,
    [protocolo(), sujeito],
  );
  const caso = rows[0].id;
  await client.query(`update app.dsr_case set status = 'em_analise' where id = $1`, [caso]);
  await client.query(`update app.dsr_case set status = 'deferido' where id = $1`, [caso]);
  await client.query('select out_case_id from app.dsr_register_extract($1::uuid, $2, $3, $4, $5::integer)', [
    caso,
    `${randomUUID()}.json`,
    hex(),
    hex(),
    2048,
  ]);
  return caso;
}

const EMITIR = 'select out_expires_at from app.dsr_issue_extract_token($1::uuid, $2::uuid, $3)';
const CONSUMIR = 'select * from app.dsr_consume_extract_token($1)';

test('o dono recebe token de ate 5 min e so o hash fica no banco', () =>
  tx(async () => {
    const dono = await usuario();
    const caso = await extratoRegistrado(dono);
    const { token, hash } = novoToken();
    const { rows } = await client.query(EMITIR, [dono, caso, hash]);
    const { rows: rel } = await client.query('select now() as agora');
    const expira = new Date(rows[0].out_expires_at).getTime();
    const agora = new Date(rel[0].agora).getTime();
    assert.ok(expira - agora > 4 * 60_000 && expira - agora <= 5 * 60_000, 'validade de ate 5 min, pelo relogio do banco');
    const { rows: t } = await client.query('select token_hash from app.dsr_download_token where case_id = $1', [caso]);
    assert.equal(t.length, 1);
    assert.equal(t[0].token_hash, hash);
    assert.ok(!JSON.stringify(t).includes(token), 'o token em claro nao aparece no banco');
  }));

test('o consumo e de uso unico: a primeira vez devolve o arquivo, a segunda e recusada', () =>
  tx(async () => {
    const dono = await usuario();
    const caso = await extratoRegistrado(dono);
    const { hash } = novoToken();
    await client.query(EMITIR, [dono, caso, hash]);
    const { rows } = await client.query(CONSUMIR, [hash]);
    assert.equal(rows[0].out_case_id, caso);
    assert.equal(rows[0].out_subject_user_id, dono);
    assert.match(rows[0].out_storage_path, /\.json$/);
    assert.equal(rows[0].out_size_bytes, 2048);
    const err = await erroDe(CONSUMIR, [hash]);
    assert.match(err.message, /dsr_token_usado/);
    const { rows: e } = await client.query('select download_count from app.dsr_export where case_id = $1', [caso]);
    assert.equal(Number(e[0].download_count), 1);
  }));

test('caso de outro titular ou inexistente recebe a mesma recusa (dsr_nao_encontrado)', () =>
  tx(async () => {
    const dono = await usuario();
    const outro = await usuario();
    const caso = await extratoRegistrado(dono);
    const err1 = await erroDe(EMITIR, [outro, caso, novoToken().hash]);
    assert.match(err1.message, /dsr_nao_encontrado/);
    const err2 = await erroDe(EMITIR, [dono, randomUUID(), novoToken().hash]);
    assert.match(err2.message, /dsr_nao_encontrado/);
  }));

test('token desconhecido e recusado sem revelar mais que o codigo', () =>
  tx(async () => {
    const err = await erroDe(CONSUMIR, [novoToken().hash]);
    assert.match(err.message, /dsr_token_invalido/);
  }));

test('token vencido e recusado (dsr_token_expirado) e nao marca o arquivo', () =>
  tx(async () => {
    const dono = await usuario();
    const caso = await extratoRegistrado(dono);
    const { hash } = novoToken();
    await client.query(
      `insert into app.dsr_download_token (token_hash, export_id, case_id, subject_user_id, issued_at, expires_at)
       select $1, e.id, e.case_id, $2, now() - interval '10 minutes', now() - interval '5 minutes'
         from app.dsr_export e where e.case_id = $3`,
      [hash, dono, caso],
    );
    const err = await erroDe(CONSUMIR, [hash]);
    assert.match(err.message, /dsr_token_expirado/);
    const { rows } = await client.query('select download_count from app.dsr_export where case_id = $1', [caso]);
    assert.equal(Number(rows[0].download_count), 0);
  }));

test('o registro de tokens nao aceita DELETE nem hash fora do formato', () =>
  tx(async () => {
    const dono = await usuario();
    const caso = await extratoRegistrado(dono);
    const { hash } = novoToken();
    await client.query(EMITIR, [dono, caso, hash]);
    const errDel = await erroDe('delete from app.dsr_download_token');
    assert.match(errDel.message, /dsr_registro_nao_deletavel/);
    const errHash = await erroDe(
      `insert into app.dsr_download_token (token_hash, export_id, case_id, subject_user_id, expires_at)
       select 'ABC', e.id, e.case_id, $1, now() + interval '1 minute' from app.dsr_export e where e.case_id = $2`,
      [dono, caso],
    );
    assert.match(errHash.message, /dsr_download_token_hash_check/);
  }));
