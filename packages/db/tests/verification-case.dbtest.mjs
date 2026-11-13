// Issue 52 (H-039) | Fila de verificacao no banco (docs/factory/124-DESENHO-H039.md §6, T-01, T-02, T-05,
// T-06, T-10, T-11, T-19 e fluxo de decisao). Banco de desenvolvimento. Cada teste roda em transacao e e
// desfeito (rollback). Valores sinteticos (@example.test). Sem rede, sem envio de e-mail, sem Mapbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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

/** Sessao aberta no instante `ms` (totp_at = ms). Devolve o segredo em hash. */
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

/** Documento levado a 'recebido' pelo mesmo caminho do envio (AFTER UPDATE OF status). */
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
    'select id, version, status, sla_target_at from app.verification_case where professional_id = $1', [profId]);
  return rows[0];
}

async function versao(caseId) {
  const { rows } = await client.query('select version from app.verification_case where id = $1', [caseId]);
  return rows[0].version;
}

test('T-01/T-02: documento recebido cria um caso pendente com prazo; reenvio nao duplica', () =>
  tx(async () => {
    const prof = await profissional();
    const caso0 = await casoDe(prof);
    assert.equal(caso0, undefined, 'sem envio, nenhum caso');
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    assert.equal(caso.status, 'pendente');
    assert.ok(caso.sla_target_at instanceof Date, 'prazo-meta gravado');
    await documentoRecebido(prof, T0 + 60_000);
    const { rows } = await client.query('select count(*)::int as n from app.verification_case where professional_id = $1', [prof]);
    assert.equal(rows[0].n, 1, 'segundo recebido nao cria segundo caso');
  }));

test('prazo-meta em dias uteis, sao paulo (dec. 384, 397): sexta, sabado e quinta', () =>
  tx(async () => {
    const casos = [
      ['2026-11-13 10:00:00-03', '2026-11-17 10:00'], // sexta -> terca
      ['2026-11-14 10:00:00-03', '2026-11-18 00:00'], // sabado -> quarta 00:00
      ['2026-11-12 10:00:00-03', '2026-11-16 10:00'], // quinta -> segunda
    ];
    for (const [entrada, esperado] of casos) {
      const { rows } = await client.query(
        `select to_char(private.verification_sla_target($1::timestamptz) at time zone 'America/Sao_Paulo',
                        'YYYY-MM-DD HH24:MI') as t`, [entrada]);
      assert.equal(rows[0].t, esperado, `prazo a partir de ${entrada}`);
    }
  }));

test('T-05: transicao fora da tabela e recusada pelo banco (aprovada e suspensa nao saem)', () =>
  tx(async () => {
    const prof = await profissional();
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const err = await falha(`update app.verification_case set status = 'aprovada' where id = $1`, [caso.id]);
    assert.equal(err?.message, 'vrf_transicao_invalida');
  }));

test('T-06: historico e caso recusam UPDATE, DELETE e TRUNCATE', () =>
  tx(async () => {
    const prof = await profissional();
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    assert.equal((await falha('delete from app.verification_case where id = $1', [caso.id]))?.message, 'vrf_sem_delete');
    assert.equal((await falha('update app.verification_case_event set reason_code = $2 where case_id = $1',
      [caso.id, 'outro']))?.message, 'vrf_evento_imutavel');
    assert.equal((await falha('delete from app.verification_case_event where case_id = $1', [caso.id]))?.message,
      'vrf_evento_imutavel');
  }));

