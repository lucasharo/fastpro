// H-102 | Testes de banco da conta administrativa, primeira migracao (T-H102-20 parcial, T-H102-25;
// desenho 54-DESENHO-H102 §1, §7). Banco de desenvolvimento. Cada teste roda em transacao e e
// desfeito (rollback). Valores sinteticos (@example.test; UUIDs gerados). Sem rede externa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';

let client;

before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const ZERO_HMAC = '0'.repeat(64);

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; usa savepoint para manter a transacao viva. */
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

async function usuario(email = `${randomUUID()}@example.test`) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, email, randomUUID()],
  );
  return { id, email };
}

/** Staff ativo com origem bootstrap (sem convidador), para servir de base aos testes. */
async function staffAtivo(status = 'ativo') {
  const u = await usuario();
  await client.query(
    `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                  created_at, status_changed_at)
     values ($1, $2, 'bootstrap', null, $3, now(), now())`,
    [u.id, status, status === 'ativo' ? new Date() : null],
  );
  return u;
}

// ---------------------------------------------------------------------------------------------
// T-H102-20 (parte da primeira migracao): RLS forcada e privilegios
// ---------------------------------------------------------------------------------------------

test('T-H102-20 RLS forcada e nenhum acesso de papeis publicos nas tabelas admin', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app'
         and c.relname in ('admin_staff', 'approval_request', 'approval_vote')`);
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname} com RLS`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname} com RLS forcada`);
    }

    const { rows: p } = await client.query(`
      select
        has_table_privilege('anon', 'app.admin_staff', 'select') as anon_select,
        has_table_privilege('authenticated', 'app.admin_staff', 'select') as auth_select,
        has_table_privilege('app_api', 'app.admin_staff', 'select') as api_select,
        has_table_privilege('app_system', 'app.admin_staff', 'insert') as system_insert,
        has_function_privilege('authenticated',
          'private.admin_email_is_reserved(text,text)', 'execute') as auth_exec,
        has_function_privilege('app_system',
          'private.admin_email_is_reserved(text,text)', 'execute') as system_exec`);
    assert.deepEqual(p[0], {
      anon_select: false,
      auth_select: false,
      api_select: false,
      system_insert: true,
      auth_exec: false,
      system_exec: true,
    });

    // Varredura de todos os papeis (mesmo criterio de T-H012-20): so o dono, app_system e os
    // leitores aceitos da plataforma tem acesso as tabelas novas. Superusuarios ficam de fora.
    const LEITORES_ACEITOS = [
      'app_backup_reader',
      'pg_read_all_data',
      'pg_write_all_data',
      'supabase_etl_admin',
      'supabase_read_only_user',
    ];
    for (const tabela of ['app.admin_staff', 'app.approval_request', 'app.approval_vote']) {
      const { rows: acesso } = await client.query(
        `select r.rolname
           from pg_roles r
          where not r.rolsuper
            and r.rolname <> 'app_system'
            and r.oid <> (select c.relowner from pg_class c where c.oid = $1::regclass)
            and (has_table_privilege(r.oid, $1, 'SELECT')
              or has_table_privilege(r.oid, $1, 'INSERT')
              or has_table_privilege(r.oid, $1, 'UPDATE')
              or has_table_privilege(r.oid, $1, 'DELETE'))`,
        [tabela],
      );
      const inesperados = acesso.map((r) => r.rolname).filter((n) => !LEITORES_ACEITOS.includes(n));
      assert.deepEqual(inesperados, [], `${tabela}: papeis com acesso indevido`);
    }
  }));

// ---------------------------------------------------------------------------------------------
// admin_staff: invariantes de origem, convite e MFA
// ---------------------------------------------------------------------------------------------

test('admin_staff: ativo exige TOTP confirmado; convite exige convidador; bootstrap nao tem', () =>
  tx(async () => {
    const u = await usuario();
    const sem = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'ativo', 'bootstrap', null, null, now(), now())`,
      [u.id],
    );
    assert.ok(sem, 'ativo sem mfa_enrolled_at deve falhar');

    const conv = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'convite', null, null, now(), now())`,
      [u.id],
    );
    assert.ok(conv, 'convite sem invited_by deve falhar');

    const boot = await staffAtivo();
    const u2 = await usuario();
    const bootComConvidador = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'bootstrap', $2, null, now(), now())`,
      [u2.id, boot.id],
    );
    assert.ok(bootComConvidador, 'bootstrap com invited_by deve falhar');

    const aSiMesmo = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'convite', $1, null, now(), now())`,
      [u.id],
    );
    assert.ok(aSiMesmo, 'convidar a si mesmo deve falhar');

    // Caminho valido: convite com convidador ativo e pendente de MFA.
    await client.query(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'convite', $2, null, now(), now())`,
      [u.id, boot.id],
    );
  }));

test('admin_staff: usuario sem linha admin nao e staff; sem app_user nao cria staff', () =>
  tx(async () => {
    const orfao = await falha(
      `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at,
                                    created_at, status_changed_at)
       values ($1, 'pendente_mfa', 'bootstrap', null, null, now(), now())`,
      [randomUUID()],
    );
    assert.ok(orfao, 'user_id sem app_user deve falhar (FK)');
  }));

