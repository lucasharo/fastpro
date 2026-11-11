// H-102 | Testes de banco de papeis, convite, sessao admin e dupla aprovacao (segunda migracao;
// desenho 54-DESENHO-H102 §1 a §5, §7: T-H102-20 a 26). Banco de desenvolvimento. Cada teste roda em
// transacao e e desfeito (rollback). Valores sinteticos (@example.test). Sem rede. Sem envio de e-mail.
// NAO COBERTO AQUI: concorrencia real com varias conexoes (T-H102-23 parte 2) - ver relatorio.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
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
const iso = (d) => d.toISOString();
const NOW = new Date();
const horas = (h, base = NOW) => new Date(base.getTime() + h * 3600e3);

async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa um comando que deve falhar; savepoint mantem a transacao viva. Devolve o erro. */
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

/** Conta admin ativa (origem bootstrap, sem convidador). Sem papel: o teste concede o que precisar. */
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

/** Papel ativo sem aprovacao (bootstrap). Para superadmin, so usado como preparo de teste. */
async function papel(userId, role) {
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at,
                                      approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [userId, role],
  );
}

async function superadmin() {
  const u = await staffAtivo();
  await papel(u.id, 'superadmin');
  return u;
}

async function papeisAtivos(userId) {
  const { rows } = await client.query(
    `select role_code from app.admin_user_role where user_id = $1 and revoked_at is null
      order by role_code`,
    [userId],
  );
  return rows.map((r) => r.role_code);
}

/** Emite convite de ativacao por um Superadmin (ou bootstrap se invitedBy for nulo). */
async function emitirConvite({ invitedBy, email, roles = ['auditor'], approval = null, now = NOW, mode = null }) {
  const id = randomUUID();
  const segmento = randomBytes(32).toString('hex');
  const hmac = sha(`hmac:${email}`);
  await client.query(
    `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, email, hmac, Buffer.from('enc-sintetico'), sha(segmento), roles, invitedBy, approval, mode, iso(now)],
  );
  return { id, token: segmento, hmac, email };
}

async function convite(token) {
  const { rows } = await client.query(
    `select state, user_id, attempts, email_enc from app.admin_invite where token_hash = $1`,
    [sha(token)],
  );
  return rows[0];
}

/** Aprovacao de papel superadmin aprovada, solicitada por requester para o alvo (ou sem alvo). */
async function aprovacaoSuperadmin(requester, alvo = null, now = NOW) {
  const id = randomUUID();
  await client.query(
    `select private.admin_approval_open($1, 'papel_superadmin', $2, 'superadmin', $3, $4)`,
    [id, alvo, requester, iso(now)],
  );
  const aprovador = await superadmin();
  const { rows } = await client.query(
    `select private.admin_approval_vote($1, $2, $3) as estado`,
    [id, aprovador.id, iso(now)],
  );
  return { id, estado: rows[0].estado };
}

// ---------------------------------------------------------------------------------------------
// T-H102-20 (resto): postura de acesso das tabelas e funcoes novas
// ---------------------------------------------------------------------------------------------

test('T-H102-20 RLS forcada e acesso so de app_system nas tabelas e funcoes de papel/convite/sessao', () =>
  tx(async () => {
    const tabelas = ['admin_role', 'admin_permission', 'admin_role_permission', 'admin_user_role',
      'admin_invite', 'admin_session'];
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = any($1)`, [tabelas]);
    assert.equal(rows.length, tabelas.length);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname} com RLS`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname} com RLS forcada`);
    }

    const { rows: p } = await client.query(`
      select
        has_table_privilege('anon', 'app.admin_invite', 'select') as anon_select,
        has_table_privilege('authenticated', 'app.admin_user_role', 'select') as auth_select,
        has_table_privilege('app_api', 'app.admin_session', 'select') as api_select,
        has_table_privilege('app_system', 'app.admin_invite', 'insert') as system_insert,
        has_function_privilege('app_api', 'private.admin_guard(text,timestamptz)', 'execute') as api_guard,
        has_function_privilege('authenticated', 'private.admin_role_grant(uuid,uuid,text,uuid,timestamptz)', 'execute') as auth_grant,
        has_function_privilege('app_system', 'private.admin_guard(text,timestamptz)', 'execute') as system_guard,
        has_function_privilege('app_system', 'private.admin_has_permission(uuid,text)', 'execute') as system_has`);
    assert.deepEqual(p[0], {
      anon_select: false,
      auth_select: false,
      api_select: false,
      system_insert: true,
      api_guard: false,
      auth_grant: false,
      system_guard: true,
      system_has: false,
    });

    // Varredura de papeis (criterio de T-H012-20): nenhum papel fora da lista aceita le ou escreve.
    const LEITORES_ACEITOS = ['app_backup_reader', 'pg_read_all_data', 'pg_write_all_data',
      'supabase_etl_admin', 'supabase_read_only_user'];
    for (const t of ['app.admin_invite', 'app.admin_user_role', 'app.admin_session']) {
      const { rows: acesso } = await client.query(
        `select r.rolname
           from pg_roles r
          where not r.rolsuper and r.rolname <> 'app_system'
            and r.oid <> (select c.relowner from pg_class c where c.oid = $1::regclass)
            and (has_table_privilege(r.oid, $1, 'SELECT') or has_table_privilege(r.oid, $1, 'INSERT')
              or has_table_privilege(r.oid, $1, 'UPDATE') or has_table_privilege(r.oid, $1, 'DELETE'))`,
        [t],
      );
      assert.deepEqual(acesso.map((r) => r.rolname).filter((n) => !LEITORES_ACEITOS.includes(n)), [],
        `${t}: papeis com acesso indevido`);
    }
  }));

