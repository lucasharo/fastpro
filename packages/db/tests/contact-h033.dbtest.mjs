// Issue 46 (H-033) | Testes de banco do opt-in de telefone (docs/factory/129-DESENHO-H033.md, §8). Nesta entrega:
// T-02, T-04, T-05, T-06, T-08, T-09 (sem prova real: a regra real fica com a E6), T-10, T-11, T-12, T-13, T-14, T-16,
// T-20, T-21 (reaplicacao e catalogo) e a imutabilidade do registro. T-22 (concorrencia) esta em
// contact-h033-concorrencia.dbtest.mjs, porque exige conexoes reais e commit.
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before, que reaplica a migracao (idempotente). Cada
// teste roda num savepoint desfeito; rollback no after. Dados 100 % sinteticos, sem rede, sem envio. Telefone sintetico
// montado por concatenacao. Executar sozinho: node --test --test-concurrency=1 packages/db/tests/contact-h033.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIG = new URL('../../../supabase/migrations/20261113250000_contact_create_phone_consent.sql', import.meta.url);
const MIG_CORRECAO = new URL('../../../supabase/migrations/20261113250100_contact_fix_available_volatile.sql', import.meta.url);
const MIG_REVOGA = new URL('../../../supabase/migrations/20261113290000_contact_revoke_trigger_execute.sql', import.meta.url);

const AGORA = '2099-08-15T12:00:00.000Z';
const MARCA = `h033-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const SENTINELA = ['5511', '98765', '4321'].join('');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');
/** Blob sintetico no formato da cifra (versao 1, tamanho dentro do CHECK). Nao decifrado aqui. */
const blob = () => Buffer.concat([Buffer.from([1]), randomBytes(43)]);

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  await client.query(semControle(readFileSync(MIG, 'utf8')));
  await client.query(semControle(readFileSync(MIG_CORRECAO, 'utf8')));
  await client.query(semControle(readFileSync(MIG_REVOGA, 'utf8')));
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

async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a consulta devolveu resultado');
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $4)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), AGORA],
  );
  return id;
}

async function profissional() {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', $2, $2, $2)`,
    [id, AGORA],
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
    `insert into app.service (id, group_id, name, modality, regulated, active) values ($1, $2, $3, 'presencial', false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`],
  );
  return id;
}

async function ponto(tipo, sujeito) {
  const r = await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ($1, $2, $3, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography,
             'permanent', 'endereco', $6)
     returning id`,
    [tipo, sujeito, sha(`end-${randomUUID()}`), SP.lon, SP.lat, AGORA],
  );
  return r.rows[0].id;
}

async function rascunho(svc) {
  const id = randomUUID();
  const expira = new Date(Date.parse(AGORA) + 7 * 86400000).toISOString();
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

/** Pedido sintetico publicado, sem telefone. prazo: deslocamento do fim da admissao. dono: reutiliza o cliente. */
async function pedido({ prazo = '168 hours', cliente: dono } = {}) {
  const cliente = dono ?? (await usuario());
  const svc = await servico();
  const draft = await rascunho(svc);
  const g = await ponto('request', draft);
  const r = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + $6::interval as dl) d
     returning id`,
    [cliente, svc, g, draft, AGORA, prazo],
  );
  return { id: r.rows[0].id, cliente };
}

/** Pedido com telefone e liberacao geral (consentimento v1), para revelacao e revogacao. */
async function pedidoComTelefoneGeral() {
  const p = await pedido();
  await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
    p.cliente, p.id, blob(), 'v1', AGORA,
  ]);
  return p;
}

/** Liberacao da guarda de aceite so dentro do savepoint do teste (a funcao real permanece fechada). */
async function aceiteAtivoNoTeste() {
  await client.query(`create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$ select true $$`);
}

/** Guarda devolvendo falso dentro do savepoint do teste (mesmo efeito da funcao real ate a E6). */
async function aceiteFechadoNoTeste() {
  await client.query(`create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $$ select false $$`);
}