// ---------------------------------------------------------------------------------------------
// approval_request e approval_vote: dupla aprovacao sem autoaprovacao
// ---------------------------------------------------------------------------------------------

/** Papel superadmin ativo (concedido pelo bootstrap, sem aprovacao), para os aprovadores. */
async function superadmin(userId) {
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at,
                                      approval_request_id)
     values (gen_random_uuid(), $1, 'superadmin', null, 'bootstrap', now(), null)`,
    [userId],
  );
}

async function pedido({ solicitante, alvo, status = 'pendente', consumedAt = null }) {
  const id = randomUUID();
  await client.query(
    `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                       required_approvals, status, created_at, expires_at,
                                       consumed_at)
     values ($1, 'papel_superadmin', $2, 'superadmin', $3, 1, $4,
             now(), now() + interval '24 hours', $5)`,
    [id, alvo, solicitante, status, consumedAt],
  );
  return id;
}

test('approval_request: validade exata de 24 h e solicitante diferente do alvo', () =>
  tx(async () => {
    const sol = await staffAtivo();
    const alvo = await staffAtivo();
    const curta = await falha(
      `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                         required_approvals, status, created_at, expires_at)
       values ($1, 'papel_superadmin', $2, 'superadmin', $3, 1, 'pendente',
               now(), now() + interval '23 hours')`,
      [randomUUID(), alvo.id, sol.id],
    );
    assert.ok(curta, 'validade diferente de 24 h deve falhar');

    const mesmo = await falha(
      `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                         required_approvals, status, created_at, expires_at)
       values ($1, 'papel_superadmin', $2, 'superadmin', $2, 1, 'pendente',
               now(), now() + interval '24 hours')`,
      [randomUUID(), alvo.id],
    );
    assert.ok(mesmo, 'solicitante igual ao alvo deve falhar');

    const semDetalhe = await falha(
      `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                         required_approvals, status, created_at, expires_at)
       values ($1, 'mfa_reenroll', $2, 'superadmin', $3, 1, 'pendente',
               now(), now() + interval '24 hours')`,
      [randomUUID(), alvo.id, sol.id],
    );
    assert.ok(semDetalhe, 'detail_code em mfa_reenroll deve falhar');

    const consumidaSemData = await falha(
      `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                         required_approvals, status, created_at, expires_at)
       values ($1, 'papel_superadmin', $2, 'superadmin', $3, 1, 'consumida',
               now(), now() + interval '24 hours')`,
      [randomUUID(), alvo.id, sol.id],
    );
    assert.ok(consumidaSemData, 'consumida sem consumed_at deve falhar');
  }));

test('approval_vote: autoaprovacao e aprovador inativo recusados; voto unico; so pendente', () =>
  tx(async () => {
    const sol = await staffAtivo();
    const alvo = await staffAtivo();
    const aprovador = await staffAtivo();
    await superadmin(aprovador.id);
    const desativado = await staffAtivo('desativado');
    const reqId = await pedido({ solicitante: sol.id, alvo: alvo.id });

    const porSolicitante = await falha(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), reqId, sol.id],
    );
    assert.equal(porSolicitante?.code, '42501');

    const peloAlvo = await falha(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), reqId, alvo.id],
    );
    assert.equal(peloAlvo?.code, '42501');

    const inativo = await falha(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), reqId, desativado.id],
    );
    assert.equal(inativo?.code, '42501');

    await client.query(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), reqId, aprovador.id],
    );

    const repetido = await falha(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), reqId, aprovador.id],
    );
    assert.equal(repetido?.code, '23505');

    const expirada = await pedido({ solicitante: sol.id, alvo: alvo.id, status: 'expirada' });
    const naoPendente = await falha(
      `insert into app.approval_vote (id, approval_request_id, approver_id, voted_at)
       values ($1, $2, $3, now())`,
      [randomUUID(), expirada, aprovador.id],
    );
    assert.equal(naoPendente?.code, '23514');
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-25 (parte): reserva de e-mail pela conta administrativa
// ---------------------------------------------------------------------------------------------

test('admin_email_is_reserved: verdadeira so para e-mail com conta administrativa', () =>
  tx(async () => {
    const staff = await staffAtivo();
    const cliente = await usuario();
    const { rows: [a] } = await client.query(
      'select private.admin_email_is_reserved($1, $2) as r',
      [staff.email, ZERO_HMAC],
    );
    assert.equal(a.r, true);
    const { rows: [b] } = await client.query(
      'select private.admin_email_is_reserved($1, $2) as r',
      [cliente.email, ZERO_HMAC],
    );
    assert.equal(b.r, false, 'cliente comum nao e reservado nesta migracao');
    const { rows: [c] } = await client.query(
      'select private.admin_email_is_reserved($1, $2) as r',
      [`${randomUUID()}@example.test`, ZERO_HMAC],
    );
    assert.equal(c.r, false);
    const { rows: [d] } = await client.query(
      'select private.admin_email_is_reserved($1, $2) as r',
      [null, ZERO_HMAC],
    );
    assert.equal(d.r, false);
  }));
