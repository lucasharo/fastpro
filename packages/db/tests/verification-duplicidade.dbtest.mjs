// Issue 53 (H-040) | Retencao por duplicidade no banco (docs/factory/134-DESENHO-H040.md §5):
// T40-01 a T40-07 (cadastro, recusa libera, estado do original, liberacao motivada, sem suspensao),
// T40-11 (recurso), T40-12 (evento sem dado pessoal), T40-13 (troca de documento), T40-15 (prazo),
// T40-16 (fila e visao da duplicidade). Cada teste roda em transacao e termina com rollback.
// Dados sinteticos: marcador H040, e-mails @example.test, documento falso (hash). Sem rede, sem Mapbox, sem envio.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/verification-duplicidade.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
const novoHmac = () => sha(`H040-${randomUUID()}`);
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const SQL_ENVIO = 'select out_resultado from private.professional_profile_set_document($1, $2, $3, $4, $5, $6, $7)';
const SQL_DECIDE = 'select * from private.verification_case_decide($1,$2,$3,$4,$5,$6,$7,$8)';
const SQL_ASSIGN = 'select * from private.verification_case_assign($1,$2,$3,$4,$5)';
const SQL_READ = 'select * from private.idoc_review_target($1,$2,$3,$4,$5,$6)';
const SQL_APPEAL = 'select out_code from private.verification_case_appeal($1, $2)';
const SQL_VIEW = 'select * from private.verification_duplicate_view($1,$2,$3,$4)';
const SQL_FILA = 'select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)';

/** Transacao de teste: tudo desfeito no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Comando que deve falhar: savepoint mantem a transacao viva. Devolve o erro (ou nulo). */
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

/** Sessao de administrador aberta em T0; devolve o segredo em hash. */
async function sessao(userId) {
  const secret = sha(randomUUID());
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(T0)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

/** Perfil com documento gravado diretamente, no status dado (insert nao passa pelo gatilho de status). */
async function perfilComHmac(status, hmac = novoHmac()) {
  const id = await usuario();
  const agora = new Date().toISOString();
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac,
        suspended_at, suspension_reason, verified_at, created_at, updated_at)
     values ($1, $2, 'Sintetico H040', $3, 'CPF', $4, $5, $6::timestamptz, $7::text, $8::timestamptz, now(), now())`,
    [id, status, `h040-${randomUUID()}`, Buffer.from(`blob-${randomUUID()}`), hmac,
      status === 'suspensa' ? agora : null, status === 'suspensa' ? 'Sintetico H040' : null,
      status === 'aprovada' ? agora : null],
  );
  return id;
}

/** Perfil recem-criado, sem documento (pendente), como o cadastro o encontra. */
async function perfilSemDoc() {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'pendente', now(), now())`,
    [id],
  );
  return id;
}

/** Cadastro do documento pela funcao de H-035; devolve pendente, retida_duplicidade, ja_cadastrado ou sem_perfil. */
async function cadastra(userId, hmac) {
  const { rows } = await client.query(SQL_ENVIO, [userId, 'Sintetico H040', `h040-${randomUUID()}`, 'CPF',
    Buffer.from(`blob-${randomUUID()}`), hmac, at(T0)]);
  return rows[0].out_resultado;
}

async function statusDe(userId) {
  const { rows } = await client.query('select verification_status from app.professional_profile where user_id = $1', [userId]);
  return rows[0].verification_status;
}

