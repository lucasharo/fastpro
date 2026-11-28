// H-058 (Issue #71) | Testes de banco das funcoes de aceite (162-DESENHO-H058.md, §7, fatia 3).
// Cobre T-H058-07, 09, 12 a 23, 25 a 27, 29, 32, 37 e 39 (funcoes private.acceptance_create, acceptance_read e
// request_acceptance_active). Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before; cada teste
// roda num savepoint desfeito; rollback no after. Dados 100 % sinteticos (prefixo h058-), sem rede, sem envio.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/acceptance-funcoes.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const MS_HORA = 3600 * 1000;
const MARCA = `h058-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const blob = () => Buffer.concat([Buffer.from([1]), randomBytes(43)]);
const iso = (ms) => new Date(ms).toISOString();
const slugSintetico = () => `h058-${randomUUID().replace(/-/g, '').slice(0, 20)}`;

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
});

after(async () => {
  await client.query('rollback');
  await client.end();
});

async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

async function usuario(agora = AGORA, emailVerificado = true) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $5)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), emailVerificado ? agora : null, agora],
  );
  return id;
}

async function servico() {
  const grupo = randomUUID();
  const id = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active) values ($1, $2, $3, 'online', false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`],
  );
  return id;
}

/** Profissional sintetico. opcoes: documento (HMAC), verificacao, emailVerificado, acesso ('vigente'|'expirado'|'nenhum'), servico. */
async function profissional({
  hmac = sha(`doc-${randomUUID()}`),
  verificacao = 'aprovada',
  emailVerificado = true,
  acesso = 'vigente',
  servicoId = null,
} = {}) {
  const id = await usuario(AGORA, emailVerificado);
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at,
                                           document_type, document_enc, document_hmac, public_name, slug)
     values ($1, $2, $3, $4, $4, 'CPF', $5, $6, 'Profissional sintetico', $7)`,
    [id, verificacao, verificacao === 'aprovada' ? AGORA : null, AGORA, blob(), hmac, slugSintetico()],
  );
  if (servicoId) {
    await client.query(
      `insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, 'online', $3)`,
      [id, servicoId, AGORA],
    );
  }
  if (acesso === 'vigente') {
    await concederAcessoVigente(client, id, AGORA);
  } else if (acesso === 'expirado') {
    await client.query(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
       values ($1, $2, 'trial', $3, $4, 'ativa')`,
      [id, randomUUID(), iso(Date.parse(AGORA) - 30 * 24 * MS_HORA), iso(Date.parse(AGORA) - 16 * 24 * MS_HORA)],
    );
  }
  return id;
}

async function rascunho(svc) {
  const id = randomUUID();
  const expira = iso(Date.parse(AGORA) + 7 * 24 * MS_HORA);
  const email = `${MARCA}-rascunho-${id.slice(0, 8)}@example.test`;
  await client.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [id, sha(`cookie-${id}`), svc, expira, sha('ip-sintetico'), AGORA, email, sha(email)],
  );
  return id;
}

async function ponto(sujeito) {
  const r = await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
             'permanent', 'endereco', $5)
     returning id`,
    [sujeito, sha(`end-${randomUUID()}`), SP.lon, SP.lat, AGORA],
  );
  return r.rows[0].id;
}

/** Pedido publicado sintetico. prazoMs: instante do fim da admissao (padrao: 168 h depois de AGORA). */
async function pedido({ prazoMs = Date.parse(AGORA) + 168 * MS_HORA, status = 'publicado' } = {}) {
  const cliente = await usuario();
  const svc = await servico();
  const draft = await rascunho(svc);
  const g = await ponto(draft);
  const r = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5, $6)
     returning id`,
    [cliente, svc, g, draft, iso(prazoMs - 168 * MS_HORA), iso(prazoMs)],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await client.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return { id, cliente, svc };
}

/** Chama a funcao de criacao do aceite e devolve a primeira linha. */
async function criar(requestId, profId, agora = AGORA) {
  const r = await client.query('select * from private.acceptance_create($1, $2, $3)', [requestId, profId, agora]);
  assert.equal(r.rows.length, 1, 'acceptance_create devolve exatamente uma linha');
  return r.rows[0];
}

async function contagem(requestId) {
  const r = await client.query(
    `select (select count(*)::int from app.acceptance where request_id = $1) as aceites,
            (select count(*)::int from app.conversation where request_id = $1) as conversas,
            (select count(*)::int from ops.outbox_event where aggregate_type = 'service_request' and aggregate_id = $1) as eventos,
            (select acceptances_count from app.service_request where id = $1) as contador,
            (select version from app.service_request where id = $1) as versao`,
    [requestId],
  );
  return r.rows[0];
}

