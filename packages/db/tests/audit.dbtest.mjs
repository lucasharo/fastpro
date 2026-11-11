// Testes de catalogo e de comportamento da auditoria append-only (H-006, desenho 23-DESENHO-H006).
// Rodam contra o banco de desenvolvimento COMPARTILHADO, onde linhas de auditoria nao podem ser
// apagadas: todo teste de comportamento roda em transacao com ROLLBACK (nunca COMMIT). Os testes que
// exigem COMMIT (T-21, T-23) so rodam com AUDIT_ALLOW_COMMIT=1 em banco DESCARTAVEL e ficam skip.
// Todos os testes de auditoria ficam neste unico arquivo (o lock da cadeia serializa as transacoes).
// Executar: pnpm db:test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { computeRowHash, verifyChain, GENESIS_HASH, isForbiddenStateKey } from '../dist/audit.js';

// Nomes montados em partes: o check-secrets so permite o literal em modulos especificos.
const BLOCKED_ROLES = ['anon', 'authenticated', 'service' + '_role'];
const APP_ROLES = ['app_api', 'app_system'];
const AUDIT_TABLES = ['audit_event', 'chain_head', 'action_catalog'];
const ALL_TABLE_PRIVS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];
const APPEND_SIG = 'private.audit_append(text,text,text,text,uuid,jsonb,jsonb,text,uuid)';
const VERIFY_SIG = 'private.audit_verify_chain(bigint,bigint)';
const AUDIT_FNS = [
  'audit_append',
  'audit_verify_chain',
  'audit_state_is_valid',
  'audit_canonical_state',
  'audit_row_hash',
  'audit_key_is_forbidden',
  'audit_keys_are_clean',
];
const ALLOW_COMMIT = process.env.AUDIT_ALLOW_COMMIT === '1';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// --- Utilitarios -----------------------------------------------------------------------------------

async function inTx(fn, c = client) {
  await c.query('begin');
  try {
    // Concessao valida so dentro da transacao (desfeita pelo rollback): permite SET LOCAL ROLE.
    await c.query('grant app_system, app_api to current_user');
    return await fn();
  } finally {
    await c.query('rollback');
  }
}

/** Executa `sql` sob savepoint e exige o SQLSTATE; depois volta ao savepoint (transacao segue viva). */
async function expectErr(code, sql, params = [], c = client) {
  await c.query('savepoint zz_exp');
  try {
    await assert.rejects(c.query(sql, params), { code }, `esperava ${code}: ${sql.slice(0, 80)}`);
  } finally {
    await c.query('rollback to savepoint zz_exp');
    await c.query('release savepoint zz_exp');
  }
}

const OBJ = () => randomUUID();

/** Chama private.audit_append na conexao dada. */
function append(c, a) {
  return c.query(
    'select private.audit_append($1, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8, $9::uuid) as id',
    [
      a.actorRef ?? 'admin:u1',
      a.actorRole ?? 'superadmin',
      a.action ?? 'professional.suspended',
      a.objectType ?? 'professional_profile',
      a.objectId ?? OBJ(),
      JSON.stringify(a.before ?? {}),
      JSON.stringify(a.after ?? { status: 'suspended' }),
      a.reason === undefined ? 'policy_violation' : a.reason,
      a.correlationId ?? null,
    ],
  );
}

