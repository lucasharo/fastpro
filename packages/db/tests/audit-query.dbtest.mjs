// H-104 (Issue 113) | Consulta a auditoria pelo Auditor no banco (docs/factory/63-DESENHO-H104.md §5,
// T-H104-20..26). Banco de desenvolvimento COMPARTILHADO: cada teste roda em transacao e e desfeito
// (rollback); nunca COMMIT. Valores sinteticos (@example.test). Sem rede, sem e-mail.
// NAO COBERTO AQUI (pendente, ver relatorio da Issue 113): T-H104-27 (imutabilidade, ja coberta pela
// bateria de H-006 em audit.dbtest.mjs) e T-H104-28 (plano de consulta com volume).
// Papel revogado no meio da transacao: se era o unico papel ativo, admin_guard nao devolve linha e a
// funcao levanta ADM30 (API: 404); se o admin ainda tinha outro papel ativo, a linha existe e
// admin_has_permission(audit.read) e falso: 42501 (API: 403). A API ja barra antes, pela guarda, quando
// o papel esta revogado no momento da requisicao (CA-H104-07).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { PgAuditQueryPort, PgAuditQueryRateLimit } from '../dist/admin-audit.js';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const SENTINELA = 'sentinela-h104-zq7';
const HORA = 60 * 60 * 1000;
const ISO_US = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

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

async function staffComPapel(role) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
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

/** Sessao aberta agora (login com TOTP). Devolve o segredo em hash, como a API envia ao banco. */
async function sessao(userId, nowMs) {
  const secret = sha(randomUUID());
  const { rows } = await client.query('select private.admin_session_open($1, $2, $3, $4) as ok', [
    randomUUID(),
    userId,
    secret,
    new Date(nowMs).toISOString(),
  ]);
  assert.equal(rows[0].ok, true, 'sessao de teste aberta');
  return secret;
}

/** Papel adicional ativo (bootstrap, sem concedente), para o caso de admin com mais de um papel. */
async function papelExtra(userId, role) {
  await client.query(
    `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at, approval_request_id)
     values (gen_random_uuid(), $1, $2, null, 'bootstrap', now(), null)`,
    [userId, role],
  );
}

/** Sessao gravada direto em app.admin_session, sem auditoria: a fixture nao pode tomar o lock da cabeca. */
async function sessaoDireta(userId, nowMs) {
  const secret = sha(randomUUID());
  const t = new Date(nowMs).toISOString();
  await client.query(
    `insert into app.admin_session (id, user_id, secret_hash, aal2_at, totp_at, created_at, expires_at)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz, $4::timestamptz, $4::timestamptz + interval '8 hours')`,
    [randomUUID(), userId, secret, t],
  );
  return secret;
}

/** Cabeca da cadeia (sem lock): ultimo seq e ultimo hash. */
async function cabeca(c = client) {
  const r = await c.query('select last_seq::text as seq, last_hash from audit.chain_head where id');
  return r.rows[0];
}

/** Semeia um evento pela porta de escrita real (private.audit_append). Devolve seq e instante exato. */
async function semear(actor, action, objectType, objectId, before, after, reason = null) {
  const { rows } = await client.query(
    `select private.audit_append($1, 'admin', $2, $3, $4, $5::jsonb, $6::jsonb, $7, null) as id`,
    [`admin:${actor}`, action, objectType, objectId, JSON.stringify(before), JSON.stringify(after), reason],
  );
  const r = await client.query(
    `select seq, at, to_char(at at time zone 'UTC', '${ISO_US}') as at_txt from audit.audit_event where id = $1`,
    [rows[0].id],
  );
  return r.rows[0];
}

async function consulta(actor, secret, now, p) {
  const r = await client.query(
    'select private.audit_query($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r',
    [
      actor,
      secret,
      p.from,
      p.to,
      p.action ?? null,
      p.objectType ?? null,
      p.objectId ?? null,
      p.after ?? 0,
      p.limit ?? 50,
      new Date(now).toISOString(),
    ],
  );
  return r.rows[0].r;
}