test('T-02 | publicacao com telefone e sem marcar: phone_enc gravado e zero linhas em contact_consent', () =>
  isolado(async () => {
    const p = await pedido();
    const r = await client.query('select out_state from private.request_phone_attach($1, $2, $3, false, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    assert.equal(r.rows[0].out_state, 'sem_consentimento');
    const g = await client.query('select (phone_enc is not null) as tem from app.service_request where id = $1', [p.id]);
    assert.equal(g.rows[0].tem, true);
    const c = await client.query('select count(*)::int as n from app.contact_consent where request_id = $1', [p.id]);
    assert.equal(c.rows[0].n, 0);
  }));

test('T-04 | sharePhone verdadeiro cria uma linha geral v1 (formulario_pedido); o numero nao aparece em claro no banco', () =>
  isolado(async () => {
    const p = await pedido();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    const c = await client.query(
      `select kind, scope, granted_via, text_version from app.contact_consent where request_id = $1`,
      [p.id],
    );
    assert.deepEqual(c.rows, [{ kind: 'telefone', scope: 'todos_participantes', granted_via: 'formulario_pedido', text_version: 'v1' }]);
    const varredura = await client.query(
      `select (select count(*) from app.contact_consent x where x::text like $1) as consent,
              (select count(*) from app.contact_reveal_log y where y::text like $1) as log,
              (select count(*) from app.service_request s where s::text like $1) as pedido`,
      [`%${SENTINELA}%`],
    );
    assert.deepEqual(varredura.rows[0], { consent: '0', log: '0', pedido: '0' });
  }));

test('T-05 | aceite fechado (guarda real): revelacao devolve zero linhas e o log fica vazio', () =>
  isolado(async () => {
    const p = await pedido();
    const prof = await profissional();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    const r = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(r.rows.length, 0);
    const ok = await client.query('select private.contact_available_professional($1, $2, $3) as ok', [prof, p.id, AGORA]);
    assert.equal(ok.rows[0].ok, false);
    const log = await client.query('select count(*)::int as n from app.contact_reveal_log where request_id = $1', [p.id]);
    assert.equal(log.rows[0].n, 0);
  }));

test('T-06 | aceite ativo (guarda substituida no savepoint) e consentimento: revela o blob e grava uma linha de log sem numero', () =>
  isolado(async () => {
    const p = await pedido();
    const prof = await profissional();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    await aceiteAtivoNoTeste();
    const r = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].out_limited, false);
    assert.ok(r.rows[0].out_phone_enc !== null);
    const log = await client.query(
      'select professional_id, kind, at, consent_id from app.contact_reveal_log where request_id = $1',
      [p.id],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].professional_id, prof);
    assert.equal(log.rows[0].kind, 'telefone');
    const texto = await client.query('select x::text as t from app.contact_reveal_log x where request_id = $1', [p.id]);
    assert.equal(texto.rows[0].t.includes(SENTINELA), false);
  }));

test('T-08 | app_api, anon e authenticated sem select nas tabelas e sem execute nas funcoes de contato', async () => {
  for (const papel of ['app_api', 'anon', 'authenticated']) {
    const t = await client.query(
      `select has_table_privilege($1, 'app.contact_consent', 'select') as c,
              has_table_privilege($1, 'app.contact_reveal_log', 'select') as l`,
      [papel],
    );
    assert.equal(t.rows[0].c, false, `${papel} sem select em contact_consent`);
    assert.equal(t.rows[0].l, false, `${papel} sem select em contact_reveal_log`);
    const f = await client.query(
      `select has_function_privilege($1, 'private.contact_reveal_phone(uuid,uuid,timestamptz)', 'execute') as e`,
      [papel],
    );
    assert.equal(f.rows[0].e, false, `${papel} sem execute na revelacao`);
  }
});

test('T-09 | retirada: com a guarda devolvendo falso depois de revelar, a proxima revelacao e negada e o log permanece', () =>
  isolado(async () => {
    const p = await pedidoComTelefoneGeral();
    const prof = await profissional();
    await aceiteAtivoNoTeste();
    const primeira = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(primeira.rows.length, 1);
    await aceiteFechadoNoTeste();
    const depois = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(depois.rows.length, 0);
    const log = await client.query('select count(*)::int as n from app.contact_reveal_log where request_id = $1', [p.id]);
    assert.equal(log.rows[0].n, 1);
  }));

test('T-10 | revogacao geral: revoga todas as liberacoes; segunda revogacao devolve 0; consentimento so ganha revogacao uma vez', () =>
  isolado(async () => {
    const p = await pedido();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    const primeira = await client.query('select out_revoked, out_state from private.contact_consent_revoke($1, $2, null, $3)', [
      p.cliente, p.id, AGORA,
    ]);
    assert.equal(primeira.rows[0].out_revoked, 1);
    const segunda = await client.query('select out_revoked from private.contact_consent_revoke($1, $2, null, $3)', [
      p.cliente, p.id, AGORA,
    ]);
    assert.equal(segunda.rows[0].out_revoked, 0);
    const motivo = await client.query('select revoked_reason from app.contact_consent where request_id = $1', [p.id]);
    assert.equal(motivo.rows[0].revoked_reason, 'cliente_geral');
    const err = await erroEm(`update app.contact_consent set text_version = 'v2' where request_id = $1`, [p.id]);
    assert.match(String(err.message), /consentimento_imutavel/);
    const apaga = await erroEm('delete from app.contact_consent where request_id = $1', [p.id]);
    assert.match(String(apaga.message), /registro_somente_insercao/);
  }));

