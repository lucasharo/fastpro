// Issue 52 (H-039) | Concorrencia da fila de verificacao (docs/factory/124-DESENHO-H039.md, T-13 e T-24).
// Duas conexoes ao banco de desenvolvimento. Estes testes GRAVAM dados sinteticos com marcador unico
// (MARCA no e-mail, @example.test): a serializacao so se prova com transacoes que confirmam em outra
// conexao, por isso nao ha rollback. Nada e apagado. Sem rede, sem envio de e-mail, sem Mapbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout as pausa } from 'node:timers/promises';
import { connect } from '../scripts/lib/env.mjs';

let a;
let b;
before(async () => {
  a = await connect();
  b = await connect();
});
after(async () => {
  await a?.end();
  await b?.end();
});

const MARCA = `h039-${randomUUID().slice(0, 8)}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const SQL_ASSIGN = 'select * from private.verification_case_assign($1,$2,$3,$4,$5)';
const SQL_DECIDE = 'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)';
const SQL_READ = 'select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)';
const SQL_DELETE = 'select private.idoc_delete($1,$2,$3) as resultado';
// idoc_delete devolve texto: deleted, already_analyzed ou not_found (nao lanca erro).

async function usuario(c) {
  const id = randomUUID();
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${MARCA}-${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

async function staffComPapel(c, role) {
  const id = await usuario(c);
  await c.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await c.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [id, role],
  );
  return id;
}

async function sessao(c, userId, ms) {
  const secret = sha(randomUUID());
  const { rows } = await c.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

async function profissional(c) {
  const id = await usuario(c);
  await c.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'pendente', now(), now())`,
    [id],
  );
  return id;
}

async function documentoRecebido(c, profId, ms) {
  const id = randomUUID();
  await c.query(
    `insert into app.identity_document (id, professional_id, client_upload_id, declared_type, declared_bytes,
       status, pending_expires_at)
     values ($1, $2, $3, 'image/jpeg', 1000, 'pendente_envio', now() + interval '30 minutes')`,
    [id, profId, randomUUID()],
  );
  await c.query(
    `update app.identity_document set status = 'recebido', stored_type = 'image/jpeg',
       stored_bytes = 16, content_sha256 = $2, received_at = $3 where id = $1`,
    [id, Buffer.alloc(32, 7), at(ms)],
  );
  return id;
}

async function casoDe(c, profId) {
  const { rows } = await c.query(
    'select id, version from app.verification_case where professional_id = $1', [profId]);
  return rows[0];
}

/** Resolve a promessa em erro (nulo se nao falhou). Nunca rejeita: a espera e feita depois do commit. */
const erroDe = (promessa) => promessa.then(() => null, (err) => err);

test('T-24: duas atribuicoes simultaneas: uma vence, a outra recebe VRF01; decisao com versao antiga tambem', async () => {
  const prof = await profissional(a);
  await documentoRecebido(a, prof, T0);
  const caso = await casoDe(a, prof);
  const v1 = await staffComPapel(a, 'verificacao');
  const v2 = await staffComPapel(a, 'verificacao');
  const s1 = await sessao(a, v1, T0);
  const s2 = await sessao(a, v2, T0);

  await a.query('begin');
  let venceu;
  try {
    venceu = await a.query(SQL_ASSIGN, [v1, s1, caso.id, caso.version, at(T0)]);
    const perdeu = erroDe(b.query(SQL_ASSIGN, [v2, s2, caso.id, caso.version, at(T0)]));
    await pausa(500);
    await a.query('commit');
    const erro = await perdeu;
    assert.equal(venceu.rows[0].out_status, 'em_revisao', 'a primeira atribuicao vence');
    assert.equal(erro?.code, 'VRF01', 'a segunda recebe conflito de caso');
  } catch (err) {
    await a.query('rollback').catch(() => {});
    throw err;
  }

  const decisaoAntiga = erroDe(b.query(SQL_DECIDE,
    [v1, s1, caso.id, 'recusada', 'documento_ilegivel', null, caso.version, at(T0)]));
  assert.equal((await decisaoAntiga)?.code, 'VRF01', 'decisao com versao antiga recebe conflito');
});

test('T-13: leitura e exclusao do dono se serializam; exclusao antes da leitura impede a leitura (VRF06)', async () => {
  // (1) leitura confirmada primeiro: a exclusao espera e nao apaga documento analisado.
  const prof1 = await profissional(a);
  const doc1 = await documentoRecebido(a, prof1, T0);
  const caso1 = await casoDe(a, prof1);
  const v1 = await staffComPapel(a, 'verificacao');
  const s1 = await sessao(a, v1, T0);
  await a.query(SQL_ASSIGN, [v1, s1, caso1.id, caso1.version, at(T0)]);

  await a.query('begin');
  try {
    await a.query(SQL_READ, [v1, s1, caso1.id, doc1, 'analise_inicial', at(T0)]);
    const exclusao = b.query(SQL_DELETE, [prof1, doc1, at(T0)]).then((r) => r.rows[0].resultado);
    await pausa(500);
    await a.query('commit');
    assert.equal(await exclusao, 'already_analyzed', 'a exclusao depois da leitura nao apaga (409 equivalente)');
  } catch (err) {
    await a.query('rollback').catch(() => {});
    throw err;
  }
  const analisado = await a.query('select analyzed_at from app.identity_document where id = $1', [doc1]);
  assert.ok(analisado.rows[0]?.analyzed_at instanceof Date, 'documento analisado continua existindo');

  // (2) exclusao confirmada primeiro: a leitura posterior recebe documento indisponivel (VRF06).
  const prof2 = await profissional(a);
  const doc2 = await documentoRecebido(a, prof2, T0);
  const caso2 = await casoDe(a, prof2);
  const v2 = await staffComPapel(a, 'verificacao');
  const s2 = await sessao(a, v2, T0);
  await a.query(SQL_ASSIGN, [v2, s2, caso2.id, caso2.version, at(T0)]);
  assert.equal((await b.query(SQL_DELETE, [prof2, doc2, at(T0)])).rows[0].resultado, 'deleted', 'exclusao sem leitura e aceita');
  assert.equal((await erroDe(a.query(SQL_READ, [v2, s2, caso2.id, doc2, 'analise_inicial', at(T0)])))?.code,
    'VRF06', 'leitura apos a exclusao recebe documento indisponivel');
});
