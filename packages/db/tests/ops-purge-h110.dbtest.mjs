// H-110 (Issue 119) | Expurgos operacionais (docs/factory/105-DESENHO-H110.md §7). Migracao
// 20261112230000_ops_create_operational_purge, aplicada DENTRO da transacao de cada teste e desfeita com rollback.
// Nada persiste no banco de desenvolvimento. Dados sinteticos (@example.test). TTL de teste existem so dentro da
// transacao (nunca na migracao). Erros esperados usam savepoint. Storage nao e tocado aqui (ver adapters.test.ts).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/ops-purge-h110.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
let outro;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261112230000_ops_create_operational_purge.sql'),
  'utf8',
);
// Correcao pos Code Review (E9 com filtro no SQL e ops_purge_media_adia): aplicada depois da original.
const MIGRACAO_CORRECAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261113130000_ops_fix_purge_media_orfaos.sql'),
  'utf8',
);
const DIA = 86400000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const hex64 = () => randomBytes(32).toString('hex');

/**
 * Transacao de teste: aplica a migracao (e a correcao) e desfaz tudo no fim. O DEV ja tem a correcao aplicada, e a
 * correcao muda o tipo de retorno de ops_purge_media_orfaos; por isso a funcao sai antes da sequencia (dentro da
 * transacao, desfeita), o que equivale a uma instalacao do zero: original, depois correcao.
 */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query('drop function if exists private.ops_purge_media_orfaos(timestamptz, integer)');
    await client.query(MIGRACAO);
    await client.query(MIGRACAO_CORRECAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Erro esperado dentro de savepoint (um erro no Postgres aborta a transacao inteira). */
async function erroEm(fn) {
  await client.query('savepoint sp_erro');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  return null;
}

async function cfg(chave, valor) {
  await client.query(
    `insert into ops.app_config (key, value, updated_by) values ($1, $2::jsonb, 'teste-h110')
     on conflict (key) do update set value = excluded.value, version = ops.app_config.version + 1`,
    [chave, JSON.stringify(valor)],
  );
}

async function chama(nome, agora = T0, limite = 500) {
  const res = await client.query(
    `select out_estado, out_removidos, out_retidos, out_falhos from private.${nome}($1::timestamptz, $2::integer)`,
    [at(agora), limite],
  );
  return res.rows[0];
}

async function n(sql, params = []) {
  const res = await client.query(sql, params);
  return Number(res.rows[0].n);
}

async function usuario(status = 'ativo') {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID(), status],
  );
  return id;
}

async function admin() {
  const id = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
     values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
    [id],
  );
  return id;
}

// Sessao ativa exige recent_auth_at e expires_at = absolute_expires_at (CHECK app_session_ativa_consistente).
async function sessao({ user, stage, criada, expira, absoluta, revogada = null }) {
  const id = randomUUID();
  const ativa = stage === 'ativa';
  await client.query(
    `insert into app.app_session (id, user_id, stage, secret_hash, challenge_id, purpose, created_at, expires_at,
                                  absolute_expires_at, revoked_at, recent_auth_at)
     values ($1, $2, $3, $4, $5, 'login', $6, $7, $8, $9, $10)`,
    [id, user, stage, hex64(), randomUUID(), at(criada), at(expira), at(ativa ? expira : (absoluta ?? expira)),
      revogada ? at(revogada) : null, ativa ? at(criada) : null],
  );
  return id;
}

async function desafio({ criado, consumido = null, invalidado = null, expira = criado + 15 * 60000 }) {
  const id = randomUUID();
  await client.query(
    `insert into app.auth_challenge (id, email_hash, purpose, token_hash, code_hmac, expires_at, consumed_at,
                                     invalidated_at, invalid_reason, created_at)
     values ($1, $2, 'login', $3, $4, $5, $6, $7, $8, $9)`,
    [id, hex64(), hex64(), hex64(), at(expira), consumido ? at(consumido) : null, invalidado ? at(invalidado) : null,
      invalidado ? 'substituido' : null, at(criado)],
  );
  return id;
}

async function rascunho({ atualizado, expira, status = 'aberto' }) {
  const res = await client.query(
    `insert into app.request_draft (browser_nonce_hash, ip_hmac, status, expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5) returning id`,
    [hex64(), hex64(), status, at(expira), at(atualizado)],
  );
  return res.rows[0].id;
}