/** Erro esperado dentro de savepoint: desfaz so o trecho e devolve o erro. */
async function erroEm(fn) {
  await client.query('savepoint e');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a operacao concluiu');
}

/** Preenche N vagas com profissionais distintos e elegiveis (cada um com documento proprio). */
async function preencher(req, svc, n) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const p = await profissional({ servicoId: svc });
    const r = await criar(req.id, p);
    assert.equal(r.out_outcome, 'criado', `vaga ${i + 1} deve ser criada`);
    ids.push(p);
  }
  return ids;
}

test('T-H058-07 | primeiro aceite: criado, vaga 1, onda 1, conversa ativa, primeiro nome; contador 1 e versao +1', () =>
  isolado(async () => {
    const req = await pedido();
    const antes = await contagem(req.id);
    const p = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    assert.equal(r.out_outcome, 'criado');
    assert.equal(r.out_slot_no, 1);
    assert.equal(r.out_wave, 1);
    assert.equal(r.out_status, 'ativo');
    assert.equal(r.out_conversation_state, 'ativa');
    assert.equal(r.out_first_name, 'Ana');
    assert.ok(r.out_conversation_id);
    const depois = await contagem(req.id);
    assert.equal(depois.aceites, 1);
    assert.equal(depois.conversas, 1);
    assert.equal(depois.eventos, 1);
    assert.equal(depois.contador, antes.contador + 1);
    assert.equal(depois.versao, antes.versao + 1);
  }));

test('T-H058-09 | chave nova com aceite ja ativo do mesmo profissional: existente, sem linhas novas', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const primeiro = await criar(req.id, p);
    const antes = await contagem(req.id);
    const seg = await criar(req.id, p);
    assert.equal(seg.out_outcome, 'existente');
    assert.equal(seg.out_acceptance_id, primeiro.out_acceptance_id);
    assert.equal(seg.out_conversation_id, primeiro.out_conversation_id);
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-12 | 4 aceites sem 2a onda: 5o elegivel recebe sem_vagas, sem contador na saida', () =>
  isolado(async () => {
    const req = await pedido();
    await preencher(req, req.svc, 4);
    const antes = await contagem(req.id);
    const p = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    assert.equal(r.out_outcome, 'sem_vagas');
    assert.equal(r.out_acceptance_id, null);
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-13 | 4 aceites com 2a onda aberta: 5o criado, vaga 5, onda 2', () =>
  isolado(async () => {
    const req = await pedido();
    await preencher(req, req.svc, 4);
    await client.query('update app.service_request set wave2_opened_at = $2 where id = $1', [req.id, AGORA]);
    const p = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    assert.equal(r.out_outcome, 'criado');
    assert.equal(r.out_slot_no, 5);
    assert.equal(r.out_wave, 2);
  }));

test('T-H058-14 | 8 aceites com onda 2: 9o recebe sem_vagas', () =>
  isolado(async () => {
    const req = await pedido();
    await preencher(req, req.svc, 4);
    await client.query('update app.service_request set wave2_opened_at = $2 where id = $1', [req.id, AGORA]);
    await preencher(req, req.svc, 4);
    const p = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    assert.equal(r.out_outcome, 'sem_vagas');
    assert.equal((await contagem(req.id)).aceites, 8);
  }));

test('T-H058-15 | prazo: p_now igual ao prazo recusa (admissao_encerrada); um segundo antes aceita (aberto a direita)', () =>
  isolado(async () => {
    const prazo = Date.parse(AGORA) + 168 * MS_HORA;
    const req = await pedido({ prazoMs: prazo });
    const p1 = await profissional({ servicoId: req.svc });
    const fechado = await criar(req.id, p1, iso(prazo));
    assert.equal(fechado.out_outcome, 'admissao_encerrada');
    const p2 = await profissional({ servicoId: req.svc });
    const aberto = await criar(req.id, p2, iso(prazo - 1000));
    assert.equal(aberto.out_outcome, 'criado');
  }));

test('T-H058-16 | status selecionado, cancelado e concluido: admissao_encerrada', () =>
  isolado(async () => {
    for (const status of ['selecionado', 'cancelado', 'concluido']) {
      const req = await pedido({ status });
      const p = await profissional({ servicoId: req.svc });
      const r = await criar(req.id, p);
      assert.equal(r.out_outcome, 'admissao_encerrada', status);
      assert.equal((await contagem(req.id)).aceites, 0, status);
    }
  }));

test('T-H058-17 | verificacao pendente: profissional_inelegivel, sem escrita', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc, verificacao: 'pendente' });
    const antes = await contagem(req.id);
    assert.equal((await criar(req.id, p)).out_outcome, 'profissional_inelegivel');
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-18 | e-mail nao verificado: profissional_inelegivel', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc, emailVerificado: false });
    assert.equal((await criar(req.id, p)).out_outcome, 'profissional_inelegivel');
  }));