/** Janela que comeca no relogio do banco ANTES da semeadura: so os eventos da transacao (e de outros
 * processos, raros em dev) caem nela. Termina 1 h no futuro. */
async function janela() {
  const r = await client.query(`select to_char(clock_timestamp() at time zone 'UTC', '${ISO_US}') as t`);
  return { from: r.rows[0].t, to: new Date(Date.now() + HORA).toISOString() };
}

async function contaConsultas(actor) {
  const r = await client.query(
    "select count(*)::int as n from audit.audit_event where actor_ref = $1 and action = 'audit.queried'",
    [`admin:${actor}`],
  );
  return r.rows[0].n;
}

test('T-H104-20 catalogo, funcao security definer e privilegios', async () => {
  await tx(async () => {
    const cat = await client.query(
      "select reason_required, array_length(state_keys, 1) as n, private.audit_keys_are_clean(state_keys) as clean from audit.action_catalog where action = 'audit.queried' and object_type = 'audit_query'",
    );
    assert.equal(cat.rows.length, 1, 'acao audit.queried no catalogo');
    assert.equal(cat.rows[0].reason_required, false);
    assert.equal(cat.rows[0].n, 9);
    assert.equal(cat.rows[0].clean, true);

    const fn = await client.query(
      `select prosecdef, proconfig from pg_proc where oid = 'private.audit_query(uuid,text,timestamptz,timestamptz,text,text,uuid,bigint,integer,timestamptz)'::regprocedure`,
    );
    assert.equal(fn.rows[0].prosecdef, true);
    assert.ok(fn.rows[0].proconfig.some((c) => c.startsWith('search_path=')), 'search_path fixado');

    const priv = await client.query(
      `select has_function_privilege('app_api', 'private.audit_query(uuid,text,timestamptz,timestamptz,text,text,uuid,bigint,integer,timestamptz)', 'EXECUTE') as api,
              has_function_privilege('app_system', 'private.audit_query(uuid,text,timestamptz,timestamptz,text,text,uuid,bigint,integer,timestamptz)', 'EXECUTE') as sys,
              has_table_privilege('app_api', 'audit.audit_event', 'SELECT') as api_select,
              has_table_privilege('app_system', 'audit.audit_event', 'UPDATE') as sys_update`,
    );
    assert.equal(priv.rows[0].api, false, 'app_api sem EXECUTE');
    assert.equal(priv.rows[0].sys, true, 'app_system com EXECUTE');
    assert.equal(priv.rows[0].api_select, false, 'app_api sem SELECT em audit_event (54 §1)');
    assert.equal(priv.rows[0].sys_update, false, 'app_system sem UPDATE na trilha');

    const pub = await client.query(
      `select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = 'private.audit_query(uuid,text,timestamptz,timestamptz,text,text,uuid,bigint,integer,timestamptz)'::regprocedure
                         and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec`,
    );
    assert.equal(pub.rows[0].public_exec, false, 'PUBLIC sem EXECUTE');
  });
});