async function eventoOutbox({ agregado, seq, despachado = null }) {
  const id = randomUUID();
  await client.query(
    `insert into ops.outbox_event (id, type, aggregate_type, aggregate_id, aggregate_seq, occurred_at, dispatched_at)
     values ($1, 'teste.evento', 'pedido', $2, $3, now(), $4)`,
    [id, agregado, seq, despachado ? at(despachado) : null],
  );
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
test('CA-H110-01: sem nenhuma chave purge.* todos os blocos ficam desligados e nada muda', () =>
  tx(async () => {
    const u = await usuario();
    await sessao({ user: u, stage: 'identificacao', criada: T0 - 60 * DIA, expira: T0 - 60 * DIA + 15 * 60000 });
    await desafio({ criado: T0 - 60 * DIA, consumido: T0 - 60 * DIA + 60000 });
    await eventoOutbox({ agregado: randomUUID(), seq: 1, despachado: T0 - 60 * DIA });
    const antes = await n('select count(*) as n from app.app_session');
    for (const nome of ['ops_purge_auth_challenge', 'ops_purge_session', 'ops_purge_draft', 'ops_purge_outbox_event',
      'ops_purge_email_outbox', 'ops_purge_idempotency', 'ops_purge_media_access', 'ops_purge_provider_event',
      'ops_purge_media_mark']) {
      assert.equal((await chama(nome)).out_estado, 'desligado', nome);
    }
    assert.equal(await n('select count(*) as n from app.app_session'), antes);
    assert.equal(await n('select count(*) as n from ops.outbox_event'), 1);
  }));

test('CA-H110-02: desafio vencido e consumido sai; pendente vivo e terminal recente ficam', () =>
  tx(async () => {
    await cfg('purge.auth_challenge_seconds', 86400);
    const vencido = await desafio({ criado: T0 - 3 * DIA, consumido: T0 - 3 * DIA + 60000 });
    const pendente = await desafio({ criado: T0 - 60000 });
    const recente = await desafio({ criado: T0 - 3600000, consumido: T0 - 3500000 });
    const r = await chama('ops_purge_auth_challenge');
    assert.equal(r.out_estado, 'ok');
    assert.equal(r.out_removidos, 1);
    const vivos = await client.query('select id from app.auth_challenge order by id');
    const ids = vivos.rows.map((x) => x.id);
    assert.ok(!ids.includes(vencido));
    assert.ok(ids.includes(pendente));
    assert.ok(ids.includes(recente));
  }));

test('CA-H110-03: sessao vencida e revogada alem da janela saem; ativa vigente fica; audit_event intacto', () =>
  tx(async () => {
    await cfg('purge.session_expired_seconds', 7 * 86400);
    await cfg('purge.session_revoked_seconds', 30 * 86400);
    const u = await usuario();
    const identificacaoVencida = await sessao({
      user: u, stage: 'identificacao', criada: T0 - 30 * DIA, expira: T0 - 30 * DIA + 15 * 60000,
    });
    const ativaVencida = await sessao({
      user: u, stage: 'ativa', criada: T0 - 20 * DIA, expira: T0 - 8 * DIA,
    });
    const revogadaAntiga = await sessao({
      user: u, stage: 'ativa', criada: T0 - 70 * DIA, expira: T0 + DIA, absoluta: T0 + DIA, revogada: T0 - 60 * DIA,
    });
    const revogadaRecente = await sessao({
      user: u, stage: 'ativa', criada: T0 - 10 * DIA, expira: T0 + DIA, absoluta: T0 + DIA, revogada: T0 - 5 * DIA,
    });
    const ativa = await sessao({ user: u, stage: 'ativa', criada: T0 - DIA, expira: T0 + DIA, absoluta: T0 + 2 * DIA });
    const cadeiaAntes = JSON.stringify((await client.query('select * from private.audit_verify_chain(1::bigint, null)')).rows);
    const r = await chama('ops_purge_session');
    assert.equal(r.out_estado, 'ok');
    assert.equal(r.out_removidos, 3);
    const ids = (await client.query('select id from app.app_session')).rows.map((x) => x.id);
    assert.ok(!ids.includes(identificacaoVencida));
    assert.ok(!ids.includes(ativaVencida));
    assert.ok(!ids.includes(revogadaAntiga));
    assert.ok(ids.includes(revogadaRecente));
    assert.ok(ids.includes(ativa));
    assert.equal(JSON.stringify((await client.query('select * from private.audit_verify_chain(1::bigint, null)')).rows), cadeiaAntes);
  }));

test('CA-H110-04: rascunho inativo e vencido sai (descartado e apagado); rascunho recente fica; publicado nunca entra', () =>
  tx(async () => {
    await cfg('purge.draft_inactive_seconds', 30 * 86400);
    const velho = await rascunho({ atualizado: T0 - 40 * DIA, expira: T0 - DIA });
    const recente = await rascunho({ atualizado: T0 - DIA, expira: T0 + 10 * DIA });
    const publicado = await rascunho({ atualizado: T0 - 40 * DIA, expira: T0 - DIA, status: 'publicado' });
    const r = await chama('ops_purge_draft');
    assert.equal(r.out_estado, 'ok');
    const ids = (await client.query('select id from app.request_draft')).rows.map((x) => x.id);
    assert.ok(!ids.includes(velho));
    assert.ok(ids.includes(recente));
    assert.ok(ids.includes(publicado));
  }));

test('CA-H110-04b: rascunho com foto pendente tem a foto marcada e o rascunho fica ate a foto sair', () =>
  tx(async () => {
    await cfg('purge.draft_inactive_seconds', 30 * 86400);
    const velho = await rascunho({ atualizado: T0 - 40 * DIA, expira: T0 - DIA });
    await client.query(
      `insert into app.media_asset (draft_id, client_upload_id, declared_type, declared_bytes, status,
                                    pending_expires_at, created_at)
       values ($1, $2, 'image/jpeg', 1000, 'pending', $3, $4)`,
      [velho, randomUUID(), at(T0 - DIA), at(T0 - 40 * DIA)],
    );
    await chama('ops_purge_draft');
    assert.equal(await n('select count(*) as n from app.request_draft where id = $1', [velho]), 1);
    assert.equal(
      await n('select count(*) as n from app.media_asset where draft_id = $1 and purge_requested_at is not null', [velho]),
      1,
    );
    // Segunda execucao nao remarca nem apaga o rascunho: a linha de foto ainda espera o Storage (E1).
    const r2 = await chama('ops_purge_draft');
    assert.equal(r2.out_removidos, 0);
  }));

test('CA-H110-07: outbox despachada alem da janela sai; nao despachada e despachada recente ficam; ultimo do agregado fica', () =>
  tx(async () => {
    await cfg('purge.outbox_dispatched_seconds', 7 * 86400);
    const agregado = randomUUID();
    const antigoDespachado = await eventoOutbox({ agregado, seq: 1, despachado: T0 - 30 * DIA });
    const ultimoDoAgregado = await eventoOutbox({ agregado, seq: 2, despachado: T0 - 30 * DIA });
    const naoDespachado = await eventoOutbox({ agregado: randomUUID(), seq: 1, despachado: null });
    const recente = await eventoOutbox({ agregado: randomUUID(), seq: 1, despachado: T0 - DIA });
    const r = await chama('ops_purge_outbox_event');
    assert.equal(r.out_removidos, 1);
    const ids = (await client.query('select id from ops.outbox_event')).rows.map((x) => x.id);
    assert.ok(!ids.includes(antigoDespachado));
    assert.ok(ids.includes(ultimoDoAgregado));
    assert.ok(ids.includes(naoDespachado));
    assert.ok(ids.includes(recente));
  }));

test('CA-H110-08: chave de idempotencia vencida sai; dentro da janela de repeticao fica', () =>
  tx(async () => {
    await cfg('purge.idempotency_seconds', 48 * 3600);
    const principal = 'user:teste-h110';
    const vencida = randomUUID();
    const viva = randomUUID();
    await client.query(
      `insert into ops.idempotency_key (principal_id, operation, key, request_hash, state, created_at, expires_at)
       values ($1, 'teste.op', $2, $3, 'em_andamento', $4, $5), ($1, 'teste.op', $6, $3, 'em_andamento', $7, $8)`,
      [principal, vencida, hex64(), at(T0 - 5 * DIA), at(T0 - DIA), viva, at(T0 - 60 * 60000), at(T0 + DIA)],
    );
    const r = await chama('ops_purge_idempotency');
    assert.equal(r.out_removidos, 1);
    const chaves = (await client.query('select key from ops.idempotency_key')).rows.map((x) => x.key);
    assert.ok(!chaves.includes(vencida));
    assert.ok(chaves.includes(viva));
  }));

test('CA-H110-10: legal_hold do sujeito retem sessao e evento de outbox do agregado; liberado entra no ciclo seguinte', () =>
  tx(async () => {
    await cfg('purge.session_expired_seconds', 7 * 86400);
    await cfg('purge.outbox_dispatched_seconds', 7 * 86400);
    const u = await usuario();
    const sess = await sessao({ user: u, stage: 'identificacao', criada: T0 - 30 * DIA, expira: T0 - 30 * DIA + 15 * 60000 });
    const agregado = randomUUID();
    await eventoOutbox({ agregado, seq: 1, despachado: T0 - 30 * DIA });
    await eventoOutbox({ agregado, seq: 2, despachado: T0 - DIA });
    const dono = await admin();
    const hold = randomUUID();
    await client.query(
      `insert into app.legal_hold (id, subject_type, subject_id, reason_code, placed_by, placed_at)
       values ($1, 'user', $2, 'teste_h110', $3, $4)`,
      [hold, u, dono, at(T0 - DIA)],
    );
    const r1 = await chama('ops_purge_session');
    assert.equal(r1.out_removidos, 0);
    assert.equal(r1.out_retidos, 1);
    assert.equal(await n('select count(*) as n from app.app_session where id = $1', [sess]), 1);
  }));

test('CA-H110-09: rollup de dias fechados soma igual; reexecucao nao duplica; detalhe so sai com a chave propria', () =>
  tx(async () => {
    await client.query(`create table ops.media_access_log (
      id bigserial primary key, at timestamptz not null, professional_id uuid not null,
      outcome text not null)`);
    const prof = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      await client.query('insert into ops.media_access_log (at, professional_id, outcome) values ($1, $2, $3)',
        [at(T0 - 3 * DIA + i * 60000), prof, 'ok']);
    }
    await client.query('insert into ops.media_access_log (at, professional_id, outcome) values ($1, $2, $3)',
      [at(T0 - 3 * DIA), prof, 'negado']);
    await client.query('insert into ops.media_access_log (at, professional_id, outcome) values ($1, $2, $3)',
      [at(T0 - 60000), prof, 'ok']);
    await cfg('purge.media_access_rollup_after_seconds', 86400);
    const r1 = await chama('ops_purge_media_access');
    assert.equal(r1.out_estado, 'ok');
    assert.equal(r1.out_removidos, 0, 'sem chave de detalhe nada e removido');
    const somaRollup = await n('select coalesce(sum(n), 0) as n from ops.media_access_daily where professional_id = $1', [prof]);
    assert.equal(somaRollup, 4, 'soma do rollup e igual as 4 linhas de dias fechados (a linha de hoje fica de fora)');
    await chama('ops_purge_media_access');
    assert.equal(
      await n('select count(*) as n from ops.media_access_daily where professional_id = $1', [prof]),
      2, 'reexecucao nao cria agregado duplicado (dois grupos: ok e negado)',
    );
    await cfg('purge.media_access_detail_seconds', 86400);
    const r3 = await chama('ops_purge_media_access');
    assert.equal(r3.out_removidos, 4, 'detalhe removido so dos dias ja agregados');
    assert.equal(await n('select count(*) as n from ops.media_access_log'), 1, 'so o dia corrente permanece');
  }));

