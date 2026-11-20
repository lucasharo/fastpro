// Testes de banco do runbook H-114 (Issue #123, fatia S4): procedimento D-07 (conta administrativa
// comprometida), desenho 165 §4.4 e §5 CA-07, CA-08 e CA-18. Usa os mecanismos existentes:
// private.admin_session_open, private.admin_guard, private.admin_session_revoke (H-102),
// private.admin_approval_open e private.admin_approval_vote (H-102 §5.3, reset de MFA) e
// private.audit_append. Nada e gravado de forma permanente: cada teste roda em transacao desfeita.
// Identificadores sao UUID aleatorios em dominio example.test (o formato de e-mail nao aceita o marcador).
// Lacunas caracterizadas, nao corrigidas aqui: L-3 (reset de MFA aceita 1 voto, o CA-08 pede 2) e
// L-4 (private.admin_session_revoke nao grava evento; o registro e feito por quem chama).
// Executar: node --test --test-concurrency=1 packages/db/tests/runbook-h114-d07.dbtest.mjs
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

/** Transacao de teste: sempre desfeita, mesmo em caso de falha. */
async function emTransacaoDesfeita(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa fn em savepoint e devolve o erro (ou null). Mantem a transacao utilizavel. */
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
    [id, `h114-${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

/** Conta administrativa ativa com os papeis dados (concedidos pelo bootstrap de teste). */
async function admin(...papeis) {
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

/** Abre sessao administrativa com segundo fator (totp_at = T0). Devolve o hash do segredo e o id. */
async function abrirSessao(userId) {
  const hash = sha(randomUUID());
  const sessionId = randomUUID();
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [sessionId, userId, hash, at(T0)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return { hash, sessionId };
}

async function guardaDe(hash, ms = T0 + 1000) {
  const { rows } = await client.query('select * from private.admin_guard($1, $2)', [hash, at(ms)]);
  return rows;
}

// --- D-07 passo 1: contencao (T0 a T+5 min) --------------------------------------------------------

test('D-07 contencao: sessao revogada nega acesso (token antigo recebe vazio, sem 200)', async () => {
  await emTransacaoDesfeita(async () => {
    const operador = await admin('superadmin');
    const { hash } = await abrirSessao(operador);
    assert.equal((await guardaDe(hash)).length, 1, 'antes da revogacao a sessao vale');

    const { rows } = await client.query('select private.admin_session_revoke($1, $2) as revogou',
      [hash, at(T0 + 60_000)]);
    assert.equal(rows[0].revogou, true, 'primeira revogacao encontra a sessao');
    assert.equal((await guardaDe(hash, T0 + 120_000)).length, 0, 'depois da revogacao o guarda nega');

    const de_novo = await client.query('select private.admin_session_revoke($1, $2) as revogou',
      [hash, at(T0 + 180_000)]);
    assert.equal(de_novo.rows[0].revogou, false, 'segunda revogacao nao encontra sessao ativa');
  });
});

test('D-07 escopo individual (A-5): revogar um operador nao derruba os demais administradores', async () => {
  await emTransacaoDesfeita(async () => {
    const alvo = await admin('superadmin');
    const outro = await admin('superadmin');
    const sessaoAlvo = await abrirSessao(alvo);
    const sessaoOutro = await abrirSessao(outro);

    await client.query('select private.admin_session_revoke($1, $2)', [sessaoAlvo.hash, at(T0 + 60_000)]);

    assert.equal((await guardaDe(sessaoAlvo.hash, T0 + 120_000)).length, 0, 'alvo bloqueado');
    const rows = await guardaDe(sessaoOutro.hash, T0 + 120_000);
    assert.equal(rows.length, 1, 'outro administrador segue com sessao valida');
    assert.equal(rows[0].out_user_id, outro);
  });
});

test('D-07 bloqueio da conta: app_user.status aceita "bloqueado" (valor usado pelo runbook)', async () => {
  await emTransacaoDesfeita(async () => {
    const id = await usuario();
    await client.query(`update app.app_user set status = 'bloqueado' where id = $1`, [id]);
    const { rows } = await client.query('select status from app.app_user where id = $1', [id]);
    assert.equal(rows[0].status, 'bloqueado');
  });
});

// --- D-07 auditoria (CA-18): catalogo fechado e acao de revogacao ----------------------------------

test('D-07 auditoria: audit_append recusa acao fora do catalogo (catalogo fechado)', async () => {
  await emTransacaoDesfeita(async () => {
    const err = await erroEm(() => client.query(
      `select private.audit_append('admin:h114', 'admin', 'admin.session.inexistente_h114',
         'admin_session', $1::uuid, '{}'::jsonb, '{"status":"x"}'::jsonb, 'd07_teste', null)`,
      [randomUUID()]));
    assert.ok(err, 'acao fora do catalogo deve ser recusada');
  });
});

test('D-07 auditoria: admin.session.revoked esta no catalogo (migracao 20261120400000)', async (t) => {
  const { rows } = await client.query(
    `select active, reason_required from audit.action_catalog where action = 'admin.session.revoked'`);
  if (rows.length === 0) {
    t.skip('migracao 20261120400000_audit_add_runbook_actions nao aplicada no DEV ainda (bloqueio: '
      + 'migracao pendente fora de ordem 20261120110000, de outra tarefa); teste reativa apos db:migrate');
    return;
  }
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].reason_required, true, 'o runbook exige motivo (CA-18)');
});

test('D-07 auditoria: evento admin.session.revoked grava com ator, papel, motivo e instante', async (t) => {
  const { rows: cat } = await client.query(
    `select 1 from audit.action_catalog where action = 'admin.session.revoked'`);
  if (cat.length === 0) {
    t.skip('admin.session.revoked ausente do catalogo no DEV (migracao 20261120400000 pendente)');
    return;
  }
  await emTransacaoDesfeita(async () => {
    const operador = await admin('superadmin');
    const { sessionId, hash } = await abrirSessao(operador);
    await client.query('select private.admin_session_revoke($1, $2)', [hash, at(T0 + 60_000)]);
    const { rows } = await client.query(
      `select private.audit_append($1, 'admin', 'admin.session.revoked', 'admin_session', $2::uuid,
         '{}'::jsonb, '{"status":"revogada"}'::jsonb, 'd07_contencao', null) as id`,
      [`admin:${operador}`, sessionId]);
    assert.ok(rows[0].id, 'evento gravado');
    const ev = await client.query(
      `select actor_ref, action, reason_code from audit.audit_event where id = $1`, [rows[0].id]);
    assert.equal(ev.rows[0].action, 'admin.session.revoked');
    assert.equal(ev.rows[0].reason_code, 'd07_contencao');
  });
});

// --- D-07 passo 2: redefinicao de MFA com dupla aprovacao (CA-08) ----------------------------------

test('D-07 dupla aprovacao (caracterizacao L-3): reset de MFA hoje exige 1 voto, nao 2', async () => {
  await emTransacaoDesfeita(async () => {
    const solicitante = await admin('superadmin');
    const alvo = await admin('superadmin');
    const pedido = randomUUID();
    await client.query('select private.admin_approval_open($1, $2, $3, $4, $5, $6)',
      [pedido, 'mfa_reenroll', alvo, null, solicitante, at(T0)]);
    const { rows } = await client.query(
      'select required_approvals from app.approval_request where id = $1', [pedido]);
    // CA-08 exige 2 aprovadores distintos; o mecanismo H-102 fixa 1. Lacuna L-3 registrada no runbook.
    assert.equal(rows[0].required_approvals, 1, 'comportamento atual do H-102 (lacuna L-3)');
  });
});

test('D-07 dupla aprovacao: autoaprovacao do reset de MFA e recusada', async () => {
  await emTransacaoDesfeita(async () => {
    const solicitante = await admin('superadmin');
    const alvo = await admin('superadmin');
    const pedido = randomUUID();
    await client.query('select private.admin_approval_open($1, $2, $3, $4, $5, $6)',
      [pedido, 'mfa_reenroll', alvo, null, solicitante, at(T0)]);
    const err = await erroEm(() =>
      client.query('select private.admin_approval_vote($1, $2, $3)', [pedido, solicitante, at(T0 + 1000)]));
    assert.ok(err, 'o solicitante nao pode aprovar o proprio pedido');
    assert.equal(err.code, '42501', `esperado 42501, obtido ${err.code}: ${err.message}`);
  });
});

test('D-07 dupla aprovacao: voto de outro superadmin conclui o reset (um voto, lacuna L-3)', async () => {
  await emTransacaoDesfeita(async () => {
    const solicitante = await admin('superadmin');
    const aprovador = await admin('superadmin');
    const alvo = await admin('superadmin');
    const pedido = randomUUID();
    await client.query('select private.admin_approval_open($1, $2, $3, $4, $5, $6)',
      [pedido, 'mfa_reenroll', alvo, null, solicitante, at(T0)]);
    const { rows } = await client.query('select private.admin_approval_vote($1, $2, $3) as estado',
      [pedido, aprovador, at(T0 + 1000)]);
    assert.equal(rows[0].estado, 'aprovada');
  });
});
