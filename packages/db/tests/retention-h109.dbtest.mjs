// H-109 (Issue #118) | Mecanismo de retencao sem prazos (docs/factory/82-DESENHO-H109.md §1, §2, §5, §7;
// 79-REFINO-H109.md CA-H109-01, 02, 03, 06, 08, 11). Migracao 20261111470000_retention_create_policy, aplicada
// DENTRO da transacao de cada teste. Tudo e desfeito com rollback; nada persiste no banco de desenvolvimento.
// Valores sinteticos (@example.test); prazos de teste (30 dias) existem so dentro da transacao, nunca na migracao.
// Erros esperados usam savepoint, porque um erro no Postgres aborta a transacao inteira.
// Nao cobre aqui: fase B (Storage, handler TS) e interrupcao no meio do lote (CA-H109-07, CA-H109-09).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/retention-h109.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261111470000_retention_create_policy.sql'),
  'utf8',
);
const DIA = 86400000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const CLASSES = ['RC-01', 'RC-02', 'RC-03', 'RC-04', 'RC-05', 'RC-06', 'RC-07', 'RC-10'];

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. Nada fica no banco compartilhado. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa fn dentro de savepoint. Devolve o erro (ou null). Mantem a transacao utilizavel. */
async function erroEm(fn) {
  await client.query('savepoint sp_erro');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
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

/** Equipe admin ativa com os papeis dados (governanca_dados nao e superadmin). */
async function equipe(...papeis) {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  for (const papel of papeis) {
    await client.query(
      `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
       values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
      [id, papel],
    );
  }
  return id;
}

/** Profissional com documento gravado e verificacao datada (insert direto: o gatilho so protege UPDATE). */
async function profissionalComDocumento(verificadoEm) {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac,
        verified_at, created_at, updated_at)
     values ($1, 'aprovada', 'Nome Sintetico', $2, 'CPF', $3, $4, $5, now(), now())`,
    [id, `slug-${randomUUID()}`, Buffer.from(`blob-${randomUUID()}`), createHashHex(), at(verificadoEm)],
  );
  return id;
}

function createHashHex() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 32);
}

const politica = async (classe) =>
  (await client.query('select * from app.retention_policy where data_class = $1', [classe])).rows[0];

/** Cadastro: propoe mudanca de politica (cria pedido de dupla aprovacao). Valores padrao: politica de teste. */
async function propor(ator, classe, {
  periodo = '30 days', acao = 'excluir', base = 'parecer-teste-01', vigencia = T0 - DIA,
  habilitada = true, simulacao = true, ms = T0,
} = {}) {
  const change = randomUUID();
  const { rows } = await client.query(
    `select private.retention_policy_propose($1::uuid, $2::uuid, $3::text, $4::interval, $5::text,
                                             $6::text, $7::timestamptz, $8::boolean, $9::boolean, $10::timestamptz) as aprov`,
    [ator, change, classe, periodo, acao, base, vigencia === null ? null : at(vigencia),
      habilitada, simulacao, at(ms)],
  );
  return { change, aprov: rows[0].aprov };
}

/** Voto de outra pessoa no pedido (aprova quando atinge o numero exigido). */
async function votar(aprovador, aprov, ms = T0 + 1000) {
  const { rows } = await client.query(
    'select private.admin_approval_vote($1::uuid, $2::uuid, $3::timestamptz) as s', [aprov, aprovador, at(ms)]);
  return rows[0].s;
}

async function aplicar(ator, change, ms = T0 + 2000) {
  await client.query('select private.retention_policy_apply($1::uuid, $2::uuid, $3::timestamptz)',
    [ator, change, at(ms)]);
}

async function simular(policyId, ms = T0) {
  const { rows } = await client.query(
    'select private.retention_dry_run($1::uuid, $2::timestamptz) as r', [policyId, at(ms)]);
  return rows[0].r;
}

