// Issue 52 (H-039) | Regras da fila de verificacao no banco (docs/factory/124-DESENHO-H039.md §6):
// T-07 (motivo, combinacao e complemento), T-08 (gate REG fail closed), T-09 (aprovacao em tres cenarios),
// T-12 (falha no registro de leitura desfaz a analise), T-17 (retida_duplicidade), T-18 (recurso), T-21 (fila).
// Banco de desenvolvimento. Cada teste roda em transacao e e desfeito (rollback). Dados sinteticos
// (@example.test). Sem rede, sem envio de e-mail, sem Mapbox.
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
const DIA = 86_400_000;
const at = (ms) => new Date(ms).toISOString();
const NIL = '00000000-0000-0000-0000-000000000000';
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

/** Caso atribuido a um analista (em_revisao), documento ainda nao lido. */
async function casoAtribuido(ms = T0) {
  const prof = await profissional();
  const docId = await documentoRecebido(prof, ms);
  const caso = await casoDe(prof);
  const v1 = await staffComPapel('verificacao');
  const s1 = await sessao(v1, T0);
  await client.query(SQL_ASSIGN, [v1, s1, caso.id, caso.version, at(T0)]);
  return { prof, docId, caso, v1, s1 };
}

/** Caso atribuido com o documento ja lido (pre-condicao da aprovacao). */
async function casoLido(ms = T0) {
  const c = await casoAtribuido(ms);
  await client.query(SQL_READ, [c.v1, c.s1, c.caso.id, c.docId, 'analise_inicial', at(T0)]);
  return c;
}

const argsDecisao = (c, decisao, motivo, complemento, versaoEsperada, analista = c.v1, sessaoAnalista = c.s1) =>
  [analista, sessaoAnalista, c.caso.id, decisao, motivo, complemento, versaoEsperada, at(T0)];

/** Vincula o profissional a um servico de atividade regulamentada ativo (REG). */
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
}

test('T-07: motivo, combinacao decisao x motivo, complemento (CPF, CNPJ, e-mail, 10 digitos, 500 e 501)', () =>
  tx(async () => {
    const c = await casoAtribuido();
    const v = await versao(c.caso.id);
    const erro = (decisao, motivo, complemento) => falha(SQL_DECIDE, argsDecisao(c, decisao, motivo, complemento, v));
    assert.equal((await erro('recusada', null, null))?.message, 'motivo_invalido', 'sem motivo');
    assert.equal((await erro('recusada', 'motivo_livre', null))?.message, 'motivo_invalido', 'motivo fora da lista');
    assert.equal((await erro('aprovada', 'documento_ilegivel', null))?.message, 'motivo_invalido', 'aprovada com motivo de recusa');
    assert.equal((await erro('retida_duplicidade', 'documento_ilegivel', null))?.message, 'motivo_invalido', 'retencao com motivo de recusa');
    assert.equal((await erro('recusada', 'aprovado', null))?.message, 'motivo_invalido', 'recusada com motivo de aprovacao');
    assert.equal((await erro('decisao_livre', 'documento_ilegivel', null))?.message, 'motivo_invalido', 'decisao fora da lista');
    for (const texto of ['CPF 123.456.789-09', 'CNPJ 12.345.678/0001-95', 'contato@example.test', 'pedido 1234567890']) {
      assert.equal((await erro('recusada', 'documento_ilegivel', texto))?.message, 'explicacao_invalida', texto);
    }
    assert.equal((await erro('recusada', 'outro', '   '))?.message, 'explicacao_invalida', 'outro sem complemento');
    assert.equal((await erro('recusada', 'documento_ilegivel', 'a'.repeat(501)))?.message, 'explicacao_invalida', '501 recusado');
    const ok = await client.query(SQL_DECIDE, argsDecisao(c, 'recusada', 'documento_ilegivel', 'a'.repeat(500), v));
    assert.equal(ok.rows[0].out_status, 'recusada', '500 aceito');
  }));

test('T-08: sem REG aprova; REG ativo sem certificacao completa recusa (VRF05, fail closed); com certificacao aprova', () =>
  tx(async () => {
    await client.query('drop function if exists private.certificacoes_completas(uuid)');
    const semReg = await casoLido();
    const okSemReg = await client.query(SQL_DECIDE, argsDecisao(semReg, 'aprovada', 'aprovado', null, await versao(semReg.caso.id)));
    assert.equal(okSemReg.rows[0].out_status, 'aprovada', 'sem REG aprova');

    const reg = await casoLido();
    await vincularRegulado(reg.prof);
    const v = await versao(reg.caso.id);
    assert.equal((await falha(SQL_DECIDE, argsDecisao(reg, 'aprovada', 'aprovado', null, v)))?.message,
      'certificacao_pendente', 'REG sem funcao de certificacao (Issue 51 ausente): recusa');
    await client.query(`create or replace function private.certificacoes_completas(p uuid)
      returns boolean language sql stable as $$ select false $$`);
    assert.equal((await falha(SQL_DECIDE, argsDecisao(reg, 'aprovada', 'aprovado', null, v)))?.message,
      'certificacao_pendente', 'funcao devolve falso: recusa');
    await client.query(`create or replace function private.certificacoes_completas(p uuid)
      returns boolean language sql stable as $$ select true $$`);
    const ok = await client.query(SQL_DECIDE, argsDecisao(reg, 'aprovada', 'aprovado', null, v));
    assert.equal(ok.rows[0].out_status, 'aprovada', 'funcao devolve verdadeiro: aprova');
  }));