test('T-11 | duas liberacoes individuais: revogar uma mantem a outra revelando; quem so esta coberto pelo geral recebe exige_revogar_geral', () =>
  isolado(async () => {
    const p = await pedido();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, false, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    const a = await profissional();
    const b = await profissional();
    await aceiteAtivoNoTeste();
    const lib = (prof) =>
      client.query('select out_state from private.contact_consent_grant_professional($1, $2, $3, $4, $5)', [
        p.cliente, p.id, prof, 'v1', AGORA,
      ]);
    assert.equal((await lib(a)).rows[0].out_state, 'liberado');
    assert.equal((await lib(b)).rows[0].out_state, 'liberado');
    const rev = await client.query('select out_revoked, out_state from private.contact_consent_revoke($1, $2, $3, $4)', [
      p.cliente, p.id, a, AGORA,
    ]);
    assert.deepEqual(rev.rows[0], { out_revoked: 1, out_state: 'revogado' });
    const seguiu = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [b, p.id, AGORA]);
    assert.equal(seguiu.rows.length, 1);
    const parou = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [a, p.id, AGORA]);
    assert.equal(parou.rows.length, 0);

    const g = await pedidoComTelefoneGeral();
    const c = await profissional();
    const exige = await client.query('select out_revoked, out_state from private.contact_consent_revoke($1, $2, $3, $4)', [
      g.cliente, g.id, c, AGORA,
    ]);
    assert.deepEqual(exige.rows[0], { out_revoked: 0, out_state: 'exige_revogar_geral' });
  }));

test('T-12 | liberacao individual no chat: sem telefone 409, sem aceite recusada, com aceite cria scope profissional via chat, repetir e idempotente', () =>
  isolado(async () => {
    const prof = await profissional();
    const semTel = await pedido();
    await aceiteAtivoNoTeste();
    const r0 = await client.query('select out_state from private.contact_consent_grant_professional($1, $2, $3, $4, $5)', [
      semTel.cliente, semTel.id, prof, 'v1', AGORA,
    ]);
    assert.equal(r0.rows[0].out_state, 'sem_telefone');

    const p = await pedido();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, false, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    await aceiteFechadoNoTeste();
    const r1 = await client.query('select out_state from private.contact_consent_grant_professional($1, $2, $3, $4, $5)', [
      p.cliente, p.id, prof, 'v1', AGORA,
    ]);
    assert.equal(r1.rows[0].out_state, 'sem_aceite');
    await aceiteAtivoNoTeste();
    const r2 = await client.query('select out_state from private.contact_consent_grant_professional($1, $2, $3, $4, $5)', [
      p.cliente, p.id, prof, 'v1', AGORA,
    ]);
    assert.equal(r2.rows[0].out_state, 'liberado');
    const linha = await client.query(
      'select scope, granted_via, professional_id from app.contact_consent where request_id = $1',
      [p.id],
    );
    assert.deepEqual(linha.rows, [{ scope: 'profissional', granted_via: 'chat', professional_id: prof }]);
    const r3 = await client.query('select out_state from private.contact_consent_grant_professional($1, $2, $3, $4, $5)', [
      p.cliente, p.id, prof, 'v1', AGORA,
    ]);
    assert.equal(r3.rows[0].out_state, 'ja_liberado');
    const total = await client.query('select count(*)::int as n from app.contact_consent where request_id = $1', [p.id]);
    assert.equal(total.rows[0].n, 1);
  }));

test('T-13 | republicacao: pedido novo nasce sem consentimento, mesmo com telefone pre-preenchido; nenhuma copia de contact_consent', () =>
  isolado(async () => {
    const antigo = await pedidoComTelefoneGeral();
    const antes = await client.query('select count(*)::int as n from app.contact_consent where request_id = $1', [antigo.id]);
    const tel = await client.query('select private.request_phone_owner_get($1, $2) as t', [antigo.cliente, antigo.id]);
    assert.notEqual(tel.rows[0].t, null);
    const novo = await pedido({ cliente: antigo.cliente });
    const at = await client.query('select out_state from private.request_phone_attach($1, $2, $3, false, $4, $5)', [
      antigo.cliente, novo.id, tel.rows[0].t, 'v1', AGORA,
    ]);
    assert.equal(at.rows[0].out_state, 'sem_consentimento');
    const novoCount = await client.query('select count(*)::int as n from app.contact_consent where request_id = $1', [novo.id]);
    assert.equal(novoCount.rows[0].n, 0);
    const depois = await client.query('select count(*)::int as n from app.contact_consent where request_id = $1', [antigo.id]);
    assert.equal(depois.rows[0].n, antes.rows[0].n);
  }));