test('T-H104-21 filtros combinados em ordem de seq e limites do intervalo semiaberto', async () => {
  await tx(async () => {
    const now = Date.now();
    const win = await janela();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    const objA = randomUUID();
    const objB = randomUUID();
    const e1 = await semear(randomUUID(), 'consent.changed', 'contact_consent', objA, {}, { scope: 'x', granted: 'sim' });
    const e2 = await semear(randomUUID(), 'consent.changed', 'contact_consent', objB, {}, { scope: 'x', granted: 'nao' });
    const e3 = await semear(randomUUID(), 'review.revised', 'review', objA, {}, { status: 'ok' }, 'moderacao_ok');
    const e4 = await semear(randomUUID(), 'access_case.opened', 'access_case', randomUUID(), {}, { status: 'pendente' });
    assert.ok(e1.at < e2.at, 'instantes em ordem crescente');

    const todos = await consulta(ator, seg, now, win);
    const seqs = todos.eventos.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'ordem por seq');
    for (const e of [e1, e2, e3, e4]) assert.ok(seqs.includes(Number(e.seq)), 'evento semeado presente');

    const porAcao = await consulta(ator, seg, now, { ...win, action: 'consent.changed' });
    assert.deepEqual(porAcao.eventos.map((e) => e.seq), [e1.seq, e2.seq].map(Number));

    const porEntidade = await consulta(ator, seg, now, { ...win, objectType: 'review', objectId: objA });
    assert.deepEqual(porEntidade.eventos.map((e) => e.seq), [e3.seq].map(Number));

    const combinado = await consulta(ator, seg, now, {
      ...win, action: 'consent.changed', objectType: 'contact_consent', objectId: objA,
    });
    assert.deepEqual(combinado.eventos.map((e) => e.seq), [e1.seq].map(Number));

    // Intervalo semiaberto: from inclusivo (at = e1), to exclusivo (at = e2). Resultado: so e1.
    const borda = await consulta(ator, seg, now, { from: e1.at_txt, to: e2.at_txt });
    assert.deepEqual(borda.eventos.map((e) => e.seq), [e1.seq].map(Number));

    // Lista fechada de campos (CA-H104-04): sem prev_hash nem row_hash.
    const campos = Object.keys(todos.eventos[0]).sort();
    assert.deepEqual(campos, [
      'action', 'actor_ref', 'actor_role', 'after_state', 'at', 'before_state', 'correlation_id',
      'id', 'object_id', 'object_type', 'reason_code', 'seq',
    ]);
  });
});

test('T-H104-22 paginacao por cursor sem repeticao nem lacuna; uma entrada por pagina', async () => {
  await tx(async () => {
    const now = Date.now();
    const win = await janela();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    const obj = randomUUID();
    const semeados = [];
    for (let i = 0; i < 5; i++) {
      const e = await semear(randomUUID(), 'consent.changed', 'contact_consent', obj, {}, { scope: 'p', granted: 'sim' });
      semeados.push(Number(e.seq));
    }
    const filtro = { ...win, action: 'consent.changed', objectId: obj, objectType: 'contact_consent', limit: 2 };
    const paginas = [];
    let cursor = 0;
    for (;;) {
      const p = await consulta(ator, seg, now, { ...filtro, after: cursor });
      paginas.push(p);
      if (!p.tem_mais) break;
      cursor = p.proximo_cursor;
      assert.ok(paginas.length <= 5, 'paginacao termina');
    }
    assert.deepEqual(paginas.map((p) => p.eventos.length), [2, 2, 1]);
    assert.deepEqual(paginas.map((p) => p.tem_mais), [true, true, false]);
    const vistos = paginas.flatMap((p) => p.eventos.map((e) => Number(e.seq)));
    assert.deepEqual(vistos, semeados, 'sem repeticao nem lacuna');

    const entradas = await client.query(
      `select object_id, after_state->>'returned_count' as n from audit.audit_event
        where actor_ref = $1 and action = 'audit.queried' order by seq`,
      [`admin:${ator}`],
    );
    assert.deepEqual(entradas.rows.map((r) => Number(r.n)), [2, 2, 1], 'uma entrada por pagina');
  });
});