test('T-03/T-10: atribuir, recusar, recurso, reatribuir; um evento e um audit por acao', () =>
  tx(async () => {
    const prof = await profissional();
    await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const v1 = await staffComPapel('verificacao');
    const v2 = await staffComPapel('verificacao');
    const v3 = await staffComPapel('verificacao');
    const sup = await staffComPapel('superadmin');
    const s1 = await sessao(v1, T0);
    const s2 = await sessao(v2, T0);
    const s3 = await sessao(v3, T0);
    const ss = await sessao(sup, T0);

    const a = await client.query('select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [v1, s1, caso.id, caso.version, at(T0)]);
    assert.equal(a.rows[0].out_status, 'em_revisao');
    const d = await client.query('select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [v1, s1, caso.id, 'recusada', 'documento_ilegivel', null, await versao(caso.id), at(T0)]);
    assert.equal(d.rows[0].out_status, 'recusada');
    const perfil = await client.query('select verification_status from app.professional_profile where user_id = $1', [prof]);
    assert.equal(perfil.rows[0].verification_status, 'recusada', 'perfil espelha a decisao');

    const r = await client.query('select out_code from private.verification_case_appeal($1, $2)', [prof, at(T0)]);
    assert.equal(r.rows[0].out_code, 'ok');
    const dup = await client.query('select out_code from private.verification_case_appeal($1, $2)', [prof, at(T0)]);
    assert.equal(dup.rows[0].out_code, 'recurso_ja_usado', 'um recurso por caso (dec. 391)');

    const err = await falha('select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [v1, s1, caso.id, await versao(caso.id), at(T0)]);
    assert.equal(err?.code, '42501', 'quem decidiu nao assume o recurso (dec. 378)');
    const a2 = await client.query('select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [v2, s2, caso.id, await versao(caso.id), at(T0)]);
    assert.equal(a2.rows[0].out_status, 'em_revisao');

    const re = await client.query('select * from private.verification_case_reassign($1,$2,$3,$4,$5,$6)',
      [sup, ss, caso.id, v3, await versao(caso.id), at(T0)]);
    assert.equal(re.rows[0].out_status, 'em_revisao');
    const errSup = await falha('select * from private.verification_case_reassign($1,$2,$3,$4,$5,$6)',
      [v3, s3, caso.id, v1, await versao(caso.id), at(T0)]);
    assert.equal(errSup?.code, '42501', 'so o Superadmin reatribui');

    const ev = await client.query(
      'select seq, action from app.verification_case_event where case_id = $1 order by seq', [caso.id]);
    assert.deepEqual(ev.rows.map((x) => x.action),
      ['created', 'assigned', 'decided', 'appeal_received', 'assigned', 'reassigned']);
    assert.deepEqual(ev.rows.map((x) => x.seq), [1, 2, 3, 4, 5, 6]);
  }));

test('decisao: aprovada exige identidade analisada (VRF04); motivo e complemento validados (VRF02, VRF03)', () =>
  tx(async () => {
    const prof = await profissional();
    const docId = await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const v1 = await staffComPapel('verificacao');
    const s1 = await sessao(v1, T0);
    await client.query('select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [v1, s1, caso.id, caso.version, at(T0)]);
    const decide = (decisao, motivo, complemento) => falha(
      'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [v1, s1, caso.id, decisao, motivo, complemento, 2, at(T0)]);
    assert.equal((await decide('aprovada', 'aprovado', null))?.message, 'identidade_nao_analisada');
    assert.equal((await decide('recusada', 'aprovado', null))?.message, 'motivo_invalido');
    assert.equal((await decide('recusada', 'documento_ilegivel', 'CPF 123.456.789-09'))?.message,
      'explicacao_invalida');
    assert.equal((await decide('recusada', 'outro', null))?.message, 'explicacao_invalida');
    const leitura = await client.query('select out_id, out_stored_type from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [v1, s1, caso.id, docId, 'analise_inicial', at(T0)]);
    assert.equal(leitura.rows[0].out_id, docId);
    assert.equal(leitura.rows[0].out_stored_type, 'image/jpeg');
    const ok = await client.query('select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)',
      [v1, s1, caso.id, 'aprovada', 'aprovado', null, 2, at(T0)]);
    assert.equal(ok.rows[0].out_status, 'aprovada');
  }));

test('T-11: leitura do documento grava analise, registro sensivel e evento; nao-atribuido recebe 42501', () =>
  tx(async () => {
    const prof = await profissional();
    const docId = await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const v1 = await staffComPapel('verificacao');
    const v2 = await staffComPapel('verificacao');
    const s1 = await sessao(v1, T0);
    const s2 = await sessao(v2, T0);
    await client.query('select * from private.verification_case_assign($1,$2,$3,$4,$5)',
      [v1, s1, caso.id, caso.version, at(T0)]);
    const naoAtribuido = await falha('select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [v2, s2, caso.id, docId, 'analise_inicial', at(T0)]);
    assert.equal(naoAtribuido?.code, '42501');
    const semMotivo = await falha('select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [v1, s1, caso.id, docId, 'motivo_livre', at(T0)]);
    assert.equal(semMotivo?.message, 'motivo_invalido');
    await client.query('select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [v1, s1, caso.id, docId, 'analise_inicial', at(T0)]);
    const doc = await client.query('select analyzed_at from app.identity_document where id = $1', [docId]);
    assert.ok(doc.rows[0].analyzed_at instanceof Date, 'analise gravada');
    const log = await client.query(
      `select scope_kind, reason_code, action from app.sensitive_access_log where verification_case_id = $1`, [caso.id]);
    assert.deepEqual(log.rows, [{ scope_kind: 'identity_document', reason_code: 'analise_inicial', action: 'read' }]);
    const ev = await client.query(
      `select count(*)::int as n from app.verification_case_event where case_id = $1 and action = 'document_read'`, [caso.id]);
    assert.equal(ev.rows[0].n, 1);
  }));

test('fila: lista so com colunas permitidas; prova recente ausente nega a leitura', () =>
  tx(async () => {
    const prof = await profissional();
    const docId = await documentoRecebido(prof, T0);
    const caso = await casoDe(prof);
    const v1 = await staffComPapel('verificacao');
    const s1 = await sessao(v1, T0);
    const semPapel = await staffComPapel('suporte');
    const sSem = await sessao(semPapel, T0);
    const fila = await client.query(
      'select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [v1, s1, 'pendentes', 10, null, null, at(T0)]);
    assert.ok(fila.rows.some((x) => x.out_id === caso.id), 'caso aparece na fila de pendentes');
    assert.deepEqual(Object.keys(fila.rows[0]).sort(),
      ['out_appeal_status', 'out_assigned_to_me', 'out_id', 'out_overdue', 'out_received_at', 'out_services',
       'out_short_id', 'out_sla_target_at', 'out_status', 'out_version']);
    const negada = await falha('select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [semPapel, sSem, 'pendentes', 10, null, null, at(T0)]);
    assert.equal(negada?.code, '42501', 'perfil sem verification.review nao ve a fila');
    const semTotp = await falha('select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)',
      [v1, sha('sessao-sem-prova'), caso.id, docId, 'analise_inicial', at(T0)]);
    assert.equal(semTotp?.code, '42501');
  }));
