// H-038 (Issue 51) | T-04 (gate real com private.verification_case_decide) e T-09 (perfil publico e busca sem
// referencia a certificacao), docs/factory/148-DESENHO-H038.md §6. Migracao 20261113440000 aplicada no DEV.
// Cada teste roda em transacao e termina com rollback. Dados sinteticos (@example.test). Sem rede, sem e-mail.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/identity-cert-gate-h038.dbtest.mjs
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

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const SQL_DECIDE = 'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)';
const SQL_ASSIGN = 'select * from private.verification_case_assign($1,$2,$3,$4,$5)';
const SQL_READ = 'select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)';

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro (ou nulo). */
async function falha(sql, params = []) {
  await client.query('savepoint sp');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp');
    return err;
  }
  await client.query('release savepoint sp');
  return null;
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

async function staffComPapel(role) {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [id, role],
  );
  return id;
}

/** Sessao de analista aberta no instante `ms`. Devolve o segredo em hash. */
async function sessao(userId, ms, seed = randomUUID()) {
  const secret = sha(seed);
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

async function profissional() {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'pendente', now(), now())`,
    [id],
  );
  return id;
}

/** Documento (identidade ou certificacao) levado a 'recebido' pelo mesmo caminho do envio. */
async function documentoRecebido(profId, ms, { kind = 'identidade', servico = null, status = 'recebido' } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.identity_document (id, professional_id, client_upload_id, kind, service_id, declared_type,
       declared_bytes, status, pending_expires_at)
     values ($1, $2, $3, $4, $5, 'image/jpeg', 1000, 'pendente_envio', now() + interval '30 minutes')`,
    [id, profId, randomUUID(), kind, servico],
  );
  if (status === 'recebido') {
    await client.query(
      `update app.identity_document set status = 'recebido', stored_type = 'image/jpeg',
         stored_bytes = 16, content_sha256 = $2, received_at = $3 where id = $1`,
      [id, Buffer.alloc(32, 7), at(ms)],
    );
  }
  return id;
}

async function casoDe(profId) {
  const { rows } = await client.query(
    'select id, version, status from app.verification_case where professional_id = $1', [profId]);
  return rows[0];
}

async function versao(caseId) {
  const { rows } = await client.query('select version from app.verification_case where id = $1', [caseId]);
  return rows[0].version;
}

/** Caso atribuido a um analista com o documento de identidade ja lido (pre-condicao da aprovacao). */
async function casoLido(ms = T0) {
  const prof = await profissional();
  const docId = await documentoRecebido(prof, ms);
  const caso = await casoDe(prof);
  const v1 = await staffComPapel('verificacao');
  const s1 = await sessao(v1, T0);
  await client.query(SQL_ASSIGN, [v1, s1, caso.id, caso.version, at(T0)]);
  await client.query(SQL_READ, [v1, s1, caso.id, docId, 'analise_inicial', at(T0)]);
  return { prof, docId, caso, v1, s1 };
}

const argsDecisao = (c, decisao, motivo, complemento, versaoEsperada) =>
  [c.v1, c.s1, c.caso.id, decisao, motivo, complemento, versaoEsperada, at(T0)];

/** Vincula o profissional a um servico regulamentado ativo (REG). Devolve o id do servico. */
async function vincularRegulado(profId) {
  const grupo = randomUUID();
  await client.query(
    'insert into app.service_group (id, name, position, active) values ($1, $2, $3, true)',
    [grupo, `grupo ${grupo}`, Math.floor(Math.random() * 1_000_000_000)],
  );
  const { rows } = await client.query(
    `insert into app.service (group_id, name, modality, regulated, active)
     values ($1, $2, 'online', true, true) returning id`,
    [grupo, `servico ${grupo}`],
  );
  await client.query(
    'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, now())',
    [profId, rows[0].id, 'online'],
  );
  return rows[0].id;
}

test('T-04: aprovacao exige certificacao recebida para cada servico REG (VRF05); com ela aprova e move caso e perfil', () =>
  tx(async () => {
    const c = await casoLido();
    const servico = await vincularRegulado(c.prof);
    const v = await versao(c.caso.id);

    const semCert = await falha(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, v));
    assert.equal(semCert?.message, 'certificacao_pendente', 'REG sem certificacao recusa a aprovacao');

    await documentoRecebido(c.prof, T0, { kind: 'certificacao', servico, status: 'pendente_envio' });
    const pendente = await falha(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, v));
    assert.equal(pendente?.message, 'certificacao_pendente', 'envio ainda pendente nao conta');

    await documentoRecebido(c.prof, T0, { kind: 'certificacao', servico });
    const ok = await client.query(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, v));
    assert.equal(ok.rows[0].out_status, 'aprovada', 'certificacao recebida libera a aprovacao');

    const caso = await client.query('select status from app.verification_case where id = $1', [c.caso.id]);
    assert.equal(caso.rows[0].status, 'aprovada', 'caso movido para aprovada');
    const perfil = await client.query('select verification_status from app.professional_profile where user_id = $1', [c.prof]);
    assert.equal(perfil.rows[0].verification_status, 'aprovada', 'perfil movido para aprovada');
  }));

test('T-04: certificacao de outro servico nao libera o servico REG vinculado', () =>
  tx(async () => {
    const c = await casoLido();
    const servicoA = await vincularRegulado(c.prof);
    await vincularRegulado(c.prof);
    await documentoRecebido(c.prof, T0, { kind: 'certificacao', servico: servicoA });
    const v = await versao(c.caso.id);
    const erro = await falha(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, v));
    assert.equal(erro?.message, 'certificacao_pendente', 'o segundo servico REG segue sem certificacao');
  }));

test('T-09: perfil publico e busca nao referenciam documentos de identidade nem certificacao', async () => {
  const { rows } = await client.query(
    `select p.proname, pg_get_functiondef(p.oid) as definicao
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('professional_public_profile', 'catalog_search')
      order by p.proname`,
  );
  assert.deepEqual(rows.map((r) => r.proname), ['catalog_search', 'professional_public_profile'], 'as duas funcoes existem');
  for (const linha of rows) {
    assert.doesNotMatch(linha.definicao, /identity_document|certificac|idoc_/i, `${linha.proname} nao menciona documentos`);
  }
});
