// H-073 (#83) | Caso de acesso excepcional a conversa no banco (docs/factory/60-DESENHO-H073.md §5, T-H073-20..27).
// Banco de desenvolvimento. Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos
// (@example.test). Sem rede, sem envio de e-mail. A tabela de conversa ainda nao existe: o gate e testado
// com uma tabela temporaria de teste criada dentro da transacao. NAO VERIFICADO: a rota de leitura real
// (H-065/H-066) e a concorrencia com varias conexoes (T-H073-24, parte de 20 simultaneas).
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
const MIN = 60 * 1000;
const JUST = 'motivo sintetico com mais de vinte caracteres';

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

/** Sessao aberta no instante `ms` (login com TOTP: totp_at = ms). Devolve o segredo em hash. */
async function sessao(userId, ms, seed = randomUUID()) {
  const secret = sha(seed);
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok',
    [randomUUID(), userId, secret, at(ms)]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

async function abrir(actor, secret, conversa, ms, caso = randomUUID(), justificativa = JUST) {
  await client.query(
    'select private.access_case_open($1, $2, $3, $4, $5, $6)',
    [actor, secret, conversa, justificativa, caso, at(ms)]);
  return caso;
}

/** Cenario padrao: suporte abre (sessao em T0), superadmin aprova em T0 + 1 min. */
async function casoAprovado(conversa = randomUUID()) {
  const abre = await staffComPapel('suporte');
  const aprova = await staffComPapel('superadmin');
  const sAbre = await sessao(abre, T0);
  const sAprova = await sessao(aprova, T0);
  const caso = await abrir(abre, sAbre, conversa, T0);
  await client.query('select private.access_case_approve($1, $2, $3, $4)',
    [aprova, sAprova, caso, at(T0 + MIN)]);
  return { abre, aprova, sAbre, sAprova, caso, conversa, aprovadoEm: T0 + MIN, expiraEm: T0 + MIN + 30 * MIN };
}

// T-H073-20 | privilegios e registro somente de acrescimo
test('T-H073-20 RLS forcada; app_system sem UPDATE, DELETE nem TRUNCATE no registro; sem privilegio de papeis publicos',
  () => tx(async () => {
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname in ('access_case', 'sensitive_access_log')`);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, r.relname);
      assert.equal(r.relforcerowsecurity, true, r.relname);
    }
    const priv = (role, tab, p) =>
      client.query('select has_table_privilege($1, $2, $3) as ok', [role, tab, p]).then((x) => x.rows[0].ok);
    assert.equal(await priv('app_system', 'app.sensitive_access_log', 'update'), false);
    assert.equal(await priv('app_system', 'app.sensitive_access_log', 'delete'), false);
    assert.equal(await priv('app_system', 'app.sensitive_access_log', 'truncate'), false);
    assert.equal(await priv('app_system', 'app.access_case', 'delete'), false);
    // A chave de servico nao e testada aqui: scripts/check-secrets.mjs so admite o nome em modulos listados.
    // Ela fica coberta pelas permissoes de T-H102-20 (admin-rbac.dbtest.mjs).
    for (const role of ['anon', 'authenticated', 'app_api']) {
      assert.equal(await priv(role, 'app.access_case', 'select'), false, `${role} sem leitura`);
      assert.equal(await priv(role, 'app.sensitive_access_log', 'select'), false, `${role} sem leitura`);
    }
  }));

// T-H073-21 | gate: sem caso, nada de log nem de auditoria
test('T-H073-21 gate: sem caso ou com caso de outra pessoa nega com ADM20 e nao grava log nem auditoria',
  () => tx(async () => {
    const { abre, sAbre, conversa } = await casoAprovado();
    const intruso = await staffComPapel('suporte');
    const sIntruso = await sessao(intruso, T0);
    const antesLog = (await client.query('select count(*)::int as n from app.sensitive_access_log')).rows[0].n;
    const antesAud = (await client.query('select count(*)::int as n from audit.audit_event')).rows[0].n;
    const semCaso = await falha('select private.access_case_gate($1, $2, $3, $4, $5)',
      [abre, sAbre, randomUUID(), conversa, at(T0 + 2 * MIN)]);
    assert.equal(semCaso?.code, 'ADM20');
    const outro = await falha('select private.access_case_gate($1, $2, $3, $4, $5)',
      [intruso, sIntruso, (await client.query('select id from app.access_case limit 1')).rows[0].id, conversa, at(T0 + 2 * MIN)]);
    assert.equal(outro?.code, 'ADM20');
    assert.equal((await client.query('select count(*)::int as n from app.sensitive_access_log')).rows[0].n, antesLog);
    assert.equal((await client.query('select count(*)::int as n from audit.audit_event')).rows[0].n, antesAud);
  }));

// T-H073-22 | janela de 30 min no banco: limite exato negado, 1 ms antes aceito
test('T-H073-22 janela: leitura em expires_at e negada; expires_at - 1 ms e aceita; check de 30 min recusa outro prazo',
  () => tx(async () => {
    const c = await casoAprovado();
    const expira = new Date(c.expiraEm).toISOString();
    const err = await falha(`update app.access_case set expires_at = approved_at + interval '31 minutes' where id = $1`, [c.caso]);
    assert.equal(err?.code, '42501', 'expires_at imutavel depois de aprovado');

    const aceita = await falha('select private.access_case_gate($1, $2, $3, $4, $5)',
      [c.abre, c.sAbre, c.caso, c.conversa, at(c.expiraEm - 1)]);
    assert.equal(aceita, null, 'expires_at - 1 ms deve aceitar');
    const negada = await falha('select private.access_case_gate($1, $2, $3, $4, $5)',
      [c.abre, c.sAbre, c.caso, c.conversa, expira]);
    assert.equal(negada?.code, 'ADM20', 'expires_at exato deve negar');
  }));

// T-H073-23 | mesma transacao: log e leitura andam juntos
test('T-H073-23 mesma transacao: leitura com gate deixa 1 log com audit_event_id; desfazer a leitura desfaz o log',
  () => tx(async () => {
    const c = await casoAprovado();
    await client.query('create temp table conversa_teste (id uuid primary key, texto text) on commit drop');
    await client.query('insert into conversa_teste values ($1, $2)', [c.conversa, 'texto sintetico da conversa']);

    await client.query('savepoint leitura');
    const log = (await client.query('select private.access_case_gate($1, $2, $3, $4, $5) as id',
      [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 2 * MIN)])).rows[0].id;
    const { rows: [l] } = await client.query(
      `select l.audit_event_id, e.action from app.sensitive_access_log l
         join audit.audit_event e on e.id = l.audit_event_id where l.id = $1`, [log]);
    assert.equal(l.action, 'access_case.conversation_read');
    const { rows: [texto] } = await client.query('select texto from conversa_teste where id = $1', [c.conversa]);
    assert.equal(texto.texto, 'texto sintetico da conversa');

    // Leitura que falha depois do gate desfaz o log junto (mesma transacao).
    await client.query('rollback to savepoint leitura');
    const { rows: [n] } = await client.query('select count(*)::int as n from app.sensitive_access_log where id = $1', [log]);
    assert.equal(n.n, 0, 'o log desfaz com a leitura');
  }));

// T-H073-25 | prova recente no banco: 29:59 vale; 30:00 exige nova prova (ADM21)
test('T-H073-25 TOTP recente: abrir com prova em 29:59 passa; em 30:00 exige nova prova (ADM21)', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const conversa = randomUUID();
    const seg1 = await sessao(abre, T0, 'seg-a');
    await abrir(abre, seg1, conversa, T0 + 29 * MIN + 59_000);
    const seg2 = await sessao(abre, T0, 'seg-b');
    const err = await falha('select private.access_case_open($1, $2, $3, $4, $5, $6)',
      [abre, seg2, randomUUID(), JUST, randomUUID(), at(T0 + 30 * MIN)]);
    assert.equal(err?.code, 'ADM21');
  }));

// T-H073-24 | aprovacao: nao autoaprova, exige permissao, nao aprova duas vezes; limites de abertura
test('T-H073-24 aprovacao: sem permissao (Suporte) negada; aprovar de novo o mesmo caso e negado (ADM25)', () =>
  tx(async () => {
    const c = await casoAprovado();
    const suporte = await staffComPapel('suporte');
    const sSup = await sessao(suporte, T0);
    const semPermissao = await falha('select private.access_case_approve($1, $2, $3, $4)',
      [suporte, sSup, c.caso, at(T0 + 3 * MIN)]);
    assert.equal(semPermissao?.code, '42501');
    const repetida = await falha('select private.access_case_approve($1, $2, $3, $4)',
      [c.aprova, c.sAprova, c.caso, at(T0 + 3 * MIN)]);
    assert.equal(repetida?.code, 'ADM25');
  }));

test('T-H073-24 limites: 6o pendente do mesmo solicitante e recusado (ADM24); justificativa de 19 caracteres (ADM22)', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const s = await sessao(abre, T0);
    for (let i = 0; i < 5; i += 1) await abrir(abre, s, randomUUID(), T0);
    const sexto = await falha('select private.access_case_open($1, $2, $3, $4, $5, $6)',
      [abre, s, randomUUID(), JUST, randomUUID(), at(T0)]);
    assert.equal(sexto?.code, 'ADM24');
    const curta = await falha('select private.access_case_open($1, $2, $3, $4, $5, $6)',
      [abre, s, randomUUID(), 'x'.repeat(19), randomUUID(), at(T0)]);
    assert.equal(curta?.code, 'ADM22');
  }));

// T-H073-26 | aprovacao aceita o tipo novo e recusa tipo desconhecido
test('T-H073-26 approval_request aceita acesso_conversa e recusa tipo desconhecido', () =>
  tx(async () => {
    const u = await staffComPapel('superadmin');
    const ok = await falha(`insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
        required_approvals, status, created_at, expires_at)
      values (gen_random_uuid(), 'acesso_conversa', null, null, $1, 1, 'pendente', now(), now() + interval '24 hours')`, [u]);
    assert.equal(ok, null);
    const desconhecido = await falha(`insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
        required_approvals, status, created_at, expires_at)
      values (gen_random_uuid(), 'estorno', null, null, $1, 1, 'pendente', now(), now() + interval '24 hours')`, [u]);
    assert.equal(desconhecido?.code, '23514');
  }));

// T-H073-27 | varredura: a justificativa so aparece em access_case
test('T-H073-27 varredura: justificativa sentinela aparece so em access_case; nao vai para o registro nem a auditoria', () =>
  tx(async () => {
    const sentinela = 'SENTINELA-JUST-H073-7731-zq';
    const abre = await staffComPapel('suporte');
    const aprova = await staffComPapel('superadmin');
    const sAbre = await sessao(abre, T0);
    const sAprova = await sessao(aprova, T0);
    const conversa = randomUUID();
    const caso = await abrir(abre, sAbre, conversa, T0, randomUUID(), `${JUST} ${sentinela}`);
    await client.query('select private.access_case_approve($1, $2, $3, $4)', [aprova, sAprova, caso, at(T0 + MIN)]);
    await client.query('select private.access_case_gate($1, $2, $3, $4, $5)', [abre, sAbre, caso, conversa, at(T0 + 2 * MIN)]);

    const { rows: [viaCaso] } = await client.query(
      'select count(*)::int as n from app.access_case where justification like $1', [`%${sentinela}%`]);
    assert.equal(viaCaso.n, 1);
    const { rows: [viaLog] } = await client.query(
      `select count(*)::int as n from app.sensitive_access_log l where to_jsonb(l)::text like $1`, [`%${sentinela}%`]);
    assert.equal(viaLog.n, 0);
    const { rows: [viaAud] } = await client.query(
      `select count(*)::int as n from audit.audit_event e
        where (e.before_state::text || e.after_state::text) like $1`, [`%${sentinela}%`]);
    assert.equal(viaAud.n, 0);
  }));

// T-H073-23 (registro): UPDATE e DELETE no registro sao recusados mesmo para o dono
test('T-H073-23 registro somente de acrescimo: UPDATE e DELETE recusados pelo gatilho', () =>
  tx(async () => {
    const c = await casoAprovado();
    await client.query('select private.access_case_gate($1, $2, $3, $4, $5)', [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 2 * MIN)]);
    const upd = await falha('update app.sensitive_access_log set action = action');
    assert.equal(upd?.code, '42501');
    const del = await falha('delete from app.sensitive_access_log');
    assert.equal(del?.code, '42501');
    const dcaso = await falha('delete from app.access_case');
    assert.equal(dcaso?.code, '42501');
  }));

test('CA-H073-05 fechar e revogar: o solicitante encerra; quem autoriza revoga; sem permissao, negado', () =>
  tx(async () => {
    const c = await casoAprovado();
    const outro = await staffComPapel('financeiro');
    const negado = await falha('select private.access_case_close($1, $2, $3)', [outro, c.caso, at(T0 + 3 * MIN)]);
    assert.equal(negado?.code, '42501');
    const revoga = (await client.query('select private.access_case_close($1, $2, $3) as ok',
      [c.aprova, c.caso, at(T0 + 3 * MIN)])).rows[0].ok;
    assert.equal(revoga, true);
    const denovo = (await client.query('select private.access_case_close($1, $2, $3) as ok',
      [c.abre, c.caso, at(T0 + 4 * MIN)])).rows[0].ok;
    assert.equal(denovo, false, 'idempotente');
    const depois = await falha('select private.access_case_gate($1, $2, $3, $4, $5)',
      [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 5 * MIN)]);
    assert.equal(depois?.code, 'ADM20', 'caso fechado nega na hora');
  }));