test('T-H058-19 | trial expirado sem vigencia: profissional_inelegivel', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc, acesso: 'expirado' });
    assert.equal((await criar(req.id, p)).out_outcome, 'profissional_inelegivel');
  }));

test('T-H058-20 | dono do pedido: autoaceite_proibido', () =>
  isolado(async () => {
    const req = await pedido();
    await client.query(
      `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at,
                                             document_type, document_enc, document_hmac, public_name, slug)
       values ($1, 'aprovada', $2, $2, $2, 'CPF', $3, $4, 'Dono sintetico', $5)`,
      [req.cliente, AGORA, blob(), sha(`dono-${randomUUID()}`), slugSintetico()],
    );
    await client.query(
      `insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, 'online', $3)`,
      [req.cliente, req.svc, AGORA],
    );
    await concederAcessoVigente(client, req.cliente, AGORA);
    assert.equal((await criar(req.id, req.cliente)).out_outcome, 'autoaceite_proibido');
  }));

test('T-H058-21 | servico nao atendido pelo profissional: servico_ou_raio_incompativel', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: null });
    assert.equal((await criar(req.id, p)).out_outcome, 'servico_ou_raio_incompativel');
    assert.equal((await contagem(req.id)).aceites, 0);
  }));

test('T-H058-22 | identidade ja usada no pedido por outro perfil (fixture direta): aceite_duplicado_identidade; so 1 vaga', () =>
  isolado(async () => {
    const req = await pedido();
    const dono = await profissional({ servicoId: req.svc, hmac: sha(`doc-a-${randomUUID()}`) });
    const segundo = await profissional({ servicoId: req.svc, hmac: sha(`doc-b-${randomUUID()}`) });
    const identidade = (await client.query('select private.identity_id_from_document_hmac($1) as id', [
      (await client.query('select document_hmac from app.professional_profile where user_id = $1', [segundo])).rows[0].document_hmac,
    ])).rows[0].id;
    await client.query(
      `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, status, accepted_at)
       values ($1, $2, $3, 1, 'ativo', $4)`,
      [req.id, dono, identidade, AGORA],
    );
    await client.query('update app.service_request set acceptances_count = 1 where id = $1', [req.id]);
    const r = await criar(req.id, segundo);
    assert.equal(r.out_outcome, 'aceite_duplicado_identidade');
    assert.equal((await contagem(req.id)).aceites, 1);
  }));

test('T-H058-23 | aceite retirado (fixture) e mesmo profissional tenta de novo: reaceite_proibido; contador inalterado', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const primeiro = await criar(req.id, p);
    await client.query(
      `update app.acceptance set status = 'retirado', withdrawn_at = $2 where id = $1`,
      [primeiro.out_acceptance_id, AGORA],
    );
    const antes = await contagem(req.id);
    assert.equal((await criar(req.id, p)).out_outcome, 'reaceite_proibido');
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-25 | falha injetada no insert da mensagem: rollback total (sem aceite, conversa, evento; contador igual)', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const antes = await contagem(req.id);
    await client.query(`create or replace function private.h058_falha_mensagem() returns trigger language plpgsql as $$
      begin raise exception 'falha_injetada' using errcode = '23514'; end $$`);
    await client.query(`create trigger h058_falha_mensagem before insert on app.message
      for each row execute function private.h058_falha_mensagem()`);
    const err = await erroEm(() => criar(req.id, p));
    assert.match(err.message, /falha_injetada/);
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-26 | falha injetada no outbox: rollback total (F-10)', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const antes = await contagem(req.id);
    await client.query(`create or replace function private.h058_falha_outbox() returns trigger language plpgsql as $$
      begin raise exception 'falha_injetada' using errcode = '23514'; end $$`);
    await client.query(`create trigger h058_falha_outbox before insert on ops.outbox_event
      for each row execute function private.h058_falha_outbox()`);
    const err = await erroEm(() => criar(req.id, p));
    assert.match(err.message, /falha_injetada/);
    assert.deepEqual(await contagem(req.id), antes);
  }));