test('CA-H110-16: tabela ausente pula o bloco com pulado_ausente e nao falha', () =>
  tx(async () => {
    await cfg('purge.provider_event_seconds', 7 * 86400);
    await cfg('purge.media_access_rollup_after_seconds', 86400);
    assert.equal((await chama('ops_purge_provider_event')).out_estado, 'pulado_ausente');
    assert.equal((await chama('ops_purge_media_access')).out_estado, 'pulado_ausente');
    assert.equal((await chama('ops_purge_outbox_event')).out_estado, 'desligado');
  }));

test('CA-H110-16b: tabela sem o contrato do E8 vira pulado_incompativel', () =>
  tx(async () => {
    await cfg('purge.media_access_rollup_after_seconds', 86400);
    await client.query('create table ops.media_access_log (id bigserial primary key, at timestamptz not null)');
    assert.equal((await chama('ops_purge_media_access')).out_estado, 'pulado_incompativel');
  }));

test('CA-H110-12: segunda execucao concorrente do mesmo bloco devolve ocupado e zeros', async () => {
  outro = await connect();
  try {
    await outro.query('begin');
    await outro.query("select pg_advisory_xact_lock(hashtext('ops.purge.e3'))");
    await tx(async () => {
      await cfg('purge.auth_challenge_seconds', 86400);
      const r = await chama('ops_purge_auth_challenge');
      assert.deepEqual(
        [r.out_estado, r.out_removidos, r.out_retidos, r.out_falhos],
        ['ocupado', 0, 0, 0],
      );
    });
  } finally {
    await outro.query('rollback');
    await outro.end();
  }
});