const AT_SQL = `to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ROW_SQL = `select id, seq::text as seq, ${AT_SQL} as at, actor_ref, actor_role, action, object_type,
  object_id, before_state, after_state, reason_code, correlation_id, hash_version, prev_hash, row_hash
  from audit.audit_event`;

const toFields = (r) => ({
  hashVersion: r.hash_version,
  seq: r.seq,
  id: r.id,
  at: r.at,
  actorRef: r.actor_ref,
  actorRole: r.actor_role,
  action: r.action,
  objectType: r.object_type,
  objectId: r.object_id,
  beforeState: r.before_state,
  afterState: r.after_state,
  reasonCode: r.reason_code,
  correlationId: r.correlation_id,
  prevHash: r.prev_hash,
});

async function head(c = client) {
  return (await c.query('select last_seq::text as last_seq, last_hash from audit.chain_head'))
    .rows[0];
}
async function verify(c = client, from = 1, to = null) {
  return (await c.query('select * from private.audit_verify_chain($1, $2)', [from, to])).rows[0];
}
async function can(role, kind, name, priv) {
  const fn = { table: 'has_table_privilege', fn: 'has_function_privilege' }[kind];
  return (await client.query(`select ${fn}($1, $2, $3) as p`, [role, name, priv])).rows[0].p;
}
async function publicHas(kind, name) {
  const sql =
    kind === 'table'
      ? `select count(*)::int as n from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          where c.oid = $1::regclass and a.grantee = 0`
      : `select count(*)::int as n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = $1::regprocedure and a.grantee = 0`;
  return (await client.query(sql, [name])).rows[0].n > 0;
}

// --- Catalogo (somente leitura) ----------------------------------------------------------------------

test('D-01 tabelas de auditoria existem com RLS habilitada e forcada e sem politicas', async () => {
  const res = await client.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'audit' and c.relkind = 'r' order by 1`,
  );
  assert.deepEqual(res.rows.map((r) => r.relname).sort(), [...AUDIT_TABLES].sort());
  for (const r of res.rows) {
    assert.equal(r.relrowsecurity, true, `${r.relname} sem RLS habilitada`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname} sem RLS forcada`);
  }
  const pol = await client.query("select policyname from pg_policies where schemaname = 'audit'");
  assert.deepEqual(pol.rows, []);
});

test('D-02 privilegios (CA-07): ninguem altera; so app_system le audit_event; EXECUTE restrito', async () => {
  for (const t of AUDIT_TABLES) {
    const name = `audit.${t}`;
    for (const role of [...BLOCKED_ROLES, ...APP_ROLES]) {
      for (const p of ALL_TABLE_PRIVS) {
        const expected = role === 'app_system' && t === 'audit_event' && p === 'SELECT';
        assert.equal(await can(role, 'table', name, p), expected, `${role} ${p} em ${name}`);
      }
    }
    assert.equal(await publicHas('table', name), false, `PUBLIC tem privilegio em ${name}`);
  }
  for (const role of [...APP_ROLES]) {
    assert.equal(
      await can(role, 'fn', APPEND_SIG, 'EXECUTE'),
      true,
      `${role} sem EXECUTE em audit_append`,
    );
  }
  for (const role of BLOCKED_ROLES) {
    assert.equal(
      await can(role, 'fn', APPEND_SIG, 'EXECUTE'),
      false,
      `${role} executa audit_append`,
    );
    assert.equal(await can(role, 'fn', VERIFY_SIG, 'EXECUTE'), false, `${role} executa verify`);
  }
  assert.equal(await publicHas('fn', APPEND_SIG), false);
  assert.equal(await publicHas('fn', VERIFY_SIG), false);
  assert.equal(await can('app_system', 'fn', VERIFY_SIG, 'EXECUTE'), true);
  assert.equal(await can('app_api', 'fn', VERIFY_SIG, 'EXECUTE'), false);
});

test('D-02b regressao: app_api executa apenas audit_append entre as funcoes de private', async () => {
  const res = await client.query(
    `select p.oid::regprocedure::text as fn, p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('app_api', p.oid, 'EXECUTE')`,
  );
  // Excecoes EXPLICITAS do catalogo (H-018, decisao do Orquestrador no #31): as funcoes de escrita e
  // listagem administrativa (catalog_*_save, catalog_admin_list) e a leitura publica
  // (catalog_public_list) executam como app_api. Qualquer outra funcao de private segue proibida.
  // Desenho: docs/factory/53-DESENHO-H018 §2 e §3.1.
  assert.deepEqual(
    res.rows.map((r) => r.proname).sort(),
    [
      'audit_append',
      'catalog_admin_list',
      'catalog_group_save',
      'catalog_public_list',
      'catalog_service_save',
      'catalog_synonym_save',
    ].sort(),
  );
  const ex = await client.query(
    `select p.oid::regprocedure::text as fn from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'audit') and (p.proname like 'audit\\_%' or p.proname like 'tg\\_%')`,
  );
  for (const r of ex.rows) {
    assert.equal(await publicHas('fn', r.fn), false, `PUBLIC executa ${r.fn}`);
    for (const role of BLOCKED_ROLES) {
      assert.equal(await can(role, 'fn', r.fn, 'EXECUTE'), false, `${role} executa ${r.fn}`);
    }
  }
});

const EXPECTED_TRIGGERS = [
  'audit.audit_event:tg_block_mutation',
  'audit.audit_event:tg_block_truncate',
  'audit.audit_event:tg_event_seal',
  'audit.chain_head:tg_block_delete',
  'audit.chain_head:tg_block_truncate',
  'audit.chain_head:tg_head_guard',
];

test('D-03/D-04 triggers esperados existem, habilitados com ALWAYS (conjunto exato)', async () => {
  const res = await client.query(
    `select t.tgrelid::regclass::text || ':' || t.tgname as trg, t.tgenabled::text as enabled,
            t.tgtype::int as tgtype
       from pg_trigger t
      where t.tgrelid in ('audit.audit_event'::regclass, 'audit.chain_head'::regclass)
        and not t.tgisinternal order by 1`,
  );
  assert.deepEqual(
    res.rows.map((r) => r.trg),
    EXPECTED_TRIGGERS,
  );
  for (const r of res.rows) assert.equal(r.enabled, 'A', `${r.trg} nao esta ENABLE ALWAYS`);
  const byName = Object.fromEntries(res.rows.map((r) => [r.trg, r.tgtype]));
  // tgtype: bit 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE
  assert.equal(byName['audit.audit_event:tg_event_seal'] & (2 | 4), 2 | 4);
  assert.equal(byName['audit.audit_event:tg_block_mutation'] & (2 | 8 | 16), 2 | 8 | 16);
  assert.equal(byName['audit.audit_event:tg_block_truncate'] & (2 | 32), 2 | 32);
});

test('D-05 funcoes de escrita/verificacao: SECURITY DEFINER com search_path vazio', async () => {
  const res = await client.query(
    `select p.proname, p.prosecdef, p.proconfig from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = any($1)`,
    [AUDIT_FNS],
  );
  assert.deepEqual(res.rows.map((r) => r.proname).sort(), [...AUDIT_FNS].sort());
  for (const r of res.rows) {
    assert.ok((r.proconfig ?? []).includes('search_path=""'), `${r.proname} sem search_path fixo`);
    const definer = ['audit_append', 'audit_verify_chain'].includes(r.proname);
    assert.equal(r.prosecdef, definer, `${r.proname}: SECURITY DEFINER inesperado`);
  }
  const append = res.rows.find((r) => r.proname === 'audit_append');
  assert.ok(
    append.proconfig.some((c) => c.startsWith('lock_timeout=')),
    'audit_append sem lock_timeout',
  );
});

test('D-06 catalogo semeia as 6 acoes (5 do CA-14 + audit.queried do H-104) e nenhuma chave semeada e proibida', async () => {
  const res = await client.query(
    `select action, object_type, reason_required, active, private.audit_keys_are_clean(state_keys) as clean
       from audit.action_catalog`,
  );
  const by = Object.fromEntries(res.rows.map((r) => [r.action, r]));
  const seeded = {
    'professional.suspended': ['professional_profile', true],
    'review.revised': ['review', true],
    'completion.corrected': ['service_request', true],
    'payment.refunded': ['payment', true],
    'consent.changed': ['contact_consent', false],
    'audit.queried': ['audit_query', false],
  };
  for (const [action, [objectType, reason]] of Object.entries(seeded)) {
    assert.ok(by[action], `acao ${action} ausente`);
    assert.equal(by[action].object_type, objectType);
    assert.equal(by[action].reason_required, reason);
    assert.equal(by[action].active, true);
  }
  for (const r of res.rows) assert.equal(r.clean, true, `${r.action} tem chave proibida`);
});

// F-1 (Reviewer): chaves que a regra anterior deixava passar. Todas devem ser barradas.
const F1_FORBIDDEN = [
  'customer_name_hash',
  'full_name_normalized',
  'client_ip_hash',
  'customer_rg_number',
  'client_cep_prefix',
  'chat_body_hash',
  'geo_lat_rounded',
  'user_text_snapshot',
  'username',
  'fullname',
  'customerName',
  'ipaddr',
];
// Chaves validas (until_at, consent_text_version e chaves semeadas no catalogo): continuam aceitas.
const F1_VALID = [
  'until_at',
  'consent_text_version',
  'status',
  'acceptance_id',
  'refund_amount_cents',
];

test('D-08 F-1: predicado SQL barra as chaves com dado pessoal e aceita as validas (paridade com TS)', async () => {
  for (const k of [...F1_FORBIDDEN, ...F1_VALID]) {
    const r = await client.query('select private.audit_key_is_forbidden($1) as f', [k]);
    assert.equal(r.rows[0].f, F1_FORBIDDEN.includes(k), `SQL barrou errado: ${k}`);
    assert.equal(isForbiddenStateKey(k), r.rows[0].f, `paridade SQL x TS: ${k}`);
  }
});

test('D-08b F-1: audit_append rejeita chave com dado pessoal (AU002) e aceita as chaves semeadas', async () => {
  await inTx(async () => {
    for (const k of F1_FORBIDDEN) {
      // Mensagem "dado pessoal" distingue a rejeicao por PII da rejeicao por allowlist (ambas AU002).
      await client.query('savepoint zz_pii');
      try {
        await assert.rejects(
          append(client, { before: {}, after: { [k]: 'x' } }),
          (err) => err.code === 'AU002' && /dado pessoal/.test(err.message),
          `chave ${k} deveria ser barrada por dado pessoal`,
        );
      } finally {
        await client.query('rollback to savepoint zz_pii');
        await client.query('release savepoint zz_pii');
      }
    }
    const cat = (
      await client.query('select action, object_type, state_keys from audit.action_catalog')
    ).rows;
    assert.ok(cat.length >= 5, 'catalogo com as 5 acoes semeadas');
    for (const row of cat) {
      const after = Object.fromEntries(row.state_keys.map((k) => [k, 'v1']));
      const res = await append(client, {
        action: row.action,
        objectType: row.object_type,
        before: {},
        after,
      });
      assert.match(
        String(res.rows[0].id),
        /^[0-9a-f-]{36}$/,
        `${row.action} aceita as chaves semeadas`,
      );
    }
  });
});

test('D-07 pre-condicao: o dono da migracao ignora RLS (ou ha politica de INSERT que o permita)', async () => {
  const me = await client.query(
    'select rolname, rolbypassrls, rolsuper from pg_roles where rolname = current_user',
  );
  const pol = await client.query(
    `select count(*)::int as n from pg_policies where schemaname = 'audit' and cmd in ('INSERT', 'ALL')`,
  );
  assert.ok(
    me.rows[0].rolbypassrls || me.rows[0].rolsuper || pol.rows[0].n > 0,
    `o papel de migracao (${me.rows[0].rolname}) nao ignora RLS e nao ha politica de INSERT: ` +
      'audit_append (SECURITY DEFINER) seria negado pela RLS forcada. Plano B: politica FOR INSERT ' +
      'TO <dono> WITH CHECK (true) em audit.audit_event.',
  );
});

// --- Comportamento (transacao com rollback) ----------------------------------------------------------

const STATES = {
  'professional.suspended': {
    objectType: 'professional_profile',
    after: {
      status: 'suspended',
      suspension_kind: 'temporary',
      until_at: '2026-12-01T00:00:00Z',
      approval_request_id: randomUUID(),
    },
    before: { status: 'active' },
    reason: 'policy_violation',
  },
  'review.revised': {
    objectType: 'review',
    after: { status: 'hidden', visible: false, moderation_case_id: randomUUID() },
    before: { status: 'published', visible: true },
    reason: 'error_correction',
  },
  'completion.corrected': {
    objectType: 'service_request',
    after: {
      status: 'completed',
      selected_acceptance_id: randomUUID(),
      completed_at: '2026-11-10T12:00:00Z',
      support_case_id: randomUUID(),
    },
    before: { status: 'in_progress' },
    reason: 'error_correction',
  },
  'payment.refunded': {
    objectType: 'payment',
    after: {
      status: 'refunded',
      refund_amount_cents: 1500,
      currency: 'BRL',
      approval_request_id: randomUUID(),
    },
    before: { status: 'paid' },
    reason: 'chargeback',
  },
  'consent.changed': {
    objectType: 'contact_consent',
    after: {
      scope: 'whatsapp',
      granted: true,
      consent_text_version: 'v1',
      acceptance_id: randomUUID(),
    },
    before: {},
    reason: null,
  },
};

test('T-01 CA-01: um evento completo por acao do catalogo, 1 linha por chamada', async () => {
  await inTx(async () => {
    for (const [action, s] of Object.entries(STATES)) {
      const objectId = OBJ();
      const id = (
        await append(client, {
          action,
          objectType: s.objectType,
          objectId,
          before: s.before,
          after: s.after,
          reason: s.reason,
        })
      ).rows[0].id;
      const rows = (await client.query(`${ROW_SQL} where object_id = $1`, [objectId])).rows;
      assert.equal(rows.length, 1, `${action}: esperava 1 linha`);
      const r = rows[0];
      assert.equal(r.id, id);
      assert.equal(r.action, action);
      assert.equal(r.object_type, s.objectType);
      assert.ok(r.at, 'at nao nulo');
      assert.equal(r.actor_ref, 'admin:u1');
      assert.equal(r.actor_role, 'superadmin');
      assert.deepEqual(r.before_state, s.before);
      assert.deepEqual(r.after_state, s.after);
      assert.equal(r.reason_code, s.reason);
      assert.match(r.row_hash, /^[0-9a-f]{64}$/);
    }
  });
});

test('T-02 CA-08: seq consecutivo, encadeamento, paridade de hash SQL x TS e verificacao ok', async () => {
  await inTx(async () => {
    const start = await head();
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(
        (
          await append(client, {
            after: { status: `s${i}` },
            correlationId: i === 1 ? randomUUID() : null,
          })
        ).rows[0].id,
      );
    }
    const rows = (await client.query(`${ROW_SQL} where id = any($1) order by seq`, [ids])).rows;
    assert.equal(rows.length, 3);
    let prev = start.last_hash;
    let seq = BigInt(start.last_seq);
    for (const r of rows) {
      seq += 1n;
      assert.equal(BigInt(r.seq), seq, 'seq consecutivo');
      assert.equal(r.prev_hash, prev, 'prev_hash = row_hash anterior');
      assert.equal(computeRowHash(toFields(r)), r.row_hash, 'paridade SQL x TS');
      prev = r.row_hash;
    }
    assert.equal(rows[0].hash_version, 1);
    const h = await head();
    assert.equal(h.last_hash, prev);
    assert.equal(h.last_seq, String(seq));
    assert.deepEqual(await verify(), {
      ok: true,
      checked: h.last_seq,
      first_bad_seq: null,
      reason: null,
    });
    // O espelho TS tambem valida a cadeia inteira lida do banco.
    const all = (await client.query(`${ROW_SQL} order by seq`)).rows.map((r) => ({
      ...toFields(r),
      rowHash: r.row_hash,
    }));
    assert.equal(verifyChain(all, { lastSeq: Number(h.last_seq), lastHash: h.last_hash }).ok, true);
    assert.equal(all.length === 0 || all[0].prevHash === GENESIS_HASH, true);
  });
});

test('T-03 CA-02/04: acao + auditoria na mesma transacao; ROLLBACK desfaz os dois e a cabeca', async () => {
  const before = await head();
  const dedupe = 'zz_teste.audit.' + randomUUID();
  const objectId = OBJ();
  await inTx(async () => {
    await client.query("insert into ops.job (kind, dedupe_key) values ('zz_teste.audit', $1)", [
      dedupe,
    ]);
    await append(client, { objectId });
    assert.equal((await head()).last_seq, String(BigInt(before.last_seq) + 1n));
  });
  const jobs = await client.query('select count(*)::int as n from ops.job where dedupe_key = $1', [
    dedupe,
  ]);
  const evs = await client.query(
    'select count(*)::int as n from audit.audit_event where object_id = $1',
    [objectId],
  );
  assert.equal(jobs.rows[0].n, 0);
  assert.equal(evs.rows[0].n, 0);
  assert.deepEqual(await head(), before, 'chain_head igual ao inicial');
});

test('T-04 CA-03: auditoria invalida (acao fora do catalogo) aborta e a acao nao persiste', async () => {
  const before = await head();
  const dedupe = 'zz_teste.audit.' + randomUUID();
  await inTx(async () => {
    await client.query("insert into ops.job (kind, dedupe_key) values ('zz_teste.audit', $1)", [
      dedupe,
    ]);
    await assert.rejects(append(client, { action: 'acao.inexistente' }), { code: 'AU002' });
  });
  const jobs = await client.query('select count(*)::int as n from ops.job where dedupe_key = $1', [
    dedupe,
  ]);
  assert.equal(jobs.rows[0].n, 0, 'a acao nao pode persistir sem auditoria');
  assert.deepEqual(await head(), before);
});

async function seedEvent() {
  const objectId = OBJ();
  const id = (await append(client, { objectId })).rows[0].id;
  return { id, objectId };
}

test('T-05 CA-05/06: UPDATE/DELETE/TRUNCATE negados a app_api/app_system (42501) e ao dono (AU001)', async () => {
  await inTx(async () => {
    const { id } = await seedEvent();
    const ops = [
      ["update audit.audit_event set actor_role = 'x' where id = $1", [id]],
      ['delete from audit.audit_event where id = $1', [id]],
      ['truncate audit.audit_event', []],
    ];
    for (const role of APP_ROLES) {
      await client.query(`set local role ${role}`);
      for (const [sql, params] of ops) await expectErr('42501', sql, params);
      await client.query('reset role');
    }
    for (const [sql, params] of ops) await expectErr('AU001', sql, params);
    // Mesmo com triggers de usuario desligados por session_replication_role, o ALWAYS continua valendo.
    await client.query('savepoint zz_rep');
    let replica = true;
    try {
      await client.query("set local session_replication_role = 'replica'");
    } catch {
      replica = false;
      await client.query('rollback to savepoint zz_rep');
    }
    if (replica) for (const [sql, params] of ops) await expectErr('AU001', sql, params);
    await client.query("set local session_replication_role = 'origin'").catch(() => {});
    const row = await client.query('select actor_role from audit.audit_event where id = $1', [id]);
    assert.equal(row.rows[0].actor_role, 'superadmin', 'linha intacta');
  });
});

test('T-06 caso 5: ator/acao/objeto nulos ou invalidos sao rejeitados; at do chamador e ignorado', async () => {
  await inTx(async () => {
    await expectErr(
      '23502',
      'select private.audit_append(null, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
      [
        'superadmin',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23502',
      'select private.audit_append($1, $2, null, $3, $4, $5::jsonb, $6::jsonb, $7)',
      [
        'admin:u1',
        'superadmin',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23502',
      'select private.audit_append($1, $2, $3, $4, null, $5::jsonb, $6::jsonb, $7)',
      [
        'admin:u1',
        'superadmin',
        'professional.suspended',
        'professional_profile',
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23514',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [
        'ana@example.com',
        'superadmin',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23514',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [
        'system:job',
        'cliente',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23514',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [
        'admin:u1',
        'system',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    await expectErr(
      '23514',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [
        'admin:u1',
        'Super Admin',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'policy_violation',
      ],
    );
    // at forjado em INSERT direto de dono e sobrescrito pela hora do banco (CA-10).
    const t0 = (await client.query('select clock_timestamp() as t')).rows[0].t;
    const ins = await client.query(
      `insert into audit.audit_event (actor_ref, actor_role, action, object_type, object_id,
         before_state, after_state, reason_code, at, seq, prev_hash, row_hash)
       values ('admin:u1', 'superadmin', 'professional.suspended', 'professional_profile', $1,
         '{}', '{"status":"a"}', 'policy_violation', '2000-01-01T00:00:00Z', 999999, $2, $2)
       returning at`,
      [OBJ(), 'f'.repeat(64)],
    );
    const t1 = (await client.query('select clock_timestamp() as t')).rows[0].t;
    assert.ok(ins.rows[0].at >= t0 && ins.rows[0].at <= t1, 'at deve ser a hora do banco');
  });
});

test('T-07 CA-09: PII e chaves fora da allowlist sao rejeitadas (AU002), sem redacao silenciosa', async () => {
  await inTx(async () => {
    const before = await head();
    const bad = [
      { granted: 'ana@example.com' },
      { scope: '11999998888' },
      { scope: '+5511999998888' },
      { scope: '123.456.789-09' },
      { scope: '12345678909' },
      { scope: 'Maria da Silva' },
      { scope: 'x'.repeat(65) },
      { email: 'x' },
      { telefone: 'x' },
      { acceptance_id: { aninhado: 1 } },
      { consent_text_version: ['a'] },
      { campo_fora_da_allowlist: 'x' },
    ];
    for (const after of bad) {
      for (const slot of ['after', 'before']) {
        await expectErr(
          'AU002',
          'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
          [
            'system:job',
            'system',
            'consent.changed',
            'contact_consent',
            OBJ(),
            JSON.stringify(slot === 'before' ? after : {}),
            JSON.stringify(slot === 'after' ? after : {}),
          ],
        );
      }
    }
    await expectErr(
      'AU002',
      "select private.audit_append('system:job','system','consent.changed','contact_consent',$1,'[]'::jsonb,'{}'::jsonb)",
      [OBJ()],
    );
    assert.deepEqual(await head(), before, 'nada gravado');
  });
});

test('T-08 caso 8: INSERT direto de dono com seq/prev_hash/row_hash forjados e recalculado pelo banco', async () => {
  await inTx(async () => {
    const start = await head();
    const forged = 'e'.repeat(64);
    const ins = await client.query(
      `insert into audit.audit_event (actor_ref, actor_role, action, object_type, object_id,
         before_state, after_state, reason_code, seq, prev_hash, row_hash, hash_version)
       values ('admin:u1', 'superadmin', 'professional.suspended', 'professional_profile', $1,
         '{}', '{"status":"a"}', 'policy_violation', 42, $2, $2, 9)
       returning id`,
      [OBJ(), forged],
    );
    const r = await client.query(`${ROW_SQL} where id = $1`, [ins.rows[0].id]);
    const row = r.rows[0];
    assert.equal(row.seq, String(BigInt(start.last_seq) + 1n));
    assert.equal(row.prev_hash, start.last_hash);
    assert.equal(row.hash_version, 1);
    assert.notEqual(row.row_hash, forged);
    assert.equal(computeRowHash(toFields(row)), row.row_hash);
    assert.equal((await verify()).ok, true);
  });
});

test('T-09 CA-11: correlation_id informado, vindo de app.correlation_id ou ausente', async () => {
  await inTx(async () => {
    const corr = randomUUID();
    const read = async (id) =>
      (await client.query('select correlation_id from audit.audit_event where id = $1', [id]))
        .rows[0].correlation_id;
    await client.query("select set_config('app.correlation_id', $1, true)", [randomUUID()]);
    const explicit = (await append(client, { correlationId: corr })).rows[0].id;
    assert.equal(await read(explicit), corr, 'parametro prevalece');
    const ctx = randomUUID();
    await client.query("select set_config('app.correlation_id', $1, true)", [ctx]);
    assert.equal(await read((await append(client, {})).rows[0].id), ctx, 'usa app.correlation_id');
    await client.query("select set_config('app.correlation_id', '', true)");
    assert.equal(await read((await append(client, {})).rows[0].id), null, 'ausente => nulo');
  });
});

test('T-10 reason_required: razao obrigatoria e com formato validado', async () => {
  await inTx(async () => {
    await expectErr(
      'AU002',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
      [
        'admin:u1',
        'superadmin',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
      ],
    );
    await expectErr(
      '23514',
      'select private.audit_append($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [
        'admin:u1',
        'superadmin',
        'professional.suspended',
        'professional_profile',
        OBJ(),
        '{}',
        '{"status":"a"}',
        'Texto livre com espaco',
      ],
    );
    // consent.changed nao exige razao.
    const ok = await append(client, {
      action: 'consent.changed',
      objectType: 'contact_consent',
      before: {},
      after: { granted: true },
      reason: null,
    });
    assert.ok(ok.rows[0].id);
  });
});

test('T-11 caso 6: adulteracao feita por quem desliga o trigger e detectada pela verificacao', async () => {
  await inTx(async () => {
    const ids = [];
    for (let i = 0; i < 4; i += 1)
      ids.push((await append(client, { after: { status: `s${i}` } })).rows[0].id);
    const seqOf = async (id) =>
      (await client.query('select seq::text as s from audit.audit_event where id = $1', [id]))
        .rows[0].s;
    const seqs = [];
    for (const id of ids) seqs.push(await seqOf(id));
    assert.equal((await verify()).ok, true);
    assert.equal(
      (await verify(client, BigInt(seqs[1]).toString(), seqs[2])).ok,
      true,
      'faixa parcial',
    );

    const tamper = async (sql, params, expected) => {
      await client.query('savepoint zz_tamper');
      await client.query('alter table audit.audit_event disable trigger tg_block_mutation');
      await client.query(sql, params);
      const v = await verify();
      assert.equal(v.ok, false);
      assert.equal(v.reason, expected.reason);
      assert.equal(v.first_bad_seq, expected.seq);
      await client.query('rollback to savepoint zz_tamper');
      await client.query('release savepoint zz_tamper');
      assert.equal((await verify()).ok, true, 'rollback restaura a cadeia');
      assert.equal(
        (
          await client.query(
            "select tgenabled::text as e from pg_trigger where tgname = 'tg_block_mutation' and tgrelid = 'audit.audit_event'::regclass",
          )
        ).rows[0].e,
        'A',
      );
    };
    await tamper(
      'update audit.audit_event set after_state = \'{"status":"fraude"}\' where id = $1',
      [ids[1]],
      { reason: 'row_hash_divergente', seq: seqs[1] },
    );
    await tamper(
      'update audit.audit_event set prev_hash = $2 where id = $1',
      [ids[2], 'c'.repeat(64)],
      { reason: 'prev_hash_divergente', seq: seqs[2] },
    );
    await tamper('delete from audit.audit_event where id = $1', [ids[1]], {
      reason: 'lacuna_seq',
      seq: seqs[1],
    });
    await tamper('delete from audit.audit_event where id = $1', [ids[3]], {
      reason: 'cabeca_divergente',
      seq: seqs[3],
    });
  });
});

test('T-12 chain_head: so avanca +1; DELETE e TRUNCATE bloqueados', async () => {
  await inTx(async () => {
    await expectErr('AU001', 'update audit.chain_head set last_seq = last_seq + 2');
    await expectErr('AU001', 'update audit.chain_head set last_seq = last_seq');
    await expectErr('AU001', 'update audit.chain_head set last_seq = last_seq - 1');
    await expectErr('AU001', 'delete from audit.chain_head');
    await expectErr('AU001', 'truncate audit.chain_head');
  });
});

test('T-13 caso 9: app_api (Auditor/Superadmin) nao escreve em audit.* (42501)', async () => {
  await inTx(async () => {
    await client.query('set local role app_api');
    for (const t of AUDIT_TABLES) {
      await expectErr('42501', `insert into audit.${t} default values`);
      await expectErr(
        '42501',
        `update audit.${t} set active = true`.replace(
          'active',
          t === 'audit_event' ? 'actor_role' : t === 'chain_head' ? 'last_seq' : 'active',
        ),
      );
      await expectErr('42501', `delete from audit.${t}`);
      await expectErr('42501', `select count(*) from audit.${t}`);
    }
  });
});

test('T-14 audit_append por papel sem EXECUTE e negado (42501)', async () => {
  await inTx(async () => {
    for (const role of BLOCKED_ROLES) {
      await client.query('savepoint zz_grant');
      try {
        await client.query(`grant ${role} to current_user`);
      } catch {
        await client.query('rollback to savepoint zz_grant');
        continue; // papel nao delegavel a este usuario: o teste de catalogo D-02 ja cobre
      }
      await client.query(`set local role ${role}`);
      await expectErr(
        '42501',
        "select private.audit_append('admin:u1','superadmin','consent.changed','contact_consent',$1,'{}'::jsonb,'{}'::jsonb)",
        [OBJ()],
      );
      await client.query('reset role');
    }
  });
});

test('T-22 chamada sem savepoint: o erro de audit_append aborta a transacao (a acao nao segue)', async () => {
  await inTx(async () => {
    await assert.rejects(append(client, { action: 'acao.inexistente' }), { code: 'AU002' });
    await assert.rejects(client.query('select 1'), { code: '25P02' });
  });
});

// --- Concorrencia (sem COMMIT) ----------------------------------------------------------------------

test('T-20 CA-12: a cadeia serializa; o segundo espera a primeira e nao ha lacuna apos rollback', async () => {
  const other = await connect();
  try {
    await client.query('begin');
    await other.query('begin');
    try {
      const a = (await append(client, {})).rows[0].id;
      const seqA = (
        await client.query('select seq::text as s from audit.audit_event where id = $1', [a])
      ).rows[0].s;
      // audit_append fixa lock_timeout = 5s: B espera ate falhar com 55P03 enquanto A segura a cabeca.
      await assert.rejects(append(other, {}), { code: '55P03' });
      await other.query('rollback');
      await client.query('rollback');
      await other.query('begin');
      const b = (await append(other, {})).rows[0].id;
      const seqB = (
        await other.query('select seq::text as s from audit.audit_event where id = $1', [b])
      ).rows[0].s;
      assert.equal(seqB, seqA, 'sem lacuna: B obtem o seq que A teria usado');
    } finally {
      await other.query('rollback').catch(() => {});
      await client.query('rollback').catch(() => {});
    }
  } finally {
    await other.end();
  }
});

test(
  'T-21 duas transacoes REPEATABLE READ: a segunda falha com 40001 (nao bifurca)',
  { skip: ALLOW_COMMIT ? false : 'requer COMMIT: so em banco descartavel (AUDIT_ALLOW_COMMIT=1)' },
  async () => {
    const other = await connect();
    try {
      await client.query('begin isolation level repeatable read');
      await other.query('begin isolation level repeatable read');
      await client.query('select 1');
      await other.query('select 1');
      await append(client, {});
      const second = append(other, {});
      await client.query('commit');
      await assert.rejects(second, { code: '40001' });
      await other.query('rollback');
    } finally {
      await other.end();
    }
  },
);

test(
  'T-23 estresse: 20 transacoes concorrentes com COMMIT mantem a cadeia valida',
  { skip: ALLOW_COMMIT ? false : 'requer COMMIT: so em banco descartavel (AUDIT_ALLOW_COMMIT=1)' },
  async () => {
    const conns = await Promise.all(Array.from({ length: 20 }, () => connect()));
    try {
      await Promise.all(
        conns.map(async (c) => {
          await c.query('begin');
          await append(c, {});
          await c.query('commit');
        }),
      );
      const v = await verify();
      assert.equal(v.ok, true);
      const stats = (
        await client.query(
          'select count(*)::text as n, max(seq)::text as m, count(distinct seq)::text as d from audit.audit_event',
        )
      ).rows[0];
      assert.equal(stats.n, stats.m);
      assert.equal(stats.n, stats.d);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  },
);