test('T-H104-23 registro da consulta: filtros e contagem, sem conteudo lido; resultado vazio tambem grava', async () => {
  await tx(async () => {
    const now = Date.now();
    const win = await janela();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    const obj = randomUUID();
    const lido = await semear(randomUUID(), 'consent.changed', 'contact_consent', obj, {}, { scope: SENTINELA, granted: 'sim' });

    const com = await consulta(ator, seg, now, { ...win, action: 'consent.changed', objectId: obj, objectType: 'contact_consent' });
    assert.equal(com.eventos.length, 1);
    assert.equal(com.eventos[0].seq, Number(lido.seq));

    const entrada = await client.query(
      `select actor_ref, actor_role, object_type, object_id, after_state, to_jsonb(audit_event)::text as linha, seq
         from audit.audit_event where actor_ref = $1 and action = 'audit.queried' order by seq desc limit 1`,
      [`admin:${ator}`],
    );
    const r = entrada.rows[0];
    assert.equal(r.actor_role, 'auditor');
    assert.equal(r.object_type, 'audit_query');
    assert.equal(r.object_id, com.consulta_id, 'a entrada referencia a propria consulta');
    assert.equal(r.after_state.returned_count, 1);
    assert.equal(r.after_state.filter_action, 'consent.changed');
    assert.ok(r.after_state.period_from && r.after_state.period_to, 'periodo registrado');
    assert.ok(!r.linha.includes(SENTINELA), 'a entrada nao contem o conteudo lido');
    assert.ok(!com.eventos.some((e) => Number(e.seq) === Number(r.seq)), 'a entrada nao aparece na propria resposta');

    const vazio = await consulta(ator, seg, now, { ...win, action: 'payment.refunded' , objectType: 'payment' });
    assert.equal(vazio.eventos.length, 0);
    const entradas = await client.query(
      `select after_state->>'returned_count' as n from audit.audit_event
        where actor_ref = $1 and action = 'audit.queried' order by seq`,
      [`admin:${ator}`],
    );
    assert.deepEqual(entradas.rows.map((x) => Number(x.n)), [1, 0], 'resultado vazio tambem grava');

    const proxima = await consulta(ator, seg, now, { ...win, action: 'audit.queried' });
    assert.ok(proxima.eventos.some((e) => e.object_id === com.consulta_id), 'a entrada aparece na consulta seguinte');
  });
});

test('T-H104-24 falha fecha no banco: sem dado devolvido, sem entrada e chain_head inalterado', async () => {
  const headFora = await cabeca();
  await tx(async () => {
    const now = Date.now();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    await semear(randomUUID(), 'consent.changed', 'contact_consent', randomUUID(), {}, { scope: 'x', granted: 'sim' });
    await client.query("update audit.action_catalog set active = false where action = 'audit.queried'");
    const antes = await contaConsultas(ator);
    const headAntes = await cabeca();
    const err = await falha(
      'select private.audit_query($1, $2, $3, $4, null, null, null, 0, 50, $5) as r',
      [ator, seg, new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), new Date(now).toISOString()],
    );
    assert.ok(err, 'a consulta falha quando a entrada nao pode ser gravada');
    assert.equal(await contaConsultas(ator), antes, 'nenhuma entrada nova');
    assert.deepEqual(await cabeca(), headAntes, 'chain_head inalterado apos a falha');
  });
  assert.deepEqual(await cabeca(), headFora, 'apos o ROLLBACK, chain_head igual ao de antes da transacao');
});

test('T-H104-24b falha fecha com lock_timeout: cabeca da cadeia travada por outra sessao (5 s, 55P03)', async () => {
  const outra = await connect();
  try {
    await tx(async () => {
      const now = Date.now();
      const ator = await staffComPapel('auditor');
      const seg = await sessaoDireta(ator, now);
      await outra.query('begin');
      try {
        await outra.query('select last_seq from audit.chain_head where id for update');
        const antes = await contaConsultas(ator);
        const headAntes = await cabeca();
        const err = await falha(
          'select private.audit_query($1, $2, $3, $4, null, null, null, 0, 50, $5) as r',
          [ator, seg, new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), new Date(now).toISOString()],
        );
        assert.equal(err?.code, '55P03', 'a gravacao esgota o lock_timeout da cabeca');
        assert.equal(await contaConsultas(ator), antes, 'nenhuma entrada nova');
        assert.deepEqual(await cabeca(), headAntes, 'chain_head inalterado apos o lock_timeout');
      } finally {
        await outra.query('rollback');
      }
    });
  } finally {
    await outra.end();
  }
});