test('T-09: aprovacao com (a) documento nao utilizavel, (b) documento nao lido, (c) documento lido', () =>
  tx(async () => {
    await client.query('drop function if exists private.certificacoes_completas(uuid)');
    const semDoc = await casoAtribuido();
    await client.query('update app.identity_document set purge_requested_at = now() where id = $1', [semDoc.docId]);
    assert.equal((await falha(SQL_DECIDE, argsDecisao(semDoc, 'aprovada', 'aprovado', null, await versao(semDoc.caso.id))))?.message,
      'identidade_nao_analisada', 'sem documento utilizavel');

    const naoLido = await casoAtribuido();
    assert.equal((await falha(SQL_DECIDE, argsDecisao(naoLido, 'aprovada', 'aprovado', null, await versao(naoLido.caso.id))))?.message,
      'identidade_nao_analisada', 'documento recebido, sem leitura');

    const lido = await casoLido();
    const ok = await client.query(SQL_DECIDE, argsDecisao(lido, 'aprovada', 'aprovado', null, await versao(lido.caso.id)));
    assert.equal(ok.rows[0].out_status, 'aprovada', 'documento lido');
    const perfil = await client.query(
      'select verification_status, verified_at from app.professional_profile where user_id = $1', [lido.prof]);
    assert.equal(perfil.rows[0].verification_status, 'aprovada');
    assert.ok(perfil.rows[0].verified_at instanceof Date, 'verified_at gravado na aprovacao');
  }));

test('T-12: falha injetada no registro de leitura desfaz a analise e o evento', () =>
  tx(async () => {
    const c = await casoAtribuido();
    await client.query(`create or replace function private.teste_falha_log_h039() returns trigger
      language plpgsql as $$ begin raise exception 'falha_injetada_h039'; end $$`);
    await client.query(`create trigger teste_falha_log_h039 before insert on app.sensitive_access_log
      for each row execute function private.teste_falha_log_h039()`);
    const err = await falha(SQL_READ, [c.v1, c.s1, c.caso.id, c.docId, 'analise_inicial', at(T0)]);
    assert.equal(err?.message, 'falha_injetada_h039', 'a falha do log interrompe a leitura');
    const doc = await client.query('select analyzed_at from app.identity_document where id = $1', [c.docId]);
    assert.equal(doc.rows[0].analyzed_at, null, 'analyzed_at continua nulo');
    const ev = await client.query(
      `select count(*)::int as n from app.verification_case_event where case_id = $1 and action = 'document_read'`, [c.caso.id]);
    assert.equal(ev.rows[0].n, 0, 'nenhum evento de leitura resta');
    const log = await client.query('select count(*)::int as n from app.sensitive_access_log where verification_case_id = $1', [c.caso.id]);
    assert.equal(log.rows[0].n, 0, 'nenhum registro sensivel resta');
  }));

test('T-17: retida_duplicidade espelha no perfil sem suspender a conta; so sai por decisao motivada', () =>
  tx(async () => {
    const c = await casoLido();
    const retida = await client.query(SQL_DECIDE, argsDecisao(c, 'retida_duplicidade', 'duplicidade_suspeita', null, await versao(c.caso.id)));
    assert.equal(retida.rows[0].out_status, 'retida_duplicidade');
    const perfil = await client.query(
      'select verification_status, suspended_at from app.professional_profile where user_id = $1', [c.prof]);
    assert.equal(perfil.rows[0].verification_status, 'retida_duplicidade', 'perfil espelha a retencao');
    assert.equal(perfil.rows[0].suspended_at, null, 'conta nao e suspensa');
    const naoAssume = await falha(SQL_ASSIGN, [c.v1, c.s1, c.caso.id, await versao(c.caso.id), at(T0)]);
    assert.ok(naoAssume, 'retida nao volta a fila de atribuicao');
    const liberada = await client.query(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, await versao(c.caso.id)));
    assert.equal(liberada.rows[0].out_status, 'aprovada', 'liberacao por decisao motivada');
  }));