/** Documento levado a 'recebido' pelo mesmo caminho do envio; o gatilho abre o caso. */
async function documentoRecebido(profId) {
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
    [id, Buffer.alloc(32, 7), at(T0)],
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

/** Caso do profissional sem atribuicao (para a visao de quem ainda nao decidiu). */
async function casoAberto(prof) {
  await documentoRecebido(prof);
  return { caso: await casoDe(prof) };
}

/** Caso do profissional atribuido a um analista (em_revisao). Com lido=true, o documento tambem e analisado. */
async function casoDoProf(prof, lido = false) {
  const docId = await documentoRecebido(prof);
  const caso = await casoDe(prof);
  const v = await staffComPapel('verificacao');
  const s = await sessao(v);
  await client.query(SQL_ASSIGN, [v, s, caso.id, caso.version, at(T0)]);
  if (lido) {
    await client.query(SQL_READ, [v, s, caso.id, docId, 'analise_inicial', at(T0)]);
  }
  return { prof, docId, caso, v, s };
}

const argsDecisao = (c, decisao, motivo, complemento, versaoEsperada) =>
  [c.v, c.s, c.caso.id, decisao, motivo, complemento, versaoEsperada, at(T0)];

async function decide(c, decisao, motivo, complemento = null) {
  const { rows } = await client.query(SQL_DECIDE, argsDecisao(c, decisao, motivo, complemento, await versao(c.caso.id)));
  return rows[0].out_status;
}

/** Foto do que a decisao nao pode mudar: caso, perfil, eventos e auditoria do caso. */
async function foto(c) {
  const caso = await client.query('select status, version, assigned_to, decided_at, appeal_status from app.verification_case where id = $1', [c.caso.id]);
  const perfil = await client.query('select verification_status, suspended_at, verified_at from app.professional_profile where user_id = $1', [c.prof]);
  const eventos = await client.query('select count(*)::int as n from app.verification_case_event where case_id = $1', [c.caso.id]);
  const auditoria = await client.query('select count(*)::int as n from audit.audit_event where object_id = $1', [c.caso.id]);
  return { caso: caso.rows[0], perfil: perfil.rows[0], eventos: eventos.rows[0].n, auditoria: auditoria.rows[0].n };
}

test('T40-01: cadastro com original em pendente, em_revisao, aprovada ou suspensa fica retida_duplicidade', () =>
  tx(async () => {
    for (const status of ['pendente', 'em_revisao', 'aprovada', 'suspensa']) {
      const hmac = novoHmac();
      await perfilComHmac(status, hmac);
      const novo = await perfilSemDoc();
      assert.equal(await cadastra(novo, hmac), 'retida_duplicidade', `original ${status}`);
      assert.equal(await statusDe(novo), 'retida_duplicidade', `perfil novo com original ${status}`);
    }
  }));

test('T40-02: original recusada libera; o segundo cadastro com o mesmo documento fica pendente', () =>
  tx(async () => {
    const hmac = novoHmac();
    await perfilComHmac('recusada', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'pendente');
    assert.equal(await statusDe(novo), 'pendente');
  }));

test('T40-03: estado, suspended_at, verified_at e HMAC do original sao os mesmos antes e depois da retencao', () =>
  tx(async () => {
    const hmac = novoHmac();
    const original = await perfilComHmac('aprovada', hmac);
    const linha = () => client.query(
      'select verification_status, suspended_at, verified_at, document_hmac from app.professional_profile where user_id = $1', [original]);
    const antes = (await linha()).rows[0];
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    assert.deepEqual((await linha()).rows[0], antes, 'original intacto');
  }));

test('T40-05: aprovar retido com original vivo falha com original_vivo e nada muda; com original recusado, o primeiro irmao aprova e o segundo falha', () =>
  tx(async () => {
    const hmac = novoHmac();
    const origem = await perfilComHmac('pendente', hmac);
    const b = await perfilSemDoc();
    const c = await perfilSemDoc();
    assert.equal(await cadastra(b, hmac), 'retida_duplicidade');
    assert.equal(await cadastra(c, hmac), 'retida_duplicidade');
    const cb = await casoDoProf(b, true);
    const cc = await casoDoProf(c, true);
    const antesB = await foto(cb);
    const erroB = await falha(SQL_DECIDE, argsDecisao(cb, 'aprovada', 'aprovado', null, await versao(cb.caso.id)));
    assert.equal(erroB?.message, 'original_vivo', 'VRF08 com original vivo');
    assert.equal(erroB?.code, 'VRF08', 'codigo VRF08');
    assert.deepEqual(await foto(cb), antesB, 'caso, perfil, eventos e auditoria intactos');

    // Original recusado pela Verificacao (caso proprio, decisao motivada).
    const dono = await casoDoProf(origem, false);
    assert.equal(await decide(dono, 'recusada', 'documento_ilegivel'), 'recusada');
    assert.equal(await decide(cb, 'aprovada', 'aprovado'), 'aprovada', 'primeiro irmao aprova sem original vivo');
    const erroC = await falha(SQL_DECIDE, argsDecisao(cc, 'aprovada', 'aprovado', null, await versao(cc.caso.id)));
    assert.equal(erroC?.message, 'original_vivo', 'segundo irmao falha: o primeiro esta vivo');
  }));

test('T40-06: liberacao motivada; recusa com duplicidade_suspeita so em perfil retido; regressao do motivo', () =>
  tx(async () => {
    const hmac = novoHmac();
    const origem = await perfilComHmac('pendente', hmac);
    const b = await perfilSemDoc();
    const e = await perfilSemDoc();
    assert.equal(await cadastra(b, hmac), 'retida_duplicidade');
    assert.equal(await cadastra(e, hmac), 'retida_duplicidade');
    const cb = await casoDoProf(b, true);
    const ce = await casoDoProf(e, false);
    const dono = await casoDoProf(origem, false);
    assert.equal(await decide(dono, 'recusada', 'documento_ilegivel'), 'recusada', 'original recusado');

    const motivoInvalido = async (decisao, motivo) =>
      (await falha(SQL_DECIDE, argsDecisao(cb, decisao, motivo, null, await versao(cb.caso.id))))?.message;
    assert.equal(await motivoInvalido('aprovada', null), 'motivo_invalido', 'aprovada sem motivo');
    assert.equal(await motivoInvalido('aprovada', 'documento_ilegivel'), 'motivo_invalido', 'aprovada com motivo de recusa');
    assert.equal(await decide(cb, 'aprovada', 'aprovado'), 'aprovada', 'liberacao motivada');
    assert.equal(await decide(ce, 'recusada', 'duplicidade_suspeita'), 'recusada', 'recusa com duplicidade em perfil retido');

    const comum = await perfilSemDoc();
    assert.equal(await cadastra(comum, novoHmac()), 'pendente');
    const cc = await casoDoProf(comum, false);
    assert.equal((await falha(SQL_DECIDE, argsDecisao(cc, 'recusada', 'duplicidade_suspeita', null, await versao(cc.caso.id))))?.message,
      'motivo_invalido', 'recusada com duplicidade fora de perfil retido');
  }));

test('T40-07: retencao nao suspende a conta, nao altera o status da conta e nao mexe em pedidos existentes', () =>
  tx(async () => {
    const pedidosAntes = (await client.query('select count(*)::int as n from app.service_request')).rows[0].n;
    const hmac = novoHmac();
    await perfilComHmac('aprovada', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    const { rows } = await client.query(
      `select u.status as conta, p.suspended_at, p.verification_status
         from app.app_user u join app.professional_profile p on p.user_id = u.id where u.id = $1`, [novo]);
    assert.deepEqual(rows[0], { conta: 'ativo', suspended_at: null, verification_status: 'retida_duplicidade' });
    assert.equal((await client.query('select count(*)::int as n from app.service_request')).rows[0].n, pedidosAntes, 'pedidos nao mudam');
  }));

test('T40-11: recurso de retido e de recusado com original vivo devolve ok, caso sem dono e perfil com o mesmo status', () =>
  tx(async () => {
    const hmac = novoHmac();
    await perfilComHmac('pendente', hmac);
    const r = await perfilSemDoc();
    assert.equal(await cadastra(r, hmac), 'retida_duplicidade');
    const cr = await casoDoProf(r, false);
    assert.equal(await decide(cr, 'retida_duplicidade', 'duplicidade_suspeita'), 'retida_duplicidade');
    const recurso = await client.query(SQL_APPEAL, [r, at(T0)]);
    assert.equal(recurso.rows[0].out_code, 'ok', 'recurso de retido');
    const caso = await client.query('select status, assigned_to, appeal_status from app.verification_case where id = $1', [cr.caso.id]);
    assert.deepEqual(caso.rows[0], { status: 'em_revisao', assigned_to: null, appeal_status: 'pendente' });
    assert.equal(await statusDe(r), 'retida_duplicidade', 'perfil retido mantem o status');

    const s = await perfilSemDoc();
    assert.equal(await cadastra(s, hmac), 'retida_duplicidade');
    const cs = await casoDoProf(s, false);
    assert.equal(await decide(cs, 'recusada', 'duplicidade_suspeita'), 'recusada');
    assert.equal((await client.query(SQL_APPEAL, [s, at(T0)])).rows[0].out_code, 'ok', 'recurso de recusado com original vivo');
    assert.equal(await statusDe(s), 'recusada', 'perfil recusado com original vivo nao espelha em_revisao');
  }));

test('T40-11b: recurso de recusado sem original vivo espelha em_revisao no perfil', () =>
  tx(async () => {
    const hmac = novoHmac();
    const original = await casoDoProf(await perfilComHmac('pendente', hmac), false);
    const t = await perfilSemDoc();
    assert.equal(await cadastra(t, hmac), 'retida_duplicidade');
    const ct = await casoDoProf(t, false);
    assert.equal(await decide(ct, 'recusada', 'duplicidade_suspeita'), 'recusada');
    assert.equal(await decide(original, 'recusada', 'documento_ilegivel'), 'recusada', 'original deixa de estar vivo');
    assert.equal((await client.query(SQL_APPEAL, [t, at(T0)])).rows[0].out_code, 'ok');
    assert.equal(await statusDe(t), 'em_revisao', 'sem original vivo, o espelho volta');
  }));

test('T40-12: evento verification.profile.retained sem CPF, CNPJ, HMAC nem identificador do original', () =>
  tx(async () => {
    const hmac = novoHmac();
    const original = await perfilComHmac('pendente', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    const { rows } = await client.query(
      `select action, object_type, object_id, reason_code, before_state, after_state, actor_role
         from audit.audit_event where action = 'verification.profile.retained' and object_id = $1`, [novo]);
    assert.equal(rows.length, 1, 'um evento de retencao');
    assert.equal(rows[0].reason_code, 'duplicidade_suspeita');
    assert.deepEqual(rows[0].after_state, { verification_status: 'retida_duplicidade' });
    const texto = JSON.stringify(rows[0]);
    assert.equal(texto.includes(hmac), false, 'sem HMAC');
    assert.equal(texto.includes(original), false, 'sem identificador completo do original');
    assert.equal(/\d{11}|\d{14}/.test(texto), false, 'sem digitos de CPF ou CNPJ');
  }));

test('T40-13: troca de documento em perfil retido e recusada pelo gatilho de H-035; nenhum caso novo', () =>
  tx(async () => {
    const hmac = novoHmac();
    await perfilComHmac('pendente', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    const casosAntes = (await client.query('select count(*)::int as n from app.verification_case where professional_id = $1', [novo])).rows[0].n;
    const erro = await falha('update app.professional_profile set document_hmac = $2 where user_id = $1', [novo, novoHmac()]);
    assert.equal(erro?.message, 'professional_documento_imutavel');
    assert.equal(erro?.code, '42501');
    assert.equal(await statusDe(novo), 'retida_duplicidade', 'status intacto');
    assert.equal((await client.query('select count(*)::int as n from app.verification_case where professional_id = $1', [novo])).rows[0].n,
      casosAntes, 'nenhum caso novo');
  }));

test('T40-15: prazo do caso de perfil retido segue a mesma regra de SLA do caso comum', () =>
  tx(async () => {
    const hmac = novoHmac();
    await perfilComHmac('pendente', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    const c = await casoDoProf(novo, false);
    const { rows } = await client.query(
      `select c.sla_target_at, private.verification_sla_target(d.received_at) as esperado
         from app.verification_case c join app.identity_document d on d.professional_id = c.professional_id
        where c.id = $1 limit 1`, [c.caso.id]);
    assert.ok(rows[0].sla_target_at instanceof Date, 'prazo preenchido');
    assert.equal(rows[0].sla_target_at.getTime(), rows[0].esperado.getTime(), 'mesma regra de prazo');
  }));

test('T40-16: caso retido aparece em retidas e nao em pendentes; visao da duplicidade so com vocabulario fixo', () =>
  tx(async () => {
    const hmac = novoHmac();
    const original = await perfilComHmac('pendente', hmac);
    const novo = await perfilSemDoc();
    assert.equal(await cadastra(novo, hmac), 'retida_duplicidade');
    const c = await casoAberto(novo);
    const vs = await staffComPapel('verificacao');
    const s = await sessao(vs);
    const lista = async (escopo) => (await client.query(SQL_FILA, [vs, s, escopo, 50, null, null, at(T0)])).rows.map((r) => r.out_id);
    assert.ok((await lista('retidas')).includes(c.caso.id), 'aparece em retidas');
    assert.equal((await lista('pendentes')).includes(c.caso.id), false, 'nao aparece em pendentes');

    const visao = (await client.query(SQL_VIEW, [vs, s, c.caso.id, at(T0)])).rows[0];
    assert.deepEqual(Object.keys(visao).sort(),
      ['out_can_approve', 'out_document_hmac_present', 'out_is_duplicate', 'out_original_alive', 'out_original_short_id', 'out_original_status']);
    assert.equal(visao.out_is_duplicate, true);
    assert.equal(visao.out_original_short_id, original.slice(0, 8));
    assert.equal(visao.out_original_status, 'vivo');
    assert.equal(visao.out_original_alive, true);
    assert.equal(visao.out_can_approve, false, 'original vivo: aprovar desabilitado');
    const texto = JSON.stringify(visao);
    assert.equal(texto.includes(hmac), false, 'sem HMAC');
    assert.equal(texto.includes(original), false, 'sem identificador completo do original');
    assert.ok(['vivo', 'recusado', 'nenhum'].includes(visao.out_original_status));

    const semDup = await perfilSemDoc();
    assert.equal(await cadastra(semDup, novoHmac()), 'pendente');
    const cs = await casoAberto(semDup);
    const visaoSemDup = (await client.query(SQL_VIEW, [vs, s, cs.caso.id, at(T0)])).rows[0];
    assert.equal(visaoSemDup.out_is_duplicate, false, 'perfil sem duplicidade');
    assert.equal(visaoSemDup.out_original_status, 'nenhum');
  }));

test('H040 regra de duplicidade do cadastro: retido nao conta como original; C com o mesmo documento fica pendente sem original vivo', () =>
  tx(async () => {
    const hmac = novoHmac();
    // A: original pendente com o documento H.
    const a = await perfilComHmac('pendente', hmac);
    // B: segundo cadastro com H enquanto A esta vivo: fica retido.
    const b = await perfilSemDoc();
    assert.equal(await cadastra(b, hmac), 'retida_duplicidade', 'B retido enquanto A esta vivo');
    assert.equal(await statusDe(b), 'retida_duplicidade');
    // A recusada pela Verificacao: nao ha mais original vivo (B e retido e nao conta).
    const casoA = await casoDoProf(a, false);
    assert.equal(await decide(casoA, 'recusada', 'documento_ilegivel'), 'recusada', 'A recusada');
    // C: chega com H. Nao ha original vivo, entao C nao pode ficar retido por causa de B.
    const c = await perfilSemDoc();
    assert.equal(await cadastra(c, hmac), 'pendente', 'C pendente: retido nao conta como original');
    assert.equal(await statusDe(c), 'pendente');
  }));