test('T-H104-25 autoridade no banco: sessao inexistente, vencida, revogada, papel sem audit.read e revogacao imediata', async () => {
  await tx(async () => {
    const now = Date.now();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    const financeiro = await staffComPapel('financeiro');
    const segFin = await sessao(financeiro, now);
    const superadmin = await staffComPapel('superadmin');
    const segSup = await sessao(superadmin, now);

    const args = (u, s) => [u, s, new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), null, null, null, 0, 50, new Date(now).toISOString()];
    const sql = 'select private.audit_query($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r';

    // Controle positivo: com sessao valida e audit.read a consulta passa. Sem ele, as negativas seriam vacuas.
    const controle = await consulta(ator, seg, now, { from: new Date(now - HORA).toISOString(), to: new Date(now + HORA).toISOString() });
    assert.ok(controle.consulta_id, 'controle: sessao valida e audit.read passam');
    const antes = await contaConsultas(ator);
    assert.equal(antes, 1, 'controle gravou uma entrada');

    const semSessao = await falha(sql, args(ator, sha('nao-existe')));
    assert.equal(semSessao?.code, 'ADM30', 'sessao inexistente');

    const segVencida = await sessao(ator, now - 9 * HORA);
    const vencida = await falha(sql, args(ator, segVencida));
    assert.equal(vencida?.code, 'ADM30', 'sessao vencida (expires_at antes de now)');

    const segRevogada = await sessao(ator, now);
    await client.query('update app.admin_session set revoked_at = now() where secret_hash = $1', [segRevogada]);
    const revogada = await falha(sql, args(ator, segRevogada));
    assert.equal(revogada?.code, 'ADM30', 'sessao revogada');

    const fin = await falha(sql, args(financeiro, segFin));
    assert.equal(fin?.code, '42501', 'financeiro sem audit.read');
    const sup = await falha(sql, args(superadmin, segSup));
    assert.equal(sup?.code, '42501', 'superadmin nao herda audit.read');

    // Revogacao do unico papel dentro da transacao: a sessao continua valida, mas a proxima chamada cai (ADM30).
    await client.query(
      'update app.admin_user_role set revoked_at = now(), revoked_by = $2 where user_id = $1 and role_code = $3',
      [ator, superadmin, 'auditor'],
    );
    const aposRevogar = await falha(sql, args(ator, seg));
    assert.equal(aposRevogar?.code, 'ADM30', 'papel unico revogado: sem linha na guarda, ADM30 (efeito imediato)');

    // Admin com outro papel ativo: a linha da guarda existe, mas audit.read falta: 42501.
    const dual = await staffComPapel('auditor');
    await papelExtra(dual, 'financeiro');
    const segDual = await sessao(dual, now);
    const controleDual = await consulta(dual, segDual, now, { from: new Date(now - HORA).toISOString(), to: new Date(now + HORA).toISOString() });
    assert.ok(controleDual.consulta_id, 'controle: papel auditor ativo passa antes da revogacao');
    const antesDual = await contaConsultas(dual);
    await client.query(
      'update app.admin_user_role set revoked_at = now(), revoked_by = $2 where user_id = $1 and role_code = $3',
      [dual, superadmin, 'auditor'],
    );
    const dualSemAuditor = await falha(sql, args(dual, segDual));
    assert.equal(dualSemAuditor?.code, '42501', 'outro papel ativo, sem audit.read: 42501');

    // Nenhuma das recusas gravou entrada (so os dois controles).
    assert.equal(await contaConsultas(ator), antes, 'nenhuma entrada nova para o Auditor depois do controle');
    assert.equal(await contaConsultas(financeiro), 0, 'financeiro sem entrada');
    assert.equal(await contaConsultas(dual), antesDual, 'nenhuma entrada nova depois da revogacao');
  });
});

test('T-H104-26 validacao no banco (ADM31): nada e lido nem gravado', async () => {
  await tx(async () => {
    const now = Date.now();
    const win = await janela();
    const ator = await staffComPapel('auditor');
    const seg = await sessao(ator, now);
    const sql = 'select private.audit_query($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r';
    const base = [ator, seg, null, null, null, null, null, 0, 50, new Date(now).toISOString()];
    const casos = {
      periodo_invertido: [new Date(now).toISOString(), new Date(now - HORA).toISOString(), null, null, null, 0, 50],
      acima_do_teto: [new Date(now - 100 * 24 * HORA).toISOString(), new Date(now).toISOString(), null, null, null, 0, 50],
      acao_fora_do_catalogo: [new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), 'nao.existe', null, null, 0, 50],
      object_id_sem_tipo: [new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), null, null, randomUUID(), 0, 50],
      limit_zero: [new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), null, null, null, 0, 0],
      limit_101: [new Date(now - HORA).toISOString(), new Date(now + HORA).toISOString(), null, null, null, 0, 101],
    };
    for (const [nome, [from, to, action, objectType, objectId, after, limit]] of Object.entries(casos)) {
      const err = await falha(sql, [ator, seg, from, to, action, objectType, objectId, after, limit, base[9]]);
      assert.equal(err?.code, 'ADM31', `${nome} deve ser ADM31`);
    }
    assert.equal(await contaConsultas(ator), 0, 'nenhuma entrada gravada pelas recusas');
  });
});

