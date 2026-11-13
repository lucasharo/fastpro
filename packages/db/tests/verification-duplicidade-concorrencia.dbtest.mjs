// Issue 53 (H-040) | Concorrencia da retencao por duplicidade (docs/factory/134-DESENHO-H040.md §3.3; T40-04 e T40-05).
// Diferente dos demais dbtests da H-040, aqui os dados sao COMMITADOS: a corrida exige duas conexoes com commit real.
// Os registros tem marcador H040, e-mails @example.test e documento falso. Nada e apagado (decisao 542).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/verification-duplicidade-concorrencia.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let c1;
let c2;
let c3;
before(async () => {
  c1 = await connect();
  c2 = await connect();
  c3 = await connect();
});
after(async () => {
  await c1?.end();
  await c2?.end();
  await c3?.end();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const novoHmac = () => sha(`H040-${randomUUID()}`);
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const SQL_ENVIO = 'select out_resultado from private.professional_profile_set_document($1, $2, $3, $4, $5, $6, $7)';
const SQL_DECIDE = 'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)';
const SQL_ASSIGN = 'select * from private.verification_case_assign($1,$2,$3,$4,$5)';
const SQL_READ = 'select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)';
const INDICE_VIVO = 'professional_profile_document_hmac_vivo_key';

async function usuario(cli) {
  const id = randomUUID();
  await cli.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

async function perfilSemDoc(cli) {
  const id = await usuario(cli);
  await cli.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'pendente', now(), now())`,
    [id],
  );
  return id;
}

/** Original com o documento gravado diretamente, no status dado (insert nao passa pelo gatilho de status). */
async function originalComHmac(cli, status, hmac) {
  const id = await usuario(cli);
  await cli.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, verified_at,
        created_at, updated_at)
     values ($1, $2, 'Sintetico H040', $3, 'CPF', $4, $5, case when $2 = 'aprovada' then now() end, now(), now())`,
    [id, status, `h040-${randomUUID()}`, Buffer.from(`blob-${randomUUID()}`), hmac],
  );
  return id;
}

async function cadastra(cli, userId, hmac) {
  const { rows } = await cli.query(SQL_ENVIO, [userId, 'Sintetico H040', `h040-${randomUUID()}`, 'CPF',
    Buffer.from(`blob-${randomUUID()}`), hmac, at(T0)]);
  return rows[0].out_resultado;
}

async function staffComPapel(cli) {
  const id = await usuario(cli);
  await cli.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await cli.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, 'verificacao', null, 'bootstrap', now(), null)`,
    [id],
  );
  return id;
}

async function sessao(cli, userId) {
  const secret = sha(randomUUID());
  const { rows } = await cli.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(T0)]);
  assert.equal(rows[0].ok, true, 'sessao aberta');
  return secret;
}

/** Documento recebido e caso atribuido a um analista; com lido=true, o documento tambem e analisado. */
async function casoAtribuido(cli, prof, lido) {
  const docId = randomUUID();
  await cli.query(
    `insert into app.identity_document (id, professional_id, client_upload_id, declared_type, declared_bytes,
       status, pending_expires_at)
     values ($1, $2, $3, 'image/jpeg', 1000, 'pendente_envio', now() + interval '30 minutes')`,
    [docId, prof, randomUUID()],
  );
  await cli.query(
    `update app.identity_document set status = 'recebido', stored_type = 'image/jpeg',
       stored_bytes = 16, content_sha256 = $2, received_at = $3 where id = $1`,
    [docId, Buffer.alloc(32, 7), at(T0)],
  );
  const { rows } = await cli.query(
    'select id, version from app.verification_case where professional_id = $1', [prof]);
  const caso = rows[0];
  const v = await staffComPapel(cli);
  const s = await sessao(cli, v);
  await cli.query(SQL_ASSIGN, [v, s, caso.id, caso.version, at(T0)]);
  if (lido) {
    await cli.query(SQL_READ, [v, s, caso.id, docId, 'analise_inicial', at(T0)]);
  }
  const { rows: atual } = await cli.query('select version from app.verification_case where id = $1', [caso.id]);
  return { cli, v, s, caso: { id: caso.id, version: atual[0].version } };
}

test('T40-04: dois cadastros simultaneos com o mesmo documento: um pendente, outro retida_duplicidade; nenhum 23505 escapa', async () => {
  const hmac = novoHmac();
  const a = await perfilSemDoc(c1);
  const b = await perfilSemDoc(c2);
  const resultados = await Promise.allSettled([cadastra(c1, a, hmac), cadastra(c2, b, hmac)]);
  assert.ok(resultados.every((r) => r.status === 'fulfilled'), `nenhuma falha: ${JSON.stringify(resultados.map((r) => r.reason?.message))}`);
  assert.deepEqual(resultados.map((r) => r.value).sort(), ['pendente', 'retida_duplicidade']);
  const { rows } = await c3.query(
    'select verification_status from app.professional_profile where user_id = any($1::uuid[]) order by verification_status',
    [[a, b]]);
  assert.deepEqual(rows.map((r) => r.verification_status), ['pendente', 'retida_duplicidade']);
});

test('T40-05 corrida: duas aprovacoes simultaneas de irmaos retidos com original recusado: uma aprova, a outra falha sem 500 isolado', async () => {
  const hmac = novoHmac();
  const original = await originalComHmac(c3, 'pendente', hmac);
  const irmaoB = await perfilSemDoc(c1);
  const irmaoC = await perfilSemDoc(c2);
  assert.equal(await cadastra(c1, irmaoB, hmac), 'retida_duplicidade');
  assert.equal(await cadastra(c2, irmaoC, hmac), 'retida_duplicidade');

  // Original recusado pela Verificacao (decisao motivada), antes da corrida.
  const dono = await casoAtribuido(c3, original, false);
  await c3.query(SQL_DECIDE, [dono.v, dono.s, dono.caso.id, 'recusada', 'documento_ilegivel', null, dono.caso.version, at(T0)]);

  const b = await casoAtribuido(c1, irmaoB, true);
  const cc = await casoAtribuido(c2, irmaoC, true);
  const decide = (c) => c.cli.query(SQL_DECIDE, [c.v, c.s, c.caso.id, 'aprovada', 'aprovado', null, c.caso.version, at(T0)]);
  const resultados = await Promise.allSettled([decide(b), decide(cc)]);

  const ok = resultados.filter((r) => r.status === 'fulfilled');
  const falhou = resultados.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exatamente uma aprovacao');
  assert.equal(ok[0].value.rows[0].out_status, 'aprovada');
  assert.equal(falhou.length, 1, 'a outra falha');
  const erro = falhou[0].reason;
  const dominio = erro.message === 'original_vivo' && erro.code === 'VRF08';
  const restricao = erro.code === '23505' && erro.constraint === INDICE_VIVO;
  assert.ok(dominio || restricao, `falha esperada (VRF08 ou 23505 do indice): ${erro.code} ${erro.message}`);
  const { rows } = await c3.query(
    'select verification_status from app.professional_profile where user_id = any($1::uuid[]) order by verification_status',
    [[irmaoB, irmaoC]]);
  assert.deepEqual(rows.map((r) => r.verification_status), ['aprovada', 'retida_duplicidade'], 'perfil do segundo irmao segue retido');
});
