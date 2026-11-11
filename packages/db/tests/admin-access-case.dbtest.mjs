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
    // Escritas so por funcao security definer (revisao da #83): app_system nao insere nem atualiza.
    assert.equal(await priv('app_system', 'app.access_case', 'insert'), false);
    assert.equal(await priv('app_system', 'app.access_case', 'update'), false);
    assert.equal(await priv('app_system', 'app.sensitive_access_log', 'insert'), false);
    assert.equal(await priv('app_system', 'app.access_case', 'select'), true);
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

// ---- Revisao da #83: lacunas de teste ----------------------------------------------------------------

/** Papel adicional (concedido na origem bootstrap, sem aprovacao: so para preparo de teste). */
async function papel(userId, role) {
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [userId, role],
  );
}

const contagem = async () => ({
  log: (await client.query('select count(*)::int as n from app.sensitive_access_log')).rows[0].n,
  aud: (await client.query('select count(*)::int as n from audit.audit_event')).rows[0].n,
});

// T-H073-21 (ampliado) | cada negacao do gate: ADM20 e nenhuma linha de log nem de auditoria
test('T-H073-21 gate: pendente, outra conversa e sessao revogada negam com ADM20 sem gravar nada', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const sAbre = await sessao(abre, T0, 'pend-a');
    const convPend = randomUUID();
    const pendente = await abrir(abre, sAbre, convPend, T0);
    const antes1 = await contagem();
    const e1 = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [abre, sAbre, pendente, convPend, at(T0 + MIN)]);
    assert.equal(e1?.code, 'ADM20', 'caso pendente');
    assert.deepEqual(await contagem(), antes1, 'pendente: sem log nem auditoria');

    const c = await casoAprovado();
    const ok = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 2 * MIN)]);
    assert.equal(ok, null, 'controle: caso ativo le');

    const antes2 = await contagem();
    const e2 = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [c.abre, c.sAbre, c.caso, randomUUID(), at(T0 + 2 * MIN)]);
    assert.equal(e2?.code, 'ADM20', 'outra conversa');
    assert.deepEqual(await contagem(), antes2, 'outra conversa: sem log nem auditoria');

    await client.query(`update app.admin_session set revoked_at = $2 where secret_hash = $1`, [c.sAbre, at(T0 + 2 * MIN)]);
    const e3 = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 3 * MIN)]);
    assert.equal(e3?.code, 'ADM20', 'sessao revogada');
    assert.deepEqual(await contagem(), antes2, 'sessao revogada: sem log nem auditoria');
  }));

test('T-H073-21 gate: sessao vencida (8 h) nega mesmo com caso ativo; a mesma leitura com a sessao viva passa', () =>
  tx(async () => {
    const abre = await staffComPapel('suporte');
    const aprova = await staffComPapel('superadmin');
    const sAbre = await sessao(abre, T0, 'venc-a');
    const conv = randomUUID();
    const caso = await abrir(abre, sAbre, conv, T0);
    const sAprova = await sessao(aprova, T0 + 478 * MIN, 'venc-b');
    await client.query('select private.access_case_approve($1,$2,$3,$4)', [aprova, sAprova, caso, at(T0 + 479 * MIN)]);
    // Caso ativo de 479 a 509 min; a sessao de abertura vence em 480 min (8 h).
    const viva = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [abre, sAbre, caso, conv, at(T0 + 479 * MIN + MIN / 2)]);
    assert.equal(viva, null, 'controle: sessao viva le');
    const antes = await contagem();
    const vencida = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [abre, sAbre, caso, conv, at(T0 + 480 * MIN)]);
    assert.equal(vencida?.code, 'ADM20', 'sessao vencida no instante exato');
    assert.equal((await contagem()).log, antes.log + 0, 'sem log novo na negacao');
  }));

test('T-H073-21 gate: papel revogado depois da aprovacao nega a leitura com ADM20', () =>
  tx(async () => {
    const c = await casoAprovado();
    await client.query(
      `update app.admin_user_role set revoked_at = $3, revoked_by = $2
        where user_id = $1 and role_code = 'suporte' and revoked_at is null`,
      [c.abre, c.aprova, at(T0 + 2 * MIN)]);
    const antes = await contagem();
    const err = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 3 * MIN)]);
    assert.equal(err?.code, 'ADM20');
    assert.deepEqual(await contagem(), antes);
  }));