test('T-H104-30 adaptador PgAuditQueryPort: hash do segredo, pagina e entrada na mesma transacao', async () => {
  await tx(async () => {
    const now = Date.now();
    const ator = await staffComPapel('auditor');
    const bruto = randomUUID(); // segredo em claro: so o hash vai ao banco (como a API faz)
    await client.query('select private.admin_session_open($1, $2, $3, $4::timestamptz) as ok', [
      randomUUID(),
      ator,
      sha(bruto),
      new Date(now).toISOString(),
    ]);
    const objeto = randomUUID();
    await semear(randomUUID(), 'consent.changed', 'contact_consent', objeto, {}, { scope: 'x', granted: 'sim' });
    const porta = new PgAuditQueryPort(client);
    const base = {
      actorUserId: ator,
      secret: bruto,
      fromMs: now - HORA,
      toMs: now + HORA,
      action: null,
      objectType: 'contact_consent',
      objectId: objeto,
      cursor: 0,
      limit: 50,
      nowMs: now,
    };

    const pagina = await porta.query(base);
    assert.equal(pagina.eventos.length, 1, 'um evento do objeto semeado');
    assert.equal(pagina.eventos[0].object_id, objeto);
    assert.equal(pagina.tem_mais, false);
    assert.equal(Object.keys(pagina.eventos[0]).length, 12, 'lista fechada de 12 campos');
    assert.equal(pagina.eventos[0].prev_hash, undefined, 'sem prev_hash');
    assert.equal(pagina.eventos[0].row_hash, undefined, 'sem row_hash');
    const n = await client.query(
      "select count(*)::int as n from audit.audit_event where object_type = 'audit_query' and object_id = $1::uuid and action = 'audit.queried'",
      [pagina.consulta_id],
    );
    assert.equal(n.rows[0].n, 1, 'a consulta gravou exatamente uma entrada');

    // Segredo errado: o banco recusa com ADM30 (a API traduz para 404). Savepoint mantem a transacao.
    await client.query('savepoint sp_adapter');
    await assert.rejects(porta.query({ ...base, secret: randomUUID() }), (err) => err.code === 'ADM30');
    await client.query('rollback to savepoint sp_adapter');
    await client.query('release savepoint sp_adapter');
  });
});

/** Chave do contador de consultas (mesma formula da funcao private.audit_query_rate_take). */
const chaveRate = (admin) => sha(`audit_query|${admin}`);

test('T-H104-31 limite atomico no banco (serial): 30 vagas em 5 min, 31a recusada, janela reabre', async () => {
  await tx(async () => {
    const admin = randomUUID();
    const limite = new PgAuditQueryRateLimit(client);
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      assert.equal(await limite.take(admin, now), true, `vaga ${i + 1} concedida`);
    }
    assert.equal(await limite.take(admin, now), false, '31a consulta recusada');
    assert.equal(await limite.take(admin, now + 299_000), false, 'ainda dentro da janela de 5 min');
    assert.equal(await limite.take(admin, now + 301_000), true, 'fora da janela de 5 min, vaga de volta');
    // Outro admin tem o proprio contador.
    assert.equal(await limite.take(randomUUID(), now), true, 'limite e por admin');
  });
});