test('T-14 | trocar e apagar o telefone revoga as liberacoes ativas (gatilho), inclusive por update direto', () =>
  isolado(async () => {
    const p = await pedido();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    await client.query('update app.service_request set phone_enc = $2 where id = $1', [p.id, blob()]);
    const trocado = await client.query('select revoked_reason from app.contact_consent where request_id = $1', [p.id]);
    assert.equal(trocado.rows[0].revoked_reason, 'telefone_alterado');
    await client.query('update app.service_request set phone_enc = null where id = $1', [p.id]);
    const apagado = await client.query('select revoked_at from app.contact_consent where request_id = $1', [p.id]);
    assert.ok(apagado.rows[0].revoked_at !== null);
  }));

test('registro de revelacao: update e delete recusados (somente insercao)', () =>
  isolado(async () => {
    const p = await pedido();
    const prof = await profissional();
    await client.query('select out_state from private.request_phone_attach($1, $2, $3, true, $4, $5)', [
      p.cliente, p.id, blob(), 'v1', AGORA,
    ]);
    await aceiteAtivoNoTeste();
    await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    const upd = await erroEm('update app.contact_reveal_log set kind = kind where request_id = $1', [p.id]);
    assert.match(String(upd.message), /log_somente_insercao/);
    const del = await erroEm('delete from app.contact_reveal_log where request_id = $1', [p.id]);
    assert.match(String(del.message), /registro_somente_insercao/);
  }));

test('T-16 | prazo vencido nega o pedido aberto no mesmo instante, sem carencia', () =>
  isolado(async () => {
    const p = await pedido({ prazo: '168 hours' });
    const antes = await client.query('select private.request_open_for_contact($1, $2) as ok', [p.id, AGORA]);
    assert.equal(antes.rows[0].ok, true);
    const depois = await client.query('select private.request_open_for_contact($1, $2) as ok', [p.id, '2099-08-30T00:00:00.000Z']);
    assert.equal(depois.rows[0].ok, false);
  }));

test('T-20 | limite: 11 revelacoes em 10 min = limitado na 11a, sem linha nova; sem direito devolve zero linhas, nunca limite', () =>
  isolado(async () => {
    const p = await pedidoComTelefoneGeral();
    const prof = await profissional();
    await aceiteAtivoNoTeste();
    for (let i = 1; i <= 10; i++) {
      const r = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
      assert.equal(r.rows[0].out_limited, false, `revelacao ${i} dentro do limite`);
    }
    const onze = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(onze.rows.length, 1);
    assert.equal(onze.rows[0].out_limited, true);
    assert.equal(onze.rows[0].out_phone_enc, null);
    const log = await client.query('select count(*)::int as n from app.contact_reveal_log where request_id = $1', [p.id]);
    assert.equal(log.rows[0].n, 10);
    await aceiteFechadoNoTeste();
    const semDireito = await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    assert.equal(semDireito.rows.length, 0);
    const logDepois = await client.query('select count(*)::int as n from app.contact_reveal_log where request_id = $1', [p.id]);
    assert.equal(logDepois.rows[0].n, 10);
  }));

test('T-21 | migracao reaplicada sem erro; catalogo: nenhuma funcao devolve coluna phone ou email; saidas de status e disponibilidade sem blob', () =>
  isolado(async () => {
    for (const arq of [MIG, MIG_CORRECAO, MIG_REVOGA]) {
      await client.query(semControle(readFileSync(arq, 'utf8')));
    }
    const nomes = [
      'request_acceptance_active', 'request_open_for_contact', 'request_phone_attach', 'request_phone_replace',
      'contact_consent_grant_professional', 'contact_consent_revoke', 'contact_reveal_phone',
      'contact_available_professional', 'contact_owner_status', 'request_phone_owner_get',
    ];
    const r = await client.query(
      `select p.proname, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[])`,
      [nomes],
    );
    assert.equal(r.rows.length, nomes.length);
    for (const linha of r.rows) {
      assert.doesNotMatch(linha.res, /(^|[\s(,])(phone|email)\s/, linha.proname);
    }
    for (const nome of ['contact_owner_status', 'contact_available_professional']) {
      const linha = r.rows.find((x) => x.proname === nome);
      assert.doesNotMatch(linha.res, /bytea/, nome);
    }
  }));

test('registro de revelacao: a prova de texto nao contem o sentinela (T-06 e T-15 parcial)', () =>
  isolado(async () => {
    const p = await pedidoComTelefoneGeral();
    const prof = await profissional();
    await aceiteAtivoNoTeste();
    await client.query('select * from private.contact_reveal_phone($1, $2, $3)', [prof, p.id, AGORA]);
    const texto = await client.query(
      `select (select count(*) from app.contact_reveal_log x where x::text like $1) as log,
              (select count(*) from app.contact_consent y where y::text like $1) as consent`,
      [`%${SENTINELA}%`],
    );
    assert.deepEqual(texto.rows[0], { log: '0', consent: '0' });
  }));