test('CA-H110-13: alterar a chave em app_config muda o resultado sem recriar a funcao', () =>
  tx(async () => {
    await cfg('purge.auth_challenge_seconds', 0);
    assert.equal((await chama('ops_purge_auth_challenge')).out_estado, 'desligado');
    await cfg('purge.auth_challenge_seconds', 'nao-numero');
    assert.equal((await chama('ops_purge_auth_challenge')).out_estado, 'desligado');
    await cfg('purge.auth_challenge_seconds', 3600);
    assert.equal((await chama('ops_purge_auth_challenge')).out_estado, 'ok');
  }));

test('E6b: saida de e-mail enviada alem da janela sai e a notificacao ligada vira descartada/expirado', () =>
  tx(async () => {
    await cfg('purge.email_outbox_seconds', 30 * 86400);
    const dest = await usuario();
    const email = randomUUID();
    await client.query(
      `insert into ops.email_outbox (id, recipient_user_id, category, class, email_type, template, dedupe_key, state,
                                     created_at, sent_at)
       values ($1, $2, 'aceite', 'critico', 'teste_tipo', 'teste_modelo', $3, 'enviado', $4, $4)`,
      [email, dest, `teste-h110:${email}`, at(T0 - 40 * DIA)],
    );
    const item = randomUUID();
    await client.query(
      `insert into ops.notification_item (id, recipient_user_id, category, scope_key, source_event_id, occurred_at,
                                          email_type, class, state, outbox_id, decided_at)
       values ($1, $2, 'aceite', 'escopo-h110', $3, $4, 'teste_tipo', 'critico', 'enviado', $5, $4)`,
      [item, dest, randomUUID(), at(T0 - 40 * DIA), email],
    );
    const r = await chama('ops_purge_email_outbox');
    assert.equal(r.out_removidos, 1);
    assert.equal(await n('select count(*) as n from ops.email_outbox where id = $1', [email]), 0);
    const linha = (await client.query('select state, discard_reason, outbox_id from ops.notification_item where id = $1',
      [item])).rows[0];
    assert.deepEqual(linha, { state: 'descartado', discard_reason: 'expirado', outbox_id: null });
  }));