test('T-H104-32 concorrencia: 64 consultas em 16 conexoes concorrentes deixam passar exatamente 30', async () => {
  const admin = randomUUID();
  const agora = Date.now();
  const conexoes = await Promise.all(Array.from({ length: 16 }, () => connect()));
  try {
    const resultados = await Promise.all(
      conexoes.map(async (c) => {
        const limite = new PgAuditQueryRateLimit(c);
        const saida = [];
        for (let i = 0; i < 4; i++) saida.push(await limite.take(admin, agora));
        return saida;
      }),
    );
    const aceitas = resultados.flat().filter(Boolean).length;
    assert.equal(aceitas, 30, 'exatamente 30 vagas, sem passar do limite sob concorrencia');
    const soma = await client.query(
      'select coalesce(sum(count), 0)::int as n from ops.rate_counter where key_hmac = $1',
      [chaveRate(admin)],
    );
    assert.equal(soma.rows[0].n, 30, 'contador persistido com 30 consumos');
  } finally {
    // Chave sintetica de um admin inexistente: removida ao final (banco de dev compartilhado).
    await client.query('delete from ops.rate_counter where key_hmac = $1', [chaveRate(admin)]);
    await Promise.all(conexoes.map((c) => c.end()));
  }
});

/** Plano do EXPLAIN (texto). Com seqscan desligado so dentro do savepoint: o SET LOCAL volta no rollback. */
async function plano(sql, params, forcarIndice) {
  await client.query('savepoint plano');
  try {
    if (forcarIndice) await client.query('set local enable_seqscan = off');
    const r = await client.query(`explain (format text) ${sql}`, params);
    return r.rows.map((x) => x['QUERY PLAN']).join('\n');
  } finally {
    await client.query('rollback to savepoint plano');
    await client.query('release savepoint plano');
  }
}

test('T-H104-28 plano: consultas por periodo e por acao com volume sintetico (registra o plano padrao)', async () => {
  await tx(async () => {
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        await semear(randomUUID(), 'consent.changed', 'contact_consent', randomUUID(), {}, { scope: 'x', granted: 'sim' });
      } else {
        await semear(randomUUID(), 'review.revised', 'review', randomUUID(), {}, { status: 'ok' }, 'moderacao_ok');
      }
    }
    await client.query('analyze audit.audit_event');
    const de = new Date(now - HORA);
    const ate = new Date(now + HORA);
    const porPeriodo = 'select seq from audit.audit_event where at >= $1 and at < $2 order by seq limit 51';
    const porAcao =
      'select seq from audit.audit_event where action = $1 and at >= $2 and at < $3 order by seq limit 51';
    const pPeriodo = [de, ate];
    const pAcao = ['consent.changed', de, ate];

    // Plano padrao: registrado, sem falhar (o planejador pode escolher outro plano com este volume).
    const padraoPeriodo = await plano(porPeriodo, pPeriodo, false);
    const padraoAcao = await plano(porAcao, pAcao, false);
    console.log(`T-H104-28 plano padrao, periodo:\n${padraoPeriodo}`);
    console.log(`T-H104-28 plano padrao, acao:\n${padraoAcao}`);

    // Com seqscan desligado: prova so que existe um plano por indice. Com este volume o planejador usa o indice
    // de seq (ORDER BY seq + LIMIT), nao os indices novos audit_event_at_idx / audit_event_action_idx; isso e
    // registrado (nao falha) e deve ser reavaliado com volume maior (pendencia da Issue 113).
    const forcadoPeriodo = await plano(porPeriodo, pPeriodo, true);
    const forcadoAcao = await plano(porAcao, pAcao, true);
    console.log(`T-H104-28 plano forcado, periodo:\n${forcadoPeriodo}`);
    console.log(`T-H104-28 plano forcado, acao:\n${forcadoAcao}`);
    assert.match(forcadoPeriodo, /Index (Only )?Scan|Bitmap Index Scan/, 'periodo usa indice');
    assert.match(forcadoAcao, /Index (Only )?Scan|Bitmap Index Scan/, 'acao usa indice');
    console.log(
      `T-H104-28 indices novos usados (periodo/acao): ${/audit_event_at_idx/.test(forcadoPeriodo)}/${/audit_event_action_idx/.test(forcadoAcao)}`,
    );
  });
});