test('T-H058-27 | mensagem de sistema: forma, sem remetente, sem texto gravado; UPDATE e DELETE negados', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    const m = await client.query(
      `select kind, sender_user_id, system_event, body_text, dedupe_key, template_version, params
         from app.message where conversation_id = $1`,
      [r.out_conversation_id],
    );
    assert.equal(m.rows.length, 1);
    const linha = m.rows[0];
    assert.equal(linha.kind, 'sistema');
    assert.equal(linha.sender_user_id, null);
    assert.equal(linha.system_event, 'aceite');
    assert.equal(linha.body_text, null);
    assert.equal(linha.dedupe_key, `acceptance:${r.out_acceptance_id}:accepted`);
    assert.equal(linha.template_version, 1);
    assert.equal(linha.params.acceptance_id, r.out_acceptance_id);
    assert.equal(linha.params.slot_no, 1);
    const upd = await erroEm(() =>
      client.query(`update app.message set state = 'restrita' where conversation_id = $1`, [r.out_conversation_id]),
    );
    assert.match(upd.message, /mensagem_imutavel/);
    const del = await erroEm(() => client.query(`delete from app.message where conversation_id = $1`, [r.out_conversation_id]));
    assert.match(del.message, /mensagem_imutavel/);
  }));

test('T-H058-29 | request_acceptance_active: falso antes, verdadeiro com aceite ativo, falso para outro profissional e entrada nula', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const outro = await profissional({ servicoId: req.svc });
    const ativo = async (r, pr) =>
      (await client.query('select private.request_acceptance_active($1, $2) as ok', [r, pr])).rows[0].ok;
    assert.equal(await ativo(req.id, p), false);
    await criar(req.id, p);
    assert.equal(await ativo(req.id, p), true);
    assert.equal(await ativo(req.id, outro), false);
    assert.equal(await ativo(null, p), false);
    assert.equal(await ativo(req.id, null), false);
  }));

test('T-H058-32 | evento work_accepted: tipo, agregado, sequencia por pedido e payload sem PII', () =>
  isolado(async () => {
    const req = await pedido();
    const p1 = await profissional({ servicoId: req.svc });
    const p2 = await profissional({ servicoId: req.svc });
    const a = await criar(req.id, p1);
    const b = await criar(req.id, p2);
    const ev = await client.query(
      `select type, aggregate_type, aggregate_id, aggregate_seq, payload
         from ops.outbox_event where aggregate_type = 'service_request' and aggregate_id = $1 order by aggregate_seq`,
      [req.id],
    );
    assert.equal(ev.rows.length, 2);
    assert.equal(ev.rows[0].type, 'work_accepted');
    assert.equal(ev.rows[0].aggregate_seq, '1');
    assert.equal(ev.rows[1].aggregate_seq, '2');
    assert.equal(ev.rows[0].payload.acceptanceId, a.out_acceptance_id);
    assert.equal(ev.rows[1].payload.acceptanceId, b.out_acceptance_id);
    assert.deepEqual(
      Object.keys(ev.rows[0].payload).sort(),
      ['acceptanceId', 'acceptedAt', 'customerUserId', 'professionalId', 'requestId', 'slotNo'],
    );
    assert.doesNotMatch(JSON.stringify(ev.rows[0].payload), /Ana|@example|Profissional sintetico/);
  }));

test('T-H058-37 | insert direto fora da funcao com vaga errada: recusado pelo banco (defesa em profundidade)', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const err = await erroEm(() =>
      client.query(
        `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, status, accepted_at)
         values ($1, $2, $3, 3, 'ativo', $4)`,
        [req.id, p, randomUUID(), AGORA],
      ),
    );
    assert.match(err.message, /aceite_vaga_incorreta/);
  }));

test('T-H058-39 | replay apos retirada (fixture): acceptance_read mostra retirado e sem primeiro nome; outro profissional nao ve', () =>
  isolado(async () => {
    const req = await pedido();
    const p = await profissional({ servicoId: req.svc });
    const outro = await profissional({ servicoId: req.svc });
    const r = await criar(req.id, p);
    const ativo = await client.query('select * from private.acceptance_read($1, $2)', [r.out_acceptance_id, p]);
    assert.equal(ativo.rows[0].out_first_name, 'Ana');
    assert.equal(ativo.rows[0].out_status, 'ativo');
    await client.query(`update app.acceptance set status = 'retirado', withdrawn_at = $2 where id = $1`, [
      r.out_acceptance_id,
      AGORA,
    ]);
    const depois = await client.query('select * from private.acceptance_read($1, $2)', [r.out_acceptance_id, p]);
    assert.equal(depois.rows[0].out_status, 'retirado');
    assert.equal(depois.rows[0].out_first_name, null);
    assert.equal(depois.rows[0].out_conversation_id, r.out_conversation_id);
    const alheio = await client.query('select * from private.acceptance_read($1, $2)', [r.out_acceptance_id, outro]);
    assert.equal(alheio.rows.length, 0);
  }));

test('entradas nulas: 22023 (bug de chamador, nao rejeicao de negocio)', () =>
  isolado(async () => {
    const err = await erroEm(() => client.query('select * from private.acceptance_create($1, $2, $3)', [null, null, AGORA]));
    assert.equal(err.code, '22023');
  }));