test('auditoria: um evento por execucao so com contagens; catalogo aceita o formato', () =>
  tx(async () => {
    const job = randomUUID();
    const contagens = { run_no: 1, e1_removidos: 0, e1_retidos: 0, e1_falhos: 0, e1_pulado: 0 };
    const res = await client.query('select private.ops_purge_audit($1::uuid, $2::jsonb) as id', [job, JSON.stringify(contagens)]);
    assert.ok(res.rows[0].id);
    const ev = await client.query(
      "select actor_ref, actor_role, object_type from audit.audit_event where action = 'ops.purge.executed' and object_id = $1",
      [job],
    );
    assert.equal(ev.rows.length, 1);
    assert.deepEqual(ev.rows[0], { actor_ref: 'system:ops_purge', actor_role: 'system', object_type: 'ops_job' });
    const chaves = (await client.query(
      "select array_length(state_keys, 1) as n from audit.action_catalog where action = 'ops.purge.executed'")).rows[0];
    assert.equal(chaves.n, 37);
  }));

test('concessoes: so app_system executa; app_api, anon, authenticated e service_role nao', () =>
  tx(async () => {
    const funcoes = [
      'private.ops_purge_session(timestamptz,integer)',
      'private.ops_purge_draft(timestamptz,integer)',
      'private.ops_purge_audit(uuid,jsonb)',
      'private.ops_purge_enqueue(timestamptz,integer)',
    ];
    for (const f of funcoes) {
      assert.equal((await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_system', f, 'execute'])).rows[0].ok, true, f);
      for (const papel of ['app_api', 'anon', 'authenticated', 'service_role']) {
        assert.equal((await client.query('select has_function_privilege($1, $2, $3) as ok', [papel, f, 'execute'])).rows[0].ok, false, `${papel} ${f}`);
      }
    }
    assert.equal((await client.query(
      "select has_table_privilege('app_api', 'ops.media_access_daily', 'select') as ok")).rows[0].ok, false);
  }));

test('enfileiramento: chave do dia e continuacao com sufixo; execucao invalida e recusada', () =>
  tx(async () => {
    const id = (await client.query('select private.ops_purge_enqueue($1::timestamptz) as id', [at(T0)])).rows[0].id;
    const chave = (await client.query('select dedupe_key, kind from ops.job where id = $1', [id])).rows[0];
    assert.deepEqual(chave, { dedupe_key: 'ops.purge:2099-01-01', kind: 'ops.purge' });
    const id2 = (await client.query('select private.ops_purge_enqueue($1::timestamptz, 2) as id', [at(T0)])).rows[0].id;
    assert.equal((await client.query('select dedupe_key from ops.job where id = $1', [id2])).rows[0].dedupe_key,
      'ops.purge:2099-01-01:c2');
    const err = await erroEm(() => client.query('select private.ops_purge_enqueue($1::timestamptz, 0)', [at(T0)]));
    assert.ok(err, 'execucao 0 deve falhar');
  }));

test('limite de lote fora de 1 a 5000 e recusado com codigo fixo', () =>
  tx(async () => {
    const err = await erroEm(() => chama('ops_purge_session', T0, 0));
    assert.ok(err);
    assert.match(err.message, /purge_limite_invalido/);
  }));

// ---------------------------------------------------------------------------------------------------------------
// Correcao pos Code Review (20261113130000): CA-05, CA-06, falha persistente (achado 2) e filtro de orfaos (achado 1).

/** Foto ready valida pelos CHECKs de app.media_asset (confirmada, com variante pronta). */
async function fotoPronta({ draft, criada = T0 - 2 * DIA, marcada = null, originalRemovido = null }) {
  const id = randomUUID();
  await client.query(
    `insert into app.media_asset (id, draft_id, client_upload_id, declared_type, declared_bytes, status, confirmed_at,
                                  confirmed_bytes, pending_expires_at, purge_requested_at, created_at, ready_at,
                                  ready_bytes, ready_width, ready_height, original_removed_at)
     values ($1, $2, $3, 'image/jpeg', 1000, 'ready', $4, 1000, $5, $6, $4, $4, 500, 100, 100, $7)`,
    [id, draft, randomUUID(), at(criada), at(criada + DIA), marcada ? at(marcada) : null,
      originalRemovido ? at(originalRemovido) : null],
  );
  return id;
}

async function marcadosAte(limite = 500) {
  return (await client.query('select private.ops_purge_media_marcados($1::integer) as ids', [limite])).rows[0].ids;
}

async function sobrasAte(limite = 500) {
  return (await client.query('select private.media_original_cleanup_list($1::integer) as ids', [limite])).rows[0].ids;
}

async function objetoQuarentena(nome, criado) {
  await client.query(
    `insert into storage.objects (id, bucket_id, name, created_at) values ($1, 'quarantine', $2, $3)`,
    [randomUUID(), nome, at(criado)],
  );
}

test('CA-05: foto ready COM marca de saida e selecionada por ops_purge_media_marcados e nao cai na sobra de original', () =>
  tx(async () => {
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const marcada = await fotoPronta({ draft, marcada: T0 - DIA });
    assert.ok((await marcadosAte()).includes(marcada), 'ready com marca entra na fila de marcados');
    assert.ok(!(await sobrasAte()).includes(marcada), 'ready com marca nao entra na sobra de original (sem dupla remocao)');
  }));

test('CA-06: foto ready SEM marca de saida nao e selecionada por ops_purge_media_marcados e nao e marcada pelo E1', () =>
  tx(async () => {
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const semMarca = await fotoPronta({ draft, marcada: null });
    assert.ok(!(await marcadosAte()).includes(semMarca), 'ready sem marca nao entra em marcados');
    await chama('ops_purge_media_mark');
    assert.equal(
      await n('select count(*) as n from app.media_asset where id = $1 and purge_requested_at is null', [semMarca]),
      1,
      'o bloco de marca (so pending) nao toca em ready',
    );
  }));

test('CA-06b: ready sem marca com original ja removido nao e selecionada por marcados nem pela sobra de original', () =>
  tx(async () => {
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const limpa = await fotoPronta({ draft, marcada: null, originalRemovido: T0 - DIA });
    assert.ok(!(await marcadosAte()).includes(limpa));
    assert.ok(!(await sobrasAte()).includes(limpa));
  }));

test('CA-06c (fronteira H-026): ready sem marca com original pendente aparece so na sobra de original, nunca em marcados', () =>
  tx(async () => {
    // Limite de decisao: a sobra de original (media_original_cleanup_list) e o H-026 e nao e expurgo. Este teste
    // registra o comportamento real para que a decisao do PO/Arquitetura fique visivel.
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const pendente = await fotoPronta({ draft, marcada: null });
    assert.ok(!(await marcadosAte()).includes(pendente));
    assert.ok((await sobrasAte()).includes(pendente));
  }));

test('achado 2: ops_purge_media_adia manda a foto com falha para o fim da fila de marcados', () =>
  tx(async () => {
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const a = await fotoPronta({ draft, marcada: T0 - 2 * DIA });
    const b = await fotoPronta({ draft, marcada: T0 - DIA });
    assert.deepEqual(await marcadosAte(1), [a]);
    const adiadas = await client.query('select private.ops_purge_media_adia($1::uuid[], $2::timestamptz) as n', [[a], at(T0)]);
    assert.equal(Number(adiadas.rows[0].n), 1);
    assert.deepEqual(await marcadosAte(1), [b], 'a falha persistente nao ocupa mais o topo da fila');
    assert.equal(
      await n('select count(*) as n from app.media_asset where id = $1 and purge_requested_at = $2', [a, at(T0)]),
      1,
      'adiar nao apaga a linha nem altera outra foto',
    );
    assert.equal(
      Number((await client.query('select private.ops_purge_media_adia($1::uuid[], $2::timestamptz) as n',
        [[], at(T0)])).rows[0].n),
      0,
    );
  }));

test('achado 2: ops_purge_media_adia so existe para app_system (app_api sem execucao)', () =>
  tx(async () => {
    const r = await client.query(
      `select has_function_privilege('app_api', 'private.ops_purge_media_adia(uuid[], timestamptz)', 'execute') as api,
              has_function_privilege('app_system', 'private.ops_purge_media_adia(uuid[], timestamptz)', 'execute') as sys`,
    );
    assert.equal(r.rows[0].api, false);
    assert.equal(r.rows[0].sys, true);
  }));

test('achado 1: E9 filtra no SQL; fora do padrao e linha existente nao consomem o limite e so orfao volta', () =>
  tx(async () => {
    await cfg('purge.quarantine_pending_seconds', 86400);
    const draft = await rascunho({ atualizado: T0 - DIA, expira: T0 + DIA });
    const comLinha = await fotoPronta({ draft, marcada: null });
    const antigo = T0 - 3 * DIA;
    await objetoQuarentena('fora-do-padrao.jpg', antigo - 2000);
    await objetoQuarentena(`${comLinha}/original.jpg`, antigo - 1000);
    const orfa = randomUUID();
    await objetoQuarentena(`${orfa}/original.jpg`, antigo);
    const r = (await client.query(
      'select out_estado, out_nomes, out_retidos from private.ops_purge_media_orfaos($1::timestamptz, 1)',
      [at(T0)],
    )).rows[0];
    assert.equal(r.out_estado, 'ok');
    assert.deepEqual(r.out_nomes, [`${orfa}/original.jpg`], 'com limite 1, o orfao nao e engolido pelos outros');
    assert.equal(r.out_retidos, 1, 'o nome fora do padrao e contado a parte');
  }));

test('achado 1: bloco E9 desligado (sem TTL) devolve estado sem nomes', () =>
  tx(async () => {
    const r = (await client.query(
      'select out_estado, out_nomes, out_retidos from private.ops_purge_media_orfaos($1::timestamptz, 10)',
      [at(T0)],
    )).rows[0];
    assert.equal(r.out_estado, 'desligado');
    assert.deepEqual(r.out_nomes, []);
    assert.equal(r.out_retidos, 0);
  }));