async function lote(policyId, ms = T0) {
  const { rows } = await client.query(
    'select private.retention_mark_batch($1::uuid, 100, $2::timestamptz) as ids', [policyId, at(ms)]);
  return rows[0].ids;
}

/**
 * Politica RC-01 habilitada pelo caminho completo (proposta, voto distinto, aplicacao), depois de uma simulacao
 * registrada e uma nova proposta com execucao (dry_run=false). Devolve o cenario para os testes de expurgo.
 */
async function rc01Executavel() {
  const g1 = await equipe('governanca_dados');
  const g2 = await equipe('governanca_dados');
  const p1 = await propor(g1, 'RC-01', { simulacao: true });
  assert.equal(await votar(g2, p1.aprov), 'aprovada');
  await aplicar(g1, p1.change);
  const pol = await politica('RC-01');
  await simular(pol.id, T0);
  const p2 = await propor(g1, 'RC-01', { simulacao: false });
  assert.equal(await votar(g2, p2.aprov), 'aprovada');
  await aplicar(g1, p2.change);
  return { g1, g2, policyId: pol.id };
}

// CA-H109-01 | semeadura: uma linha por classe, sem prazo, desligada e em simulacao
test('CA-H109-01 politicas semeadas sem prazo, desligadas e em simulacao', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select data_class, period, enabled, dry_run, approved_by, legal_basis_ref, effective_from
         from app.retention_policy order by data_class`);
    assert.deepEqual(rows.map((r) => r.data_class), CLASSES, 'uma linha por classe, sem RC-08, RC-09 e RC-11');
    for (const r of rows) {
      assert.equal(r.period, null, `${r.data_class} sem periodo`);
      assert.equal(r.enabled, false, `${r.data_class} desligada`);
      assert.equal(r.dry_run, true, `${r.data_class} em simulacao`);
      assert.equal(r.approved_by, null);
      assert.equal(r.legal_basis_ref, null);
      assert.equal(r.effective_from, null);
    }
  }));

// CA-H109-01 | com todas as politicas sem periodo, o expurgo nao altera linha nem objeto
test('CA-H109-01 expurgo com politicas sem periodo nao altera linha nem enfileira objeto', () =>
  tx(async () => {
    const antes = await client.query(`select
        (select count(*)::int from app.professional_profile where retention_state is not null) as perfis,
        (select count(*)::int from app.app_user where retention_state is not null) as usuarios,
        (select count(*)::int from app.retention_object_queue) as fila`);
    const { rows: pols } = await client.query('select id, data_class from app.retention_policy');
    for (const p of pols) {
      assert.deepEqual(await lote(p.id), [], `${p.data_class} nao marca nenhum sujeito`);
      const erro = await erroEm(() => simular(p.id));
      assert.equal(erro?.code, '22023', `${p.data_class} sem periodo nao simula`);
    }
    const depois = await client.query(`select
        (select count(*)::int from app.professional_profile where retention_state is not null) as perfis,
        (select count(*)::int from app.app_user where retention_state is not null) as usuarios,
        (select count(*)::int from app.retention_object_queue) as fila`);
    assert.deepEqual(depois.rows[0], antes.rows[0], 'nenhuma linha de dado pessoal alterada');
  }));

// CA-H109-02 | habilitar sem periodo, base legal ou vigencia e recusado; a regra vale tambem por UPDATE direto
test('CA-H109-02 habilitar sem periodo, base legal ou vigencia e recusado (23514), nada e alterado', () =>
  tx(async () => {
    const g = await equipe('governanca_dados');
    const semPeriodo = await erroEm(() => propor(g, 'RC-03', { periodo: null, habilitada: true }));
    assert.equal(semPeriodo?.code, '23514');
    assert.match(semPeriodo.message, /habilitacao_incompleta/);
    const semBase = await erroEm(() => propor(g, 'RC-03', { base: null, habilitada: true }));
    assert.equal(semBase?.code, '23514');
    const semVigencia = await erroEm(() => propor(g, 'RC-03', { vigencia: null, habilitada: true }));
    assert.equal(semVigencia?.code, '23514');

    const { rows: pedidos } = await client.query(
      'select count(*)::int as n from app.approval_request where requested_by = $1', [g]);
    assert.equal(pedidos[0].n, 0, 'nenhum pedido de aprovacao criado');
    assert.equal((await politica('RC-03')).enabled, false, 'politica intacta');

    const direto = await erroEm(() => client.query(
      `update app.retention_policy set enabled = true where data_class = 'RC-03'`));
    assert.equal(direto?.code, '23514', 'a regra de habilitacao completa tambem vale por UPDATE');
    assert.equal((await politica('RC-03')).enabled, false);
  }));

test('CA-H109-02 tentativa recusada fica na trilha (retention.policy.denied)', () =>
  tx(async () => {
    const g = await equipe('governanca_dados');
    const { rows } = await client.query(
      `select private.retention_policy_denied_record($1::uuid, 'RC-03', 'habilitacao_incompleta', $2::timestamptz) as id`,
      [g, at(T0)]);
    assert.ok(rows[0].id, 'evento gravado');
    const { rows: ev } = await client.query(
      `select action, reason_code from audit.audit_event where id = $1`, [rows[0].id]);
    assert.equal(ev[0].action, 'retention.policy.denied');
    assert.equal(ev[0].reason_code, 'habilitacao_incompleta');
  }));

// CA-H109-03 | autoaprovacao recusada; sem voto de outra pessoa nao ha aplicacao; com voto, aplica
test('CA-H109-03 quem propoe nao aprova a propria politica; sem voto distinto nao ha aplicacao', () =>
  tx(async () => {
    const g1 = await equipe('governanca_dados');
    const g2 = await equipe('governanca_dados');
    const { change, aprov } = await propor(g1, 'RC-01', { simulacao: true });

    const auto = await erroEm(() => client.query(
      'select private.admin_approval_vote($1::uuid, $2::uuid, $3::timestamptz)', [aprov, g1, at(T0 + 1000)]));
    assert.equal(auto?.code, '42501');
    assert.match(auto.message, /aprovacao_propria/);

    const semVoto = await erroEm(() => aplicar(g1, change));
    assert.equal(semVoto?.code, 'ADM03', 'sem voto aprovado, a aplicacao e recusada');
    assert.equal((await politica('RC-01')).enabled, false, 'politica intacta');

    assert.equal(await votar(g2, aprov), 'aprovada');
    await aplicar(g1, change);
    const p = await politica('RC-01');
    assert.equal(p.enabled, true);
    assert.equal(p.approved_by, g2, 'aprovador e a outra pessoa');
    assert.equal(p.dry_run, true);
  }));

// CA-H109-01/02 | simulacao antes de executar: dry_run=false sem simulacao registrada e recusado
test('simulacao antes de executar: passar a dry_run=false sem simulacao registrada e recusado', () =>
  tx(async () => {
    const g = await equipe('governanca_dados');
    const recusado = await erroEm(() => propor(g, 'RC-03', { simulacao: false }));
    assert.equal(recusado?.code, '23514');
    assert.match(recusado.message, /simulacao_pendente/);

    const direto = await erroEm(() => client.query(
      `update app.retention_policy set dry_run = false where data_class = 'RC-03'`));
    assert.equal(direto?.code, '23514', 'a regra tambem vale por UPDATE direto');
  }));

// Simulacao (dry run) e expurgo no cenario habilitado: a simulacao nao altera linha; so a politica executavel marca
test('simulacao conta sem alterar; o expurgo so marca depois da simulacao e da execucao aprovada', () =>
  tx(async () => {
    const g1 = await equipe('governanca_dados');
    const g2 = await equipe('governanca_dados');
    const p1 = await propor(g1, 'RC-01', { simulacao: true });
    assert.equal(await votar(g2, p1.aprov), 'aprovada');
    await aplicar(g1, p1.change);
    const pol = await politica('RC-01');

    const elegivel = await profissionalComDocumento(T0 - 60 * DIA);
    const jovem = await profissionalComDocumento(T0 - 10 * DIA);

    assert.deepEqual(await lote(pol.id), [], 'com dry_run=true o expurgo nao marca nada');

    const r = await simular(pol.id, T0);
    assert.ok(r.eligible >= 1, 'a simulacao conta o sujeito vencido');
    const { rows: due } = await client.query(
      `select subject_id from private.retention_due('RC-01', $1::timestamptz - interval '30 days')
        where not held`, [at(T0)]);
    const ids = due.map((d) => d.subject_id);
    assert.ok(ids.includes(elegivel), 'o vencido e elegivel');
    assert.equal(ids.includes(jovem), false, 'o gatilho ainda nao ocorreu: fora da lista');

    const sem = await client.query('select retention_state from app.professional_profile where user_id = $1', [elegivel]);
    assert.equal(sem.rows[0].retention_state, null, 'a simulacao nao altera a linha');

    const simulada = await politica('RC-01');
    assert.ok(simulada.last_dry_run_at, 'simulacao registrada');

    const p2 = await propor(g1, 'RC-01', { simulacao: false });
    assert.equal(await votar(g2, p2.aprov), 'aprovada');
    await aplicar(g1, p2.change);
    assert.equal((await politica('RC-01')).dry_run, false);

    const marcados = await lote(pol.id);
    assert.ok(marcados.includes(elegivel), 'o vencido e marcado para expurgo');
    assert.equal(marcados.includes(jovem), false);
    const { rows: depois } = await client.query(
      'select retention_state from app.professional_profile where user_id = $1', [elegivel]);
    assert.equal(depois[0].retention_state, 'expurgando');
  }));

// CA-H109-06 | hold ativo suspende o sujeito (conta em held); liberado por aprovacao dupla, entra no ciclo seguinte
test('CA-H109-06 hold suspende o sujeito e a liberacao exige aprovacao antes de voltar ao ciclo', () =>
  tx(async () => {
    const { g1, g2, policyId } = await rc01Executavel();
    const sujeito = await profissionalComDocumento(T0 - 60 * DIA);

    const hold = await client.query(
      'select private.legal_hold_place($1::uuid, $2::text, $3::uuid, $4::text, $5::timestamptz) as id',
      [g1, 'user', sujeito, 'litigio_teste', at(T0)]);
    const holdId = hold.rows[0].id;

    const r = await simular(policyId, T0);
    assert.ok(r.held >= 1, 'o hold conta o sujeito como suspenso');
    assert.equal((await lote(policyId)).includes(sujeito), false, 'com hold ativo nao e marcado');

    const aprovacao = await client.query(
      'select private.legal_hold_release_propose($1::uuid, $2::uuid, $3::timestamptz) as id',
      [g1, holdId, at(T0 + 1000)]);
    const pedido = aprovacao.rows[0].id;
    assert.equal(await votar(g2, pedido, T0 + 2000), 'aprovada');
    await client.query(
      'select private.legal_hold_release_apply($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)',
      [g1, holdId, pedido, at(T0 + 3000)]);

    const { rows: h } = await client.query(
      'select released_at, approval_request_id from app.legal_hold where id = $1', [holdId]);
    assert.ok(h[0].released_at, 'hold liberado');
    assert.equal(h[0].approval_request_id, pedido, 'liberado com a aprovacao');

    assert.ok((await lote(policyId, T0 + 4000)).includes(sujeito), 'liberado, entra no ciclo seguinte');
  }));

test('CA-H109-06 liberar hold sem aprovacao distinta e recusado', () =>
  tx(async () => {
    const { g1, policyId } = await rc01Executavel();
    const sujeito = await profissionalComDocumento(T0 - 60 * DIA);
    const holdId = (await client.query(
      'select private.legal_hold_place($1::uuid, $2::text, $3::uuid, $4::text, $5::timestamptz) as id',
      [g1, 'user', sujeito, 'litigio_teste', at(T0)])).rows[0].id;
    const pedido = (await client.query(
      'select private.legal_hold_release_propose($1::uuid, $2::uuid, $3::timestamptz) as id',
      [g1, holdId, at(T0 + 1000)])).rows[0].id;
    const erro = await erroEm(() => client.query(
      'select private.legal_hold_release_apply($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)',
      [g1, holdId, pedido, at(T0 + 3000)]));
    assert.equal(erro?.code, 'ADM03', 'sem voto, o hold continua ativo');
    assert.equal((await client.query('select released_at from app.legal_hold where id = $1', [holdId])).rows[0].released_at, null);
    assert.equal((await lote(policyId, T0 + 4000)).includes(sujeito), false);
  }));

// RC-06 e RC-07 so reter; RC-02 nao aceita excluir (regra por classe, espelhada no banco)
test('RC-06 e RC-07 aceitam somente reter; outras acoes sao recusadas', () =>
  tx(async () => {
    const g = await equipe('governanca_dados');
    for (const [classe, acao] of [['RC-07', 'excluir'], ['RC-07', 'anonimizar'], ['RC-06', 'excluir'], ['RC-06', 'anonimizar']]) {
      const erro = await erroEm(() => propor(g, classe, { acao, habilitada: false }));
      assert.equal(erro?.code, '23514', `${classe} com ${acao} recusado`);
      assert.match(erro.message, /acao_nao_permitida/);
    }

    const direto = await erroEm(() => client.query(
      `update app.retention_policy set action = 'excluir' where data_class = 'RC-07'`));
    assert.equal(direto?.code, '23514', 'RC-07 nao aceita excluir nem por UPDATE direto');

    const { rows } = await client.query(
      `select private.retention_acao_permitida('RC-07', 'reter') as rc07_reter,
              private.retention_acao_permitida('RC-07', 'excluir') as rc07_excluir,
              private.retention_acao_permitida('RC-06', 'anonimizar') as rc06_anonimizar,
              private.retention_acao_permitida('RC-02', 'excluir') as rc02_excluir,
              private.retention_acao_permitida('RC-01', 'excluir') as rc01_excluir`);
    assert.deepEqual(rows[0], {
      rc07_reter: true, rc07_excluir: false, rc06_anonimizar: false, rc02_excluir: false, rc01_excluir: true,
    });
  }));

test('RC-07 com reter e habilitada e nunca marca linhas para expurgo', () =>
  tx(async () => {
    const { rows: [pol] } = await client.query(
      `select id from app.retention_policy where data_class = 'RC-07'`);
    await client.query(
      `update app.retention_policy
          set period = interval '30 days', action = 'reter', legal_basis_ref = 'parecer-teste-07',
              approved_by = $2, effective_from = $3::timestamptz, enabled = true, dry_run = false,
              last_dry_run_at = $3::timestamptz
        where id = $1`,
      [pol.id, await equipe('governanca_dados'), at(T0 - DIA)]);
    assert.deepEqual(await lote(pol.id), [], 'reter nao marca linha alguma');
  }));

// Auditoria da simulacao: evento com contagens e sem identificador de sujeito
test('a simulacao grava evento de lote so com contagens (sem id de sujeito)', () =>
  tx(async () => {
    const { policyId } = await rc01Executavel();
    const sujeito = await profissionalComDocumento(T0 - 60 * DIA);
    await simular(policyId, T0);
    const { rows } = await client.query(
      `select after_state from audit.audit_event
        where action = 'retention.batch.executed' and object_id = $1 order by seq desc limit 1`, [policyId]);
    assert.ok(rows.length === 1, 'evento de lote gravado');
    const estado = rows[0].after_state;
    const chaves = ['data_class', 'action', 'eligible', 'processed', 'held', 'failed', 'dry_run', 'batch_no'];
    for (const k of Object.keys(estado)) assert.ok(chaves.includes(k), `chave permitida: ${k}`);
    assert.equal(JSON.stringify(estado).includes(sujeito), false, 'nenhum id de sujeito no evento');
  }));

// CA-H109-08 | audit_event nao e tocado pelo expurgo: UPDATE negado pelo gatilho e sem privilegio direto
test('CA-H109-08 audit_event nao aceita UPDATE e o papel de aplicacao nao tem UPDATE/DELETE nela', () =>
  tx(async () => {
    const g = await equipe('governanca_dados');
    const { rows } = await client.query(
      `select private.retention_policy_denied_record($1::uuid, 'RC-03', 'habilitacao_incompleta', $2::timestamptz) as id`,
      [g, at(T0)]);
    const erro = await erroEm(() => client.query(
      `update audit.audit_event set reason_code = 'alterado' where id = $1`, [rows[0].id]));
    assert.ok(erro, 'UPDATE em audit_event e recusado');

    for (const priv of ['UPDATE', 'DELETE']) {
      const { rows: p } = await client.query(
        `select has_table_privilege('app_system', 'audit.audit_event', $1) as ok`, [priv]);
      assert.equal(p[0].ok, false, `app_system sem ${priv} em audit_event`);
    }
  }));

// Privilegios e RLS: tabelas so para app_system (leitura); sem DELETE; funcoes so para app_system
test('privilegios: tabelas de retencao com RLS forcada, so leitura para app_system e sem acesso de borda', () =>
  tx(async () => {
    for (const t of ['retention_policy', 'retention_policy_change', 'legal_hold', 'retention_object_queue']) {
      const { rows } = await client.query(
        `select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`, [`app.${t}`]);
      assert.equal(rows[0].relrowsecurity, true, `${t} com RLS`);
      assert.equal(rows[0].relforcerowsecurity, true, `${t} com RLS forcada`);
      for (const papel of ['anon', 'authenticated', 'service_role', 'app_api']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const { rows: r } = await client.query(
            `select has_table_privilege($1, $2, $3) as ok`, [papel, `app.${t}`, priv]);
          assert.equal(r[0].ok, false, `${papel} sem ${priv} em ${t}`);
        }
      }
      const { rows: del } = await client.query(
        `select has_table_privilege('app_system', $1, 'DELETE') as ok`, [`app.${t}`]);
      assert.equal(del[0].ok, false, `app_system sem DELETE em ${t}`);
    }
  }));

test('privilegios: funcoes de cadastro e expurgo executadas so por app_system', () =>
  tx(async () => {
    const funcoes = [
      'private.retention_policy_propose(uuid,uuid,text,interval,text,text,timestamptz,boolean,boolean,timestamptz)',
      'private.retention_dry_run(uuid,timestamptz)',
      'private.retention_mark_batch(uuid,integer,timestamptz)',
      'private.legal_hold_place(uuid,text,uuid,text,timestamptz)',
    ];
    for (const f of funcoes) {
      const { rows } = await client.query(
        `select has_function_privilege('app_system', $1, 'execute') as sistema,
                has_function_privilege('app_api', $1, 'execute') as api,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as servico`, [f]);
      assert.equal(rows[0].sistema, true, `app_system executa ${f}`);
      assert.equal(rows[0].api, false);
      assert.equal(rows[0].anon, false);
      assert.equal(rows[0].auth, false);
      assert.equal(rows[0].servico, false);
    }
    for (const f of ['private.retention_due(text,timestamptz)', 'private.retention_finalize_rc01(uuid,uuid,timestamptz)']) {
      const { rows } = await client.query(
        `select has_function_privilege('app_system', $1, 'execute') as sistema`, [f]);
      assert.equal(rows[0].sistema, false, `${f} so roda dentro das funcoes publicas`);
    }
  }));