// ---------------------------------------------------------------------------------------------
// Mapa papel x permissao (54 §1): segregacao. Superadmin nao herda as demais permissoes.
// ---------------------------------------------------------------------------------------------

test('mapa de papeis: auditor le auditoria, nao aprova estorno; superadmin so gere papeis e catalogo', () =>
  tx(async () => {
    const f = async (papelCodigo, permissao) => {
      const { rows: [r] } = await client.query(
        `select exists (
           select 1 from app.admin_role_permission rp
            where rp.role_code = $1 and rp.permission_code = $2) as tem`,
        [papelCodigo, permissao]);
      return r.tem;
    };
    assert.equal(await f('auditor', 'audit.read'), true);
    assert.equal(await f('auditor', 'finance.refund.approve'), false);
    assert.equal(await f('superadmin', 'admin.role.manage'), true);
    assert.equal(await f('superadmin', 'finance.refund.approve'), false);
    assert.equal(await f('financeiro', 'finance.refund.approve'), true);

    const u = await staffAtivo();
    await papel(u.id, 'auditor');
    const { rows: [h] } = await client.query(
      'select private.admin_has_permission($1, $2) as ok', [u.id, 'finance.refund.approve']);
    assert.equal(h.ok, false);
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-21: concessao e revogacao com auditoria na mesma transacao
// ---------------------------------------------------------------------------------------------

test('T-H102-21 concessao audita na mesma transacao; falha da auditoria desfaz o papel', () =>
  tx(async () => {
    const ator = await superadmin();
    const alvo = await staffAtivo();
    const id = (await client.query(
      'select private.admin_role_grant($1, $2, $3, null, $4) as id',
      [ator.id, alvo.id, 'auditor', iso(NOW)])).rows[0].id;
    assert.ok(id);
    assert.deepEqual(await papeisAtivos(alvo.id), ['auditor']);

    const { rows: ev } = await client.query(
      `select action, object_type, actor_ref, before_state, after_state
         from audit.audit_event where object_id = $1 and action = 'admin.role.granted'`, [alvo.id]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].object_type, 'admin_staff');
    assert.equal(ev[0].actor_ref, `admin:${ator.id}`);
    assert.deepEqual(ev[0].after_state, { status: 'ativo', role_code: 'auditor' });

    // Falha forcada da auditoria: acao inativa no catalogo. A concessao inteira e desfeita.
    await client.query(`update audit.action_catalog set active = false where action = 'admin.role.granted'`);
    const alvo2 = await staffAtivo();
    const err = await falha('select private.admin_role_grant($1, $2, $3, null, $4)',
      [ator.id, alvo2.id, 'suporte', iso(NOW)]);
    assert.ok(err, 'auditoria inativa deve falhar');
    assert.deepEqual(await papeisAtivos(alvo2.id), []);
    const { rows: [n] } = await client.query(
      `select count(*)::int as n from app.admin_user_role where user_id = $1`, [alvo2.id]);
    assert.equal(n.n, 0, 'nenhuma linha de papel gravada');
  }));

test('T-H102-21 evento de auditoria nao muda nem se apaga (UPDATE e DELETE negados)', () =>
  tx(async () => {
    const ator = await superadmin();
    const alvo = await staffAtivo();
    await client.query('select private.admin_role_grant($1, $2, $3, null, $4)',
      [ator.id, alvo.id, 'auditor', iso(NOW)]);
    const up = await falha(`update audit.audit_event set action = action where object_id = $1`, [alvo.id]);
    assert.ok(up, 'UPDATE em audit_event deve ser negado');
    const del = await falha(`delete from audit.audit_event where object_id = $1`, [alvo.id]);
    assert.ok(del, 'DELETE em audit_event deve ser negado');
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-06: autoconcessao, aprovacao dupla e reuso
// ---------------------------------------------------------------------------------------------

test('T-H102-06 autoconcessao negada (ADM01); papel sem permissao nao concede (42501)', () =>
  tx(async () => {
    const ator = await superadmin();
    const aud = await staffAtivo();
    await papel(aud.id, 'auditor');
    const auto = await falha('select private.admin_role_grant($1, $1, $2, null, $3)',
      [ator.id, 'auditor', iso(NOW)]);
    assert.equal(auto?.code, 'ADM01');

    const semPermissao = await falha('select private.admin_role_grant($1, $2, $3, null, $4)',
      [aud.id, ator.id, 'auditor', iso(NOW)]);
    assert.equal(semPermissao?.code, '42501');

    await client.query('select private.admin_self_grant_denied_record($1, $2)', [aud.id, 'superadmin']);
    const { rows } = await client.query(
      `select count(*)::int as n from audit.audit_event
        where action = 'admin.role.self_grant_denied' and object_id = $1`, [aud.id]);
    assert.equal(rows[0].n, 1);
  }));

test('T-H102-06 concessao de superadmin exige aprovacao aprovada, do solicitante e de uso unico', () =>
  tx(async () => {
    const solicitante = await superadmin();
    const alvo = await staffAtivo();
    const reqId = randomUUID();
    await client.query(
      `select private.admin_approval_open($1, 'papel_superadmin', $2, 'superadmin', $3, $4)`,
      [reqId, alvo.id, solicitante.id, iso(NOW)]);

    // Ainda pendente: nao serve.
    const pendente = await falha('select private.admin_role_grant($1, $2, $3, $4, $5)',
      [solicitante.id, alvo.id, 'superadmin', reqId, iso(NOW)]);
    assert.equal(pendente?.code, 'ADM03');

    // Aprovador (outro superadmin) vota: vira aprovada.
    const aprovador = await superadmin();
    const { rows: [v] } = await client.query(
      'select private.admin_approval_vote($1, $2, $3) as estado', [reqId, aprovador.id, iso(NOW)]);
    assert.equal(v.estado, 'aprovada');

    // Outro solicitante nao pode usar a aprovacao.
    const outro = await superadmin();
    const deOutro = await falha('select private.admin_role_grant($1, $2, $3, $4, $5)',
      [outro.id, alvo.id, 'superadmin', reqId, iso(NOW)]);
    assert.equal(deOutro?.code, 'ADM03');

    await client.query('select private.admin_role_grant($1, $2, $3, $4, $5)',
      [solicitante.id, alvo.id, 'superadmin', reqId, iso(NOW)]);
    assert.ok((await papeisAtivos(alvo.id)).includes('superadmin'));

    // Uso unico: segunda concessao com a mesma aprovacao e recusada.
    const outroAlvo = await staffAtivo();
    const reuso = await falha('select private.admin_role_grant($1, $2, $3, $4, $5)',
      [solicitante.id, outroAlvo.id, 'superadmin', reqId, iso(NOW)]);
    assert.equal(reuso?.code, 'ADM03');
  }));

test('T-H102-06 aprovacao: autoaprovacao e aprovador sem superadmin recusados; vencida vira expirada', () =>
  tx(async () => {
    const solicitante = await superadmin();
    const alvo = await staffAtivo();
    const reqId = randomUUID();
    await client.query(
      `select private.admin_approval_open($1, 'papel_superadmin', $2, 'superadmin', $3, $4)`,
      [reqId, alvo.id, solicitante.id, iso(NOW)]);

    const autoVoto = await falha('select private.admin_approval_vote($1, $2, $3)',
      [reqId, solicitante.id, iso(NOW)]);
    assert.equal(autoVoto?.code, '42501');

    const naoSuper = await staffAtivo();
    await papel(naoSuper.id, 'moderador');
    const semSuper = await falha('select private.admin_approval_vote($1, $2, $3)',
      [reqId, naoSuper.id, iso(NOW)]);
    assert.equal(semSuper?.code, '42501');

    // Pedido vencido (aberto ha 25 h): o voto devolve 'expirada' e nao aprova.
    const velha = randomUUID();
    await client.query(
      `select private.admin_approval_open($1, 'papel_superadmin', $2, 'superadmin', $3, $4)`,
      [velha, alvo.id, solicitante.id, iso(horas(-25))]);
    const { rows: [e] } = await client.query(
      'select private.admin_approval_vote($1, $2, $3) as estado', [velha, (await superadmin()).id, iso(NOW)]);
    assert.equal(e.estado, 'expirada');
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-22: revogacao vale na proxima guarda; nao revoga o ultimo Superadmin
// ---------------------------------------------------------------------------------------------

test('T-H102-22 revogacao tem efeito na proxima guarda; ultimo Superadmin nao sai (ADM02)', () =>
  tx(async () => {
    const a = await superadmin();
    const b = await superadmin();
    const alvo = await staffAtivo();
    await papel(alvo.id, 'auditor');
    const segredo = sha(`segredo:${randomUUID()}`);
    const sid = randomUUID();
    const aberta = (await client.query(
      'select private.admin_session_open($1, $2, $3, $4) as ok', [sid, alvo.id, segredo, iso(NOW)])).rows[0].ok;
    assert.equal(aberta, true);

    const antes = (await client.query(
      'select out_permissions from private.admin_guard($1, $2)', [segredo, iso(NOW)])).rows;
    assert.equal(antes.length, 1);
    assert.ok(antes[0].out_permissions.includes('audit.read'));

    const ok = (await client.query(
      'select private.admin_role_revoke($1, $2, $3, $4) as ok', [a.id, alvo.id, 'auditor', iso(NOW)])).rows[0].ok;
    assert.equal(ok, true);
    const depois = (await client.query(
      'select out_user_id from private.admin_guard($1, $2)', [segredo, iso(NOW)])).rows;
    assert.equal(depois.length, 0, 'sem papel ativo a guarda nao devolve nada (404 na API)');

    // Revogar o Superadmin 'b' com dois ativos e permitido; o que sobra e o ultimo.
    await client.query('select private.admin_role_revoke($1, $2, $3, $4)', [a.id, b.id, 'superadmin', iso(NOW)]);
    const ultimo = await falha('select private.admin_role_revoke($1, $2, $3, $4)',
      [a.id, a.id, 'superadmin', iso(NOW)]);
    assert.equal(ultimo?.code, 'ADM02');
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-24: sessao admin de 8 h absolutas e aal2 obrigatorio
// ---------------------------------------------------------------------------------------------

test('T-H102-24 sessao: 8 h absolutas, aal2 obrigatorio, sem conta ativa ou papel nao abre', () =>
  tx(async () => {
    const semPapel = await staffAtivo();
    const naoAbre = (await client.query(
      'select private.admin_session_open($1, $2, $3, $4) as ok',
      [randomUUID(), semPapel.id, sha('x'), iso(NOW)])).rows[0].ok;
    assert.equal(naoAbre, false);

    const pendente = await staffAtivo('pendente_mfa');
    await papel(pendente.id, 'auditor');
    const pendenteNaoAbre = (await client.query(
      'select private.admin_session_open($1, $2, $3, $4) as ok',
      [randomUUID(), pendente.id, sha('y'), iso(NOW)])).rows[0].ok;
    assert.equal(pendenteNaoAbre, false);

    const u = await staffAtivo();
    await papel(u.id, 'auditor');
    const sid = randomUUID();
    await client.query('select private.admin_session_open($1, $2, $3, $4)', [sid, u.id, sha('z'), iso(NOW)]);
    const { rows: [s] } = await client.query(
      `select extract(epoch from (expires_at - created_at))::int as dur from app.admin_session where id = $1`, [sid]);
    assert.equal(s.dur, 8 * 3600);

    const semAal2 = await falha(
      `insert into app.admin_session (id, user_id, secret_hash, aal2_at, created_at, expires_at)
       values ($1, $2, $3, null, now(), now() + interval '8 hours')`, [randomUUID(), u.id, sha('w')]);
    assert.equal(semAal2?.code, '23502', 'aal2_at nao nulo');

    const prazoErrado = await falha(
      `insert into app.admin_session (id, user_id, secret_hash, aal2_at, created_at, expires_at)
       values ($1, $2, $3, now(), now(), now() + interval '9 hours')`, [randomUUID(), u.id, sha('v')]);
    assert.equal(prazoErrado?.code, '23514', 'expires_at fora de 8 h');
  }));

test('T-H102-24 guarda nao devolve sessao vencida nem sessao revogada', () =>
  tx(async () => {
    const u = await staffAtivo();
    await papel(u.id, 'auditor');
    const seg = sha(`seg:${randomUUID()}`);
    // Aberta ha 9 h: ja venceu.
    await client.query('select private.admin_session_open($1, $2, $3, $4)',
      [randomUUID(), u.id, seg, iso(horas(-9))]);
    const vencida = (await client.query(
      'select out_user_id from private.admin_guard($1, $2)', [seg, iso(NOW)])).rows;
    assert.equal(vencida.length, 0);

    const seg2 = sha(`seg2:${randomUUID()}`);
    await client.query('select private.admin_session_open($1, $2, $3, $4)',
      [randomUUID(), u.id, seg2, iso(NOW)]);
    await client.query('select private.admin_session_revoke($1, $2)', [seg2, iso(NOW)]);
    const revogada = (await client.query(
      'select out_user_id from private.admin_guard($1, $2)', [seg2, iso(NOW)])).rows;
    assert.equal(revogada.length, 0);
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-23 (parte transacional): reemissao invalida o anterior; um convite vivo por e-mail
// ---------------------------------------------------------------------------------------------

test('T-H102-23 reemissao invalida o convite anterior; um convite vivo por e-mail; e-mail de conta recusado', () =>
  tx(async () => {
    const admin = await superadmin();
    const email = `${randomUUID()}@example.test`;
    const c1 = await emitirConvite({ invitedBy: admin.id, email });
    const c2 = await emitirConvite({ invitedBy: admin.id, email });

    assert.equal((await convite(c1.token)).state, 'invalidado');
    assert.equal((await convite(c1.token)).email_enc, null, 'e-mail cifrado apagado ao invalidar');
    assert.equal((await convite(c2.token)).state, 'emitido');

    const dois = await falha(
      `insert into app.admin_invite (id, kind, email_hmac, email_enc, token_hash, role_codes, invited_by,
                                     approval_request_id, state, attempts, user_id, created_at,
                                     expires_at, used_at)
       values ($1, 'ativacao', $2, $3, $4, '{auditor}', $5, null, 'emitido', 0, null, now(),
               now() + interval '72 hours', null)`,
      [randomUUID(), c2.hmac, Buffer.from('x'), sha(randomUUID()), admin.id]);
    assert.equal(dois?.code, '23505', 'segundo convite vivo para o mesmo e-mail');

    const cliente = await usuario();
    const recusado = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{auditor}', $6, null, null, now())`,
      [randomUUID(), cliente.email, sha(`hmac:${cliente.email}`), Buffer.from('e'), sha(randomUUID()), admin.id]);
    assert.equal(recusado?.code, 'ADM06', 'e-mail com conta recusa convite');
  }));

test('T-H102-23 convite de superadmin sem aprovacao aprovada, ou com ela reusada, e recusado', () =>
  tx(async () => {
    const admin = await superadmin();
    const semAprov = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{superadmin}', $6, null, null, now())`,
      [randomUUID(), `${randomUUID()}@example.test`, sha(randomUUID()), Buffer.from('e'), sha(randomUUID()), admin.id]);
    assert.equal(semAprov?.code, 'ADM03');

    const aprov = await aprovacaoSuperadmin(admin.id);
    assert.equal(aprov.estado, 'aprovada');
    const email = `${randomUUID()}@example.test`;
    await emitirConvite({ invitedBy: admin.id, email, roles: ['superadmin'], approval: aprov.id });
    const reuso = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{superadmin}', $6, $7, null, now())`,
      [randomUUID(), `${randomUUID()}@example.test`, sha(randomUUID()), Buffer.from('e'), sha(randomUUID()), admin.id, aprov.id]);
    assert.equal(reuso?.code, 'ADM03');
  }));

// ---------------------------------------------------------------------------------------------
// T-H102-25: reserva de e-mail com convite vivo e com conta administrativa
// ---------------------------------------------------------------------------------------------

test('T-H102-25 admin_email_is_reserved: conta admin e convite vivo reservam; e-mail livre nao reserva', () =>
  tx(async () => {
    const admin = await superadmin();
    const email = `${randomUUID()}@example.test`;
    const c = await emitirConvite({ invitedBy: admin.id, email });
    const reservado = async (mail, hmac) => (await client.query(
      'select private.admin_email_is_reserved($1, $2) as r', [mail, hmac])).rows[0].r;

    assert.equal(await reservado(email, c.hmac), true, 'convite vivo reserva o e-mail');
    assert.equal(await reservado(`x${randomUUID()}@example.test`, sha('nada')), false);

    const staffEmail = (await staffAtivo()).email;
    assert.equal(await reservado(staffEmail, sha('nada')), true, 'conta admin reserva o e-mail');

    // Convite invalidado (por reemissao) deixa de reservar quando nao ha conta.
    await emitirConvite({ invitedBy: admin.id, email });
    const { rows: [cont] } = await client.query(
      'select count(*)::int as n from app.admin_invite where email_hmac = $1 and state = $2', [c.hmac, 'invalidado']);
    assert.equal(cont.n, 1);
  }));

// ---------------------------------------------------------------------------------------------
// Ativacao (54 §2) e varredura de dado pessoal (T-H102-26)
// ---------------------------------------------------------------------------------------------

test('T-H102-02 DB: passo 1 cria conta pendente; 5 codigos errados invalidam; passo 2 ativa com papel do convite', () =>
  tx(async () => {
    const admin = await superadmin();

    // Convite A: cinco codigos errados.
    const emailA = `${randomUUID()}@example.test`;
    const a = await emitirConvite({ invitedBy: admin.id, email: emailA });
    const contaA = await usuario(emailA);
    assert.equal((await client.query('select private.admin_invite_mark_waiting($1, $2, $3) as ok',
      [sha(a.token), contaA.id, iso(NOW)])).rows[0].ok, true);
    assert.equal((await convite(a.token)).state, 'aguardando_totp');
    let tent = null;
    for (let i = 0; i < 5; i++) {
      tent = (await client.query('select private.admin_invite_record_code_failure($1, $2) as n',
        [sha(a.token), iso(NOW)])).rows[0].n;
    }
    assert.equal(tent, 5);
    assert.equal((await convite(a.token)).state, 'invalidado');
    const aposInvalidar = (await client.query('select private.admin_invite_activate($1, $2) as u',
      [sha(a.token), iso(NOW)])).rows[0].u;
    assert.equal(aposInvalidar, null);

    // Convite B: sucesso. Papel do convite, convite usado, e-mail cifrado apagado, sem sessao.
    const emailB = `${randomUUID()}@example.test`;
    const b = await emitirConvite({ invitedBy: admin.id, email: emailB, roles: ['auditor', 'financeiro'] });
    const contaB = await usuario(emailB);
    await client.query('select private.admin_invite_mark_waiting($1, $2, $3)', [sha(b.token), contaB.id, iso(NOW)]);
    const uid = (await client.query('select private.admin_invite_activate($1, $2) as u',
      [sha(b.token), iso(NOW)])).rows[0].u;
    assert.equal(uid, contaB.id);
    const { rows: [st] } = await client.query(
      'select status, mfa_enrolled_at is not null as mfa from app.admin_staff where user_id = $1', [contaB.id]);
    assert.deepEqual(st, { status: 'ativo', mfa: true });
    assert.deepEqual(await papeisAtivos(contaB.id), ['auditor', 'financeiro']);
    const inv = await convite(b.token);
    assert.equal(inv.state, 'usado');
    assert.equal(inv.email_enc, null);
    const { rows: [sess] } = await client.query(
      'select count(*)::int as n from app.admin_session where user_id = $1', [contaB.id]);
    assert.equal(sess.n, 0, 'ativar nao abre sessao');
    const { rows: [usado] } = await client.query(
      'select private.admin_invite_activate($1, $2) as u', [sha(b.token), iso(NOW)]);
    assert.equal(usado.u, null, 'convite gasto nao ativa de novo');
  }));

test('T-H102-26 varredura: e-mail em claro nao aparece em staff, papel, convite, sessao ou auditoria', () =>
  tx(async () => {
    const admin = await superadmin();
    const email = `sentinela-${randomUUID()}@example.test`;
    const c = await emitirConvite({ invitedBy: admin.id, email, roles: ['auditor'] });
    const conta = await usuario(email);
    await client.query('select private.admin_invite_mark_waiting($1, $2, $3)', [sha(c.token), conta.id, iso(NOW)]);
    await client.query('select private.admin_invite_activate($1, $2)', [sha(c.token), iso(NOW)]);

    const { rows } = await client.query(`
      select to_jsonb(s)::text as t from app.admin_staff s where s.user_id = $1
      union all select to_jsonb(r)::text from app.admin_user_role r where r.user_id = $1
      union all select to_jsonb(i)::text from app.admin_invite i where i.user_id = $1
      union all select to_jsonb(e)::text from audit.audit_event e where e.object_id = $1
                                                                    or e.actor_ref = 'admin:' || $1::text`,
      [conta.id]);
    assert.ok(rows.length >= 3);
    for (const r of rows) assert.equal(r.t.includes(email), false, 'e-mail em claro fora de app_user');
  }));

// ---------------------------------------------------------------------------------------------
// Bootstrap (54 §6): recusas deterministicas
// ---------------------------------------------------------------------------------------------

test('bootstrap: continuidade sem exatamente um Superadmin ativo e recusada (ADM10); primeiro com zero ativo aceito', () =>
  tx(async () => {
    const { rows: [n] } = await client.query(
      `select count(distinct r.user_id)::int as n from app.admin_user_role r
         join app.admin_staff s on s.user_id = r.user_id and s.status = 'ativo'
        where r.role_code = 'superadmin' and r.revoked_at is null`);
    assert.equal(n.n, 0, 'precondicao: base de desenvolvimento sem Superadmin ativo');

    const email = `${randomUUID()}@example.test`;
    const cont = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{superadmin}', null, null, 'continuidade', now())`,
      [randomUUID(), email, sha(`hmac:${email}`), Buffer.from('e'), sha(randomUUID())]);
    assert.equal(cont?.code, 'ADM10');

    const ok = await emitirConvite({ invitedBy: null, email, roles: ['superadmin'], mode: 'primeiro' });
    assert.equal((await convite(ok.token)).state, 'emitido');
    const { rows: [ev] } = await client.query(
      `select actor_ref, actor_role from audit.audit_event where action = 'admin.bootstrap.invite_issued'
         and object_id = $1`, [ok.id]);
    assert.deepEqual(ev, { actor_ref: 'system:bootstrap', actor_role: 'system' });

    const outro = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{superadmin}', null, null, 'primeiro', now())`,
      [randomUUID(), `${randomUUID()}@example.test`, sha(randomUUID()), Buffer.from('e'), sha(randomUUID())]);
    assert.equal(outro?.code, 'ADM10', 'segundo convite de bootstrap vivo e recusado');
  }));

// ---------------------------------------------------------------------------------------------
// Guarda (54 §3): papeis e permissoes lidos do banco a cada chamada
// ---------------------------------------------------------------------------------------------

test('guarda: devolve papeis e permissoes do banco; conta pendente ou sem papel nao passa', () =>
  tx(async () => {
    const u = await staffAtivo();
    await papel(u.id, 'financeiro');
    const seg = sha(`g:${randomUUID()}`);
    await client.query('select private.admin_session_open($1, $2, $3, $4)', [randomUUID(), u.id, seg, iso(NOW)]);
    const { rows: [g] } = await client.query(
      'select out_roles, out_permissions from private.admin_guard($1, $2)', [seg, iso(NOW)]);
    assert.deepEqual(g.out_roles, ['financeiro']);
    assert.ok(g.out_permissions.includes('finance.refund.approve'));

    await client.query(
      `update app.admin_staff set status = 'desativado', status_changed_at = now() where user_id = $1`, [u.id]);
    const desativado = (await client.query(
      'select out_user_id from private.admin_guard($1, $2)', [seg, iso(NOW)])).rows;
    assert.equal(desativado.length, 0, 'conta desativada nao passa na proxima requisicao');
  }));

// ---------------------------------------------------------------------------------------------
// Revisao da #111: app_system nao apaga linhas de papel, convite e sessao; o expurgo e so pela funcao.
// ---------------------------------------------------------------------------------------------

test('T-H102-20 app_system sem DELETE em admin_user_role, admin_invite e admin_session; com SELECT, INSERT e UPDATE', () =>
  tx(async () => {
    const { rows } = await client.query(`
      select
        has_table_privilege('app_system', 'app.admin_user_role', 'delete') as role_delete,
        has_table_privilege('app_system', 'app.admin_invite', 'delete') as invite_delete,
        has_table_privilege('app_system', 'app.admin_session', 'delete') as session_delete,
        has_table_privilege('app_system', 'app.admin_user_role', 'select') as role_select,
        has_table_privilege('app_system', 'app.admin_invite', 'update') as invite_update,
        has_table_privilege('app_system', 'app.admin_session', 'insert') as session_insert`);
    assert.deepEqual(rows[0], {
      role_delete: false,
      invite_delete: false,
      session_delete: false,
      role_select: true,
      invite_update: true,
      session_insert: true,
    });
  }));

test('T-H102-20 expurgo de sessao vencida so pela funcao private.admin_session_purge', () =>
  tx(async () => {
    const u = await staffAtivo();
    await papel(u.id, 'auditor');
    const seg = sha(`purga:${randomUUID()}`);
    await client.query('select private.admin_session_open($1, $2, $3, $4)',
      [randomUUID(), u.id, seg, iso(horas(-9))]);
    const { rows: [r] } = await client.query('select private.admin_session_purge($1) as n', [iso(NOW)]);
    assert.ok(r.n >= 1, 'a funcao remove a sessao vencida');
    const { rows: [left] } = await client.query(
      'select count(*)::int as n from app.admin_session where secret_hash = $1', [seg]);
    assert.equal(left.n, 0);
  }));

test('bootstrap continuidade: com um Superadmin ativo aceita o segundo; um terceiro convite vivo e recusado (ADM10)', () =>
  tx(async () => {
    const { rows: [n] } = await client.query(
      `select count(distinct r.user_id)::int as n from app.admin_user_role r
         join app.admin_staff s on s.user_id = r.user_id and s.status = 'ativo'
        where r.role_code = 'superadmin' and r.revoked_at is null`);
    assert.equal(n.n, 0, 'precondicao: base de desenvolvimento sem Superadmin ativo');

    await superadmin();
    const emailDois = `${randomUUID()}@example.test`;
    const ok = await emitirConvite({ invitedBy: null, email: emailDois, roles: ['superadmin'], mode: 'continuidade' });
    assert.equal((await convite(ok.token)).state, 'emitido');

    const emailTres = `${randomUUID()}@example.test`;
    const terceiro = await falha(
      `select private.admin_invite_issue($1, 'ativacao', $2, $3, $4, $5, '{superadmin}', null, null, 'continuidade', now())`,
      [randomUUID(), emailTres, sha(`hmac:${emailTres}`), Buffer.from('e'), sha(randomUUID())]);
    assert.equal(terceiro?.code, 'ADM10', 'segundo convite de bootstrap vivo com outro e-mail e recusado');
  }));

// Revisao da #111: uso unico do convite e validade de 72 h exatas (T-H102-01).
test('T-H102-01 validade do convite: so 72 h exatas; 71 h e 73 h sao recusadas pelo banco', () =>
  tx(async () => {
    const admin = await superadmin();
    const insere = (horas) =>
      falha(
        `insert into app.admin_invite (id, kind, email_hmac, email_enc, token_hash, role_codes, invited_by,
                                       approval_request_id, state, attempts, user_id, created_at,
                                       expires_at, used_at)
         values ($1, 'ativacao', $2, $3, $4, '{auditor}', $5, null, 'emitido', 0, null, now(),
                 now() + make_interval(hours => $6), null)`,
        [randomUUID(), sha(randomUUID()), Buffer.from('e'), sha(randomUUID()), admin.id, horas]);
    assert.equal((await insere(72))?.code, undefined, 'validade de 72 h e aceita');
    assert.equal((await insere(71))?.code, '23514', 'validade de 71 h e recusada');
    assert.equal((await insere(73))?.code, '23514', 'validade de 73 h e recusada');
  }));

test('T-H102-01 convite usado nao reativa no banco: ativacao, marcacao e nova conta recusadas', () =>
  tx(async () => {
    const admin = await superadmin();
    const email = `${randomUUID()}@example.test`;
    const c = await emitirConvite({ invitedBy: admin.id, email, roles: ['auditor'] });
    const conta = await usuario(email);
    await client.query('select private.admin_invite_mark_waiting($1, $2, $3)', [sha(c.token), conta.id, iso(NOW)]);
    const primeira = (await client.query('select private.admin_invite_activate($1, $2) as u',
      [sha(c.token), iso(NOW)])).rows[0].u;
    assert.equal(primeira, conta.id);

    const de_novo = (await client.query('select private.admin_invite_activate($1, $2) as u',
      [sha(c.token), iso(NOW)])).rows[0].u;
    assert.equal(de_novo, null, 'convite usado nao ativa de novo');
    const marca = (await client.query('select private.admin_invite_mark_waiting($1, $2, $3) as ok',
      [sha(c.token), conta.id, iso(NOW)])).rows[0].ok;
    assert.equal(marca, false, 'convite usado nao volta a aguardar TOTP');
    const { rows: [n] } = await client.query(
      'select count(*)::int as n from app.admin_user_role where user_id = $1 and revoked_at is null', [conta.id]);
    assert.equal(n.n, 1, 'papel do convite nao se duplica');
  }));