// T-H073-22 (check de 30 min com insert direto)
test('T-H073-22 check de 30 min: insert direto com expires_at de 31 min e recusado; 30 min exatos passam', () =>
  tx(async () => {
    const sup = await staffComPapel('suporte');
    const ap = await staffComPapel('superadmin');
    const reqErrada = randomUUID();
    const reqCerta = randomUUID();
    for (const id of [reqErrada, reqCerta]) {
      await client.query(
        `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
           required_approvals, status, created_at, expires_at, consumed_at)
         values ($1, 'acesso_conversa', null, null, $2, 1, 'consumida', $3, $4, $3)`,
        [id, sup, at(T0), at(T0 + 24 * 60 * MIN)]);
    }
    const inserir = (reqId, expiraMin) => falha(
      `insert into app.access_case (id, opened_by, authorized_by, justification, scope_kind, scope_id,
          approval_request_id, created_at, approved_at, expires_at)
       values ($1, $2, $3, $4, 'conversation', $5, $6, $7, $8, $9)`,
      [randomUUID(), sup, ap, JUST, randomUUID(), reqId, at(T0), at(T0 + MIN), at(T0 + MIN + expiraMin * MIN)]);
    const errada = await inserir(reqErrada, 31);
    assert.equal(errada?.code, '23514', 'expires_at = approved_at + 31 min e recusado');
    const certa = await inserir(reqCerta, 30);
    assert.equal(certa, null, 'expires_at = approved_at + 30 min passa');
  }));

// T-H073-23 (catalogo): acao desativada nao leva a leitura
test('T-H073-23 catalogo: com access_case.conversation_read desativada, o gate falha, nao le e nao grava log', () =>
  tx(async () => {
    const c = await casoAprovado();
    await client.query(`update audit.action_catalog set active = false where action = 'access_case.conversation_read'`);
    await client.query('create temp table conversa_teste2 (id uuid primary key, texto text) on commit drop');
    const antes = await contagem();
    const err = await falha('select private.access_case_gate($1,$2,$3,$4,$5)', [c.abre, c.sAbre, c.caso, c.conversa, at(T0 + 2 * MIN)]);
    assert.equal(err?.code, 'ADM20');
    assert.deepEqual(await contagem(), antes, 'nenhuma linha de log nem de auditoria');
    const { rows } = await client.query('select count(*)::int as n from app.sensitive_access_log where case_id = $1', [c.caso]);
    assert.equal(rows[0].n, 0);
  }));

// T-H073-24 (aprovacao no banco): autoaprovacao e voto repetido
test('T-H073-24 autoaprovacao no banco: quem abriu o caso nao o aprova mesmo tendo a permissao (42501)', () =>
  tx(async () => {
    const pessoa = await staffComPapel('suporte');
    await papel(pessoa, 'superadmin');
    const s = await sessao(pessoa, T0, 'auto-a');
    const conv = randomUUID();
    const caso = await abrir(pessoa, s, conv, T0);
    const err = await falha('select private.access_case_approve($1,$2,$3,$4)', [pessoa, s, caso, at(T0 + MIN)]);
    assert.equal(err?.code, '42501');
    const { rows: [c] } = await client.query('select approved_at from app.access_case where id = $1', [caso]);
    assert.equal(c.approved_at, null, 'o caso continua pendente');
  }));

test('T-H073-24 voto repetido no banco: o mesmo aprovador nao vota duas vezes no mesmo pedido (23505)', () =>
  tx(async () => {
    const sup = await staffComPapel('suporte');
    const ap = await staffComPapel('superadmin');
    const reqId = randomUUID();
    await client.query(
      `insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
         required_approvals, status, created_at, expires_at)
       values ($1, 'acesso_conversa', null, null, $2, 1, 'pendente', $3, $4)`,
      [reqId, sup, at(T0), at(T0 + 24 * 60 * MIN)]);
    const primeiro = await falha(
      'insert into app.approval_vote (id, approval_request_id, approver_id, voted_at) values (gen_random_uuid(), $1, $2, $3)',
      [reqId, ap, at(T0 + MIN)]);
    assert.equal(primeiro, null);
    const segundo = await falha(
      'insert into app.approval_vote (id, approval_request_id, approver_id, voted_at) values (gen_random_uuid(), $1, $2, $3)',
      [reqId, ap, at(T0 + 2 * MIN)]);
    assert.equal(segundo?.code, '23505');
  }));