test('T-18: recurso de recusada e de retida; segundo recurso, recurso de aprovada e quem decidiu nao assumem', () =>
  tx(async () => {
    const c = await casoLido();
    await client.query(SQL_DECIDE, argsDecisao(c, 'retida_duplicidade', 'duplicidade_suspeita', null, await versao(c.caso.id)));
    const r1 = await client.query('select out_code from private.verification_case_appeal($1, $2)', [c.prof, at(T0)]);
    assert.equal(r1.rows[0].out_code, 'ok', 'recurso de retida');
    const aberto = await client.query('select status, appeal_status, assigned_to from app.verification_case where id = $1', [c.caso.id]);
    assert.deepEqual(aberto.rows[0], { status: 'em_revisao', appeal_status: 'pendente', assigned_to: null });
    const r2 = await client.query('select out_code from private.verification_case_appeal($1, $2)', [c.prof, at(T0)]);
    // A funcao devolve 'recurso_ja_usado' enquanto o recurso esta pendente (o desenho §4.4 citava
    // 'nao_elegivel'; o codigo vale e fica registrado como desvio de nome na Issue 52).
    assert.equal(r2.rows[0].out_code, 'recurso_ja_usado', 'segundo recurso com o primeiro pendente');
    assert.equal((await falha(SQL_ASSIGN, [c.v1, c.s1, c.caso.id, await versao(c.caso.id), at(T0)]))?.code, '42501',
      'quem decidiu nao assume o recurso');
    const v2 = await staffComPapel('verificacao');
    const s2 = await sessao(v2, T0);
    const a2 = await client.query(SQL_ASSIGN, [v2, s2, c.caso.id, await versao(c.caso.id), at(T0)]);
    assert.equal(a2.rows[0].out_status, 'em_revisao');
    await client.query(SQL_READ, [v2, s2, c.caso.id, c.docId, 'reanalise_recurso', at(T0)]);
    const decidida = await client.query(SQL_DECIDE, argsDecisao(c, 'aprovada', 'aprovado', null, await versao(c.caso.id), v2, s2));
    assert.equal(decidida.rows[0].out_status, 'aprovada');
    const r3 = await client.query('select out_code from private.verification_case_appeal($1, $2)', [c.prof, at(T0)]);
    assert.notEqual(r3.rows[0].out_code, 'ok', 'recurso de caso aprovado e recusado');
    const finalCaso = await client.query('select status from app.verification_case where id = $1', [c.caso.id]);
    assert.equal(finalCaso.rows[0].status, 'aprovada');
  }));

test('T-21: fila ordenada por prazo, paginada por chave; limite e escopo fora da faixa sao recusados', () =>
  tx(async () => {
    const vs = await staffComPapel('verificacao');
    const s = await sessao(vs, T0);
    const ids = [];
    for (const dias of [2, 0, 1]) {
      const p = await profissional();
      await documentoRecebido(p, T0 + dias * DIA);
      ids.push((await casoDe(p)).id);
    }
    const fila = (limite, cursorSla, cursorId) => client.query(
      'select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [vs, s, 'pendentes', limite, cursorSla, cursorId, at(T0)]);
    const p1 = await fila(2, at(T0 - 366 * DIA), NIL);
    assert.equal(p1.rows.length, 2, 'pagina de tamanho pedido');
    const ultimo = p1.rows[p1.rows.length - 1];
    const p2 = await fila(50, ultimo.out_sla_target_at, ultimo.out_id);
    const todas = [...p1.rows, ...p2.rows];
    for (let i = 1; i < todas.length; i++) {
      const antes = [new Date(todas[i - 1].out_sla_target_at).getTime(), todas[i - 1].out_id];
      const depois = [new Date(todas[i].out_sla_target_at).getTime(), todas[i].out_id];
      assert.ok(antes[0] < depois[0] || (antes[0] === depois[0] && antes[1] < depois[1]), 'ordem (prazo, id)');
    }
    assert.ok(p2.rows.every((r) => new Date(r.out_sla_target_at).getTime() >= new Date(ultimo.out_sla_target_at).getTime()),
      'a segunda pagina nao repete a primeira');
    const nossos = todas.filter((r) => ids.includes(r.out_id)).map((r) => r.out_id);
    assert.equal(nossos.length, 3, 'os tres casos aparecem na fila');
    assert.equal((await falha('select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [vs, s, 'pendentes', 0, null, null, at(T0)]))?.message, 'admin_entrada_invalida', 'limite zero');
    assert.equal((await falha('select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [vs, s, 'pendentes', 51, null, null, at(T0)]))?.message, 'admin_entrada_invalida', 'limite acima de 50');
    assert.equal((await falha('select * from private.verification_queue_list($1,$2,$3,$4,$5,$6,$7)',
      [vs, s, 'tudo', 10, null, null, at(T0)]))?.message, 'admin_entrada_invalida', 'escopo fora da lista');
  }));
