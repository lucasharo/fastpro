// Issue 57 (H-044) | Prova ponta a ponta do trial com a funcao real de decisao da verificacao (Issue 52, H-039),
// docs/factory/135-DESENHO-H044.md §6, T-16. Tudo roda numa transacao desfeita (rollback). Dados sinteticos
// (@example.test, sufixo aleatorio). Sem rede, sem provedor externo, sem relogio do banco: instantes explicitos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const T0 = Date.parse('2030-01-01T12:00:00.000Z');
const HORA = 60 * 60 * 1000;
const at = (ms) => new Date(ms).toISOString();

/** Transacao de teste: tudo que a prova grava some no rollback. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Erro esperado dentro de savepoint: devolve o erro e mantem a transacao utilizavel. */
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
    [id, `h044-fim-${id.slice(0, 8)}@example.test`, randomUUID()],
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

/** Sessao de administrador aberta no instante ms. Devolve o segredo em hash (como nas outras provas). */
async function sessao(userId, ms) {
  const secret = randomBytes(32).toString('hex');
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

/** Profissional pendente com documento sintetico (document_hmac de 64 hexadecimais). Sem status aprovada aqui. */
async function profissionalComDocumento() {
  const id = await usuario();
  const slug = `h044-fim-${randomUUID()}`;
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, created_at, updated_at)
     values ($1, 'pendente', 'Nome Sintetico', $2, 'CPF', $3, $4, now(), now())`,
    [id, slug, Buffer.from(`blob-${randomUUID()}`), randomBytes(32).toString('hex')],
  );
  return id;
}

/** Documento levado a 'recebido' pelo mesmo caminho do envio (cria o caso de verificacao). */
async function documentoRecebido(profId, ms) {
  const id = randomUUID();
  await client.query(
    `insert into app.identity_document (id, professional_id, client_upload_id, declared_type, declared_bytes,
       status, pending_expires_at)
     values ($1, $2, $3, 'image/jpeg', 1000, 'pendente_envio', now() + interval '30 minutes')`,
    [id, profId, randomUUID()],
  );
  await client.query(
    `update app.identity_document set status = 'recebido', stored_type = 'image/jpeg',
       stored_bytes = 16, content_sha256 = $2, received_at = $3 where id = $1`,
    [id, Buffer.alloc(32, 7), at(ms)],
  );
  return id;
}

async function casoDe(profId) {
  const { rows } = await client.query(
    'select id, version, status from app.verification_case where professional_id = $1', [profId]);
  return rows[0];
}

async function statusDoPerfil(profId) {
  const { rows } = await client.query(
    'select verification_status from app.professional_profile where user_id = $1', [profId]);
  return rows[0].verification_status;
}

/** Chama a ativacao com o mesmo formato que o adaptador usa (ator professional:<id>, instante explicito). */
async function ativar(profId, ms) {
  const { rows } = await client.query(
    'select out_code, out_grant_id, out_starts_at, out_ends_at from private.trial_activate($1, $2, $3, $4)',
    [profId, `professional:${profId}`, at(ms), null]);
  return rows[0];
}

test('T-16: trial so depois da decisao real de aprovacao (H-039); antes devolve not_verified', () =>
  tx(async () => {
    const prof = await profissionalComDocumento();
    const docId = await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    assert.equal(caso.status, 'pendente', 'envio cria caso pendente');

    const antesDoAnalista = await ativar(prof, T0);
    assert.equal(antesDoAnalista.out_code, 'not_verified', 'pendente nao ativa');

    const analista = await staffComPapel('verificacao');
    const sessaoAnalista = await sessao(analista, T0);
    const atribuicao = await client.query(
      'select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [analista, sessaoAnalista, caso.id, caso.version, at(T0)]);
    assert.equal(atribuicao.rows[0].out_status, 'em_revisao');
    const versaoAtribuida = atribuicao.rows[0].out_version;

    const emRevisao = await ativar(prof, T0);
    assert.equal(emRevisao.out_code, 'not_verified', 'em revisao ainda nao ativa');
    assert.equal(await statusDoPerfil(prof), 'em_revisao');

    const leitura = await client.query(
      'select out_id from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [analista, sessaoAnalista, caso.id, docId, 'analise_inicial', at(T0)]);
    assert.equal(leitura.rows[0].out_id, docId, 'analise da identidade registrada');

    const decisao = await client.query(
      'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [analista, sessaoAnalista, caso.id, 'aprovada', 'aprovado', null, versaoAtribuida, at(T0)]);
    assert.equal(decisao.rows[0].out_status, 'aprovada');
    assert.equal(await statusDoPerfil(prof), 'aprovada');

    const depois = await ativar(prof, T0);
    assert.equal(depois.out_code, 'ok', 'aprovacao real libera o trial');
    assert.equal(new Date(depois.out_starts_at).getTime(), T0);
    assert.equal(new Date(depois.out_ends_at).getTime() - T0, 336 * HORA, '14 dias exatos');

    const { rows } = await client.query(
      `select count(*)::int as n from billing.access_grant where professional_id = $1 and type = 'trial'`, [prof]);
    assert.equal(rows[0].n, 1, 'exatamente um trial');

    const repetida = await ativar(prof, T0 + HORA);
    assert.equal(repetida.out_code, 'trial_used', 'segunda chamada apos a aprovacao nao cria nova linha');
  }));

test('T-16: recusa pela mesma decisao nao libera o trial', () =>
  tx(async () => {
    const prof = await profissionalComDocumento();
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const analista = await staffComPapel('verificacao');
    const sessaoAnalista = await sessao(analista, T0);
    const atribuicao = await client.query(
      'select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [analista, sessaoAnalista, caso.id, caso.version, at(T0)]);
    const decisao = await client.query(
      'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [analista, sessaoAnalista, caso.id, 'recusada', 'documento_ilegivel', null,
        atribuicao.rows[0].out_version, at(T0)]);
    assert.equal(decisao.rows[0].out_status, 'recusada');
    const r = await ativar(prof, T0);
    assert.equal(r.out_code, 'not_verified');
    const { rows } = await client.query(
      `select count(*)::int as n from billing.access_grant where professional_id = $1`, [prof]);
    assert.equal(rows[0].n, 0, 'nenhuma linha no livro');
  }));

test('T-16: uma tentativa de decisao sem analise da identidade falha e o trial continua negado', () =>
  tx(async () => {
    const prof = await profissionalComDocumento();
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const analista = await staffComPapel('verificacao');
    const sessaoAnalista = await sessao(analista, T0);
    const atribuicao = await client.query(
      'select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [analista, sessaoAnalista, caso.id, caso.version, at(T0)]);
    const erro = await falha(
      'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [analista, sessaoAnalista, caso.id, 'aprovada', 'aprovado', null,
        atribuicao.rows[0].out_version, at(T0)]);
    assert.equal(erro?.message, 'identidade_nao_analisada');
    assert.equal((await ativar(prof, T0)).out_code, 'not_verified');
  }));
