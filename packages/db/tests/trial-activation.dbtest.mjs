// H-044 (Issue 57) | Provas de banco da ativacao do trial (docs/factory/135-DESENHO-H044.md, §6, T-01 a T-15, T-18).
// Roda no DEV ja migrado (20261113270000). Cada teste roda numa transacao e desfaz tudo no fim: o livro nao aceita
// DELETE nem TRUNCATE, entao nada commitado pode ser removido. Dados sinteticos (@example.test, sufixo aleatorio).
// Sem rede, sem provedor externo, sem relogio do banco: todos os instantes sao explicitos.
// A concorrencia entre duas conexoes fica em arquivo proprio (trial-activation-concorrencia.dbtest.mjs).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/trial-activation.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { connect } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const SEG = 1000;
const HORA = 60 * 60 * SEG;
const DIA = 24 * HORA;
const T0 = Date.parse('2030-01-01T12:00:00.000Z');
const TRIAL = 14 * DIA;
const iso = (ms) => new Date(ms).toISOString();
const SUF = randomUUID().slice(0, 8);
const ROLE_SERVICE = ['service', 'role'].join('_');
const ROLE_NEGADOS = ['anon', 'authenticated', ROLE_SERVICE, 'app_api'];
const ASSINATURA_TRIAL = 'private.trial_activate(uuid,text,timestamptz,uuid)';
const ASSINATURA_DERIVACAO = 'private.identity_id_from_document_hmac(text)';

/** Transacao de teste: tudo que a prova grava some no rollback. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Erro esperado dentro de savepoint: devolve o erro e mantem a transacao utilizavel. */
async function erroEm(sql, params = []) {
  await client.query('savepoint sp_erro');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint sp_erro');
    return err;
  }
  await client.query('release savepoint sp_erro');
  return null;
}

const hex64 = () => randomBytes(32).toString('hex');

/** Perfil sintetico. Aprovado por padrao; hmac null para testar o caso sem documento. */
async function perfil({ status = 'aprovada', hmac = hex64() } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `h044-${id.slice(0, 8)}-${SUF}@example.test`, randomUUID()],
  );
  const comDocumento = hmac !== null;
  await client.query(
    `insert into app.professional_profile
       (user_id, verification_status, public_name, slug, document_type, document_enc, document_hmac, verified_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [
      id,
      status,
      comDocumento ? 'Nome Sintetico' : null,
      comDocumento ? `h044-slug-${randomUUID()}` : null,
      comDocumento ? 'CPF' : null,
      comDocumento ? Buffer.from(`blob-${randomUUID()}`) : null,
      hmac,
      status === 'aprovada' ? new Date().toISOString() : null,
    ],
  );
  return { id, hmac };
}

/** Chamada da funcao de ativacao, com relogio explicito. */
async function ativar(pro, { now = T0, corr = null } = {}) {
  const r = await client.query(
    `select out_code, out_grant_id, out_starts_at, out_ends_at
       from private.trial_activate($1::uuid, $2::text, $3::timestamptz, $4::uuid)`,
    [pro, `professional:${pro}`, iso(now), corr],
  );
  return r.rows[0];
}

async function trials(pro) {
  const r = await client.query(
    `select type, status, starts_at, ends_at, source_payment_id
       from billing.access_grant where professional_id = $1 and type = 'trial' order by starts_at`,
    [pro],
  );
  return r.rows;
}

async function contaTrialsDaIdentidade(hmac) {
  const r = await client.query(
    `select count(*)::int as n from billing.access_grant
      where identity_id = private.identity_id_from_document_hmac($1) and type = 'trial'`,
    [hmac],
  );
  return r.rows[0].n;
}

async function estadoEm(pro, instante) {
  const r = await client.query('select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)', [
    pro,
    iso(instante),
  ]);
  return r.rows[0];
}

/** Concessao paga sintetica (fixture direta, na transacao). */
async function pagoSintetico(pro, { starts, ends }) {
  await client.query(
    `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id, status)
     values ($1, $2, 'paid', $3, $4, $5, 'ativa')`,
    [pro, randomUUID(), iso(starts), iso(ends), randomUUID()],
  );
}

// ---------------------------------------------------------------- T-07 derivacao ---

test('T-07 derivacao: mesma entrada gera o mesmo uuid; entradas diferentes geram uuids diferentes', async () => {
  await tx(async () => {
    const h = hex64();
    const outro = hex64();
    const a = await client.query(`select private.identity_id_from_document_hmac($1)::text as v`, [h]);
    const b = await client.query(`select private.identity_id_from_document_hmac($1)::text as v`, [h]);
    const c = await client.query(`select private.identity_id_from_document_hmac($1)::text as v`, [outro]);
    assert.equal(a.rows[0].v, b.rows[0].v);
    assert.notEqual(a.rows[0].v, c.rows[0].v);
  });
});

test('T-07 derivacao: valor igual ao calculo independente (sha256 do prefixo v1 mais HMAC, 128 bits)', async () => {
  await tx(async () => {
    const h = hex64();
    const esperado = createHash('sha256').update(`fastpro:identity:v1:${h}`, 'utf8').digest().subarray(0, 16).toString('hex');
    const r = await client.query(`select private.identity_id_from_document_hmac($1)::text as v`, [h]);
    assert.equal(r.rows[0].v.replace(/-/g, ''), esperado);
  });
});

test('T-07 derivacao: entrada fora de 64 hexadecimais minusculos levanta 22023', async () => {
  await tx(async () => {
    const invalidas = ['', 'abc', hex64().toUpperCase(), `${hex64()}0`, 'g'.repeat(64)];
    for (const entrada of invalidas) {
      const err = await erroEm(`select private.identity_id_from_document_hmac($1)`, [entrada]);
      assert.ok(err, `entrada aceita indevidamente: ${entrada.length} caracteres`);
      assert.equal(err.code, '22023');
    }
  });
});

test('T-07 derivacao: imutavel e estrita, executada so pelo dono (sem grant aos papeis de aplicacao)', async () => {
  await tx(async () => {
    const r = await client.query(
      `select p.provolatile, p.proisstrict from pg_proc p where p.oid = $1::regprocedure`,
      [ASSINATURA_DERIVACAO],
    );
    assert.equal(r.rows[0].provolatile, 'i');
    assert.equal(r.rows[0].proisstrict, true);
    for (const role of [...ROLE_NEGADOS, 'app_system']) {
      const q = await client.query(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`, [role, ASSINATURA_DERIVACAO]);
      assert.equal(q.rows[0].ok, false, `papel ${role} nao devia executar a derivacao`);
    }
  });
});

// ---------------------------------------------------------------- T-18 estatico ---

test('T-18 estatico: trial_activate security definer, search_path vazio, execute so app_system, sem INSERT direto', async () => {
  await tx(async () => {
    const r = await client.query(
      `select p.prosecdef, p.provolatile, p.proconfig from pg_proc p where p.oid = $1::regprocedure`,
      [ASSINATURA_TRIAL],
    );
    assert.equal(r.rows[0].prosecdef, true);
    assert.equal(r.rows[0].provolatile, 'v');
    assert.ok(r.rows[0].proconfig.includes('search_path=""'), `search_path: ${r.rows[0].proconfig}`);
    const app = await client.query(`select has_function_privilege('app_system', $1::regprocedure, 'EXECUTE') as ok`, [ASSINATURA_TRIAL]);
    assert.equal(app.rows[0].ok, true);
    for (const role of ROLE_NEGADOS) {
      const q = await client.query(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`, [role, ASSINATURA_TRIAL]);
      assert.equal(q.rows[0].ok, false, `papel ${role} nao devia executar a ativacao`);
    }
    for (const role of ['app_system', 'app_api', ...ROLE_NEGADOS]) {
      const q = await client.query(`select has_table_privilege($1, 'billing.access_grant', 'INSERT') as ok`, [role]);
      assert.equal(q.rows[0].ok, false, `papel ${role} nao devia ter INSERT em access_grant`);
    }
  });
});

test('T-18 estatico: catalogo de auditoria tem as duas acoes de trial', async () => {
  await tx(async () => {
    const r = await client.query(
      `select action, object_type, reason_required from audit.action_catalog where action like 'billing.trial.%' order by action`,
    );
    assert.deepEqual(r.rows, [
      { action: 'billing.trial.activated', object_type: 'access_grant', reason_required: false },
      { action: 'billing.trial.denied', object_type: 'professional_profile', reason_required: true },
    ]);
  });
});

// ---------------------------------------------------------------- T-01 a T-03 aprovacao ---

test('T-01: perfis nao aprovados, sem documento ou inexistentes devolvem not_verified sem gravar nada', async () => {
  await tx(async () => {
    const antes = await client.query('select count(*)::int as n from billing.access_grant');
    for (const status of ['pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'suspensa']) {
      const p = await perfil({ status });
      const r = await ativar(p.id);
      assert.equal(r.out_code, 'not_verified', `estado ${status}`);
      assert.equal(r.out_grant_id, null);
    }
    const semDocumento = await perfil({ status: 'aprovada', hmac: null });
    assert.equal((await ativar(semDocumento.id)).out_code, 'not_verified');
    assert.equal((await ativar(randomUUID())).out_code, 'not_verified');
    const depois = await client.query('select count(*)::int as n from billing.access_grant');
    assert.equal(depois.rows[0].n, antes.rows[0].n);
  });
});

test('T-03: aprovacao e leitura de acesso comercial nao criam trial', async () => {
  await tx(async () => {
    const p = await perfil();
    await estadoEm(p.id, T0);
    assert.equal((await trials(p.id)).length, 0);
  });
});

// ---------------------------------------------------------------- T-02 ativacao ---

test('T-02: perfil aprovado ativa exatamente um trial de 336 horas sem pagamento', async () => {
  await tx(async () => {
    const p = await perfil();
    const r = await ativar(p.id);
    assert.equal(r.out_code, 'ok');
    assert.ok(r.out_grant_id);
    assert.equal(new Date(r.out_starts_at).getTime(), T0);
    assert.equal(new Date(r.out_ends_at).getTime(), T0 + TRIAL);
    const linhas = await trials(p.id);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].type, 'trial');
    assert.equal(linhas[0].status, 'ativa');
    assert.equal(new Date(linhas[0].starts_at).getTime(), T0);
    assert.equal(new Date(linhas[0].ends_at).getTime(), T0 + TRIAL);
    assert.equal(linhas[0].source_payment_id, null);
  });
});

// ---------------------------------------------------------------- T-05, T-06 unicidade ---

test('T-05: segunda ativacao da mesma identidade devolve trial_used sem nova linha', async () => {
  await tx(async () => {
    const p = await perfil();
    assert.equal((await ativar(p.id)).out_code, 'ok');
    const r = await ativar(p.id, { now: T0 + HORA });
    assert.equal(r.out_code, 'trial_used');
    assert.equal(r.out_grant_id, null);
    assert.equal((await trials(p.id)).length, 1);
  });
});

test('T-06a: trial revogado nao reabre trial para a mesma identidade', async () => {
  await tx(async () => {
    const p = await perfil();
    const ok = await ativar(p.id);
    await client.query(
      `select private.access_grant_revoke($1::uuid, $2::text, $3::text, $4::text, null)`,
      [ok.out_grant_id, 'admin:h044teste', 'admin', 'teste_h044'],
    );
    const r = await ativar(p.id, { now: T0 + HORA });
    assert.equal(r.out_code, 'trial_used');
    assert.equal((await trials(p.id)).length, 1);
  });
});

test('T-06b: trial vencido nao reabre trial para a mesma identidade', async () => {
  await tx(async () => {
    const p = await perfil();
    await ativar(p.id);
    const r = await ativar(p.id, { now: T0 + TRIAL + 5 * DIA });
    assert.equal(r.out_code, 'trial_used');
    assert.equal((await trials(p.id)).length, 1);
  });
});

test('T-06c: segundo perfil com o mesmo documento tem o mesmo identity_id e recebe trial_used', async () => {
  await tx(async () => {
    // O primeiro perfil foi recusado depois de ter trial (estado so muda pela decisao de H-039; aqui o trial
    // entra por fixture direta do dono, como nas demais provas do livro). O segundo, aprovado, tem o mesmo documento.
    const h = hex64();
    const primeiro = await perfil({ status: 'recusada', hmac: h });
    await client.query(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
       values ($1, private.identity_id_from_document_hmac($2), 'trial', $3, $4, 'ativa')`,
      [primeiro.id, h, iso(T0), iso(T0 + TRIAL)],
    );
    const segundo = await perfil({ hmac: h });
    const r = await ativar(segundo.id);
    assert.equal(r.out_code, 'trial_used');
    assert.equal(await contaTrialsDaIdentidade(h), 1);
    assert.equal((await trials(segundo.id)).length, 0);
  });
});

// ---------------------------------------------------------------- T-09 a T-12 vencimento ---

test('T-09 a T-12: trial vigente, vencido e nunca carencia; access_until e limites exatos', async () => {
  await tx(async () => {
    const p = await perfil();
    const ok = await ativar(p.id);
    const fim = new Date(ok.out_ends_at).getTime();
    assert.equal((await estadoEm(p.id, T0 + SEG)).estado, 'trial_ativo');
    const logoDepois = await estadoEm(p.id, T0 + SEG);
    assert.equal(new Date(logoDepois.access_until).getTime(), fim);
    assert.equal((await estadoEm(p.id, fim - SEG)).estado, 'trial_ativo');
    assert.equal((await estadoEm(p.id, fim)).estado, 'trial_expirado');
    for (const extra of [HORA, 72 * HORA]) {
      assert.equal((await estadoEm(p.id, fim + extra)).estado, 'trial_expirado', `em +${extra} ms`);
    }
    assert.equal((await client.query(`select count(*)::int as n from billing.access_grant where professional_id = $1 and type = 'paid'`, [p.id])).rows[0].n, 0);
    assert.equal((await client.query(`select count(*)::int as n from billing.subscription where professional_id = $1`, [p.id])).rows[0].n, 0);
  });
});

// ---------------------------------------------------------------- T-13 acesso pago ---

test('T-13: pago vigente, cancelado com acesso e em carencia negam o trial sem gravar', async () => {
  await tx(async () => {
    const ativa = await perfil();
    await pagoSintetico(ativa.id, { starts: T0 - DIA, ends: T0 + 29 * DIA });
    assert.equal((await ativar(ativa.id)).out_code, 'paid_access_active');

    const cancelada = await perfil();
    await pagoSintetico(cancelada.id, { starts: T0 - DIA, ends: T0 + 29 * DIA });
    await client.query(
      `insert into billing.subscription (professional_id, cancel_at_period_end, canceled_at) values ($1, true, $2)`,
      [cancelada.id, iso(T0 - HORA)],
    );
    assert.equal((await ativar(cancelada.id)).out_code, 'paid_access_active');

    const carencia = await perfil();
    await pagoSintetico(carencia.id, { starts: T0 - 30 * DIA, ends: T0 - HORA });
    assert.equal((await estadoEm(carencia.id, T0)).estado, 'em_carencia');
    assert.equal((await ativar(carencia.id)).out_code, 'paid_access_active');

    for (const p of [ativa, cancelada, carencia]) {
      assert.equal((await trials(p.id)).length, 0);
    }
  });
});

test('T-13: ex-pagante com acesso expirado pode ativar o trial (pergunta 533, opcao a)', async () => {
  await tx(async () => {
    const p = await perfil();
    await pagoSintetico(p.id, { starts: T0 - 60 * DIA, ends: T0 - 100 * HORA });
    assert.equal((await estadoEm(p.id, T0)).estado, 'expirada');
    assert.equal((await ativar(p.id)).out_code, 'ok');
  });
});

test('T-13: ordem dos codigos: trial ja usado vence acesso pago vigente (trial_used antes de paid_access_active)', async () => {
  await tx(async () => {
    const h = hex64();
    const p = await perfil({ hmac: h });
    assert.equal((await ativar(p.id)).out_code, 'ok');
    await pagoSintetico(p.id, { starts: T0 - DIA, ends: T0 + 29 * DIA });
    assert.equal((await ativar(p.id, { now: T0 + HORA })).out_code, 'trial_used');
  });
});

// ---------------------------------------------------------------- T-15 auditoria e falha ---

test('T-15: sucesso grava billing.trial.activated; trial_used grava billing.trial.denied com motivo trial_used', async () => {
  await tx(async () => {
    const p = await perfil();
    const ok = await ativar(p.id, { corr: randomUUID() });
    const act = await client.query(
      `select actor_ref, actor_role, object_type, object_id, after_state from audit.audit_event
        where action = 'billing.trial.activated' and object_id = $1`,
      [ok.out_grant_id],
    );
    assert.equal(act.rows.length, 1);
    assert.equal(act.rows[0].actor_ref, `professional:${p.id}`);
    assert.equal(act.rows[0].actor_role, 'profissional');
    assert.equal(act.rows[0].object_type, 'access_grant');
    const estado = act.rows[0].after_state;
    assert.deepEqual(Object.keys(estado).sort(), ['ends_at', 'starts_at', 'status', 'type']);
    assert.ok(!JSON.stringify(estado).includes('@'));
    assert.ok(!JSON.stringify(estado).includes(p.hmac));

    await ativar(p.id, { now: T0 + HORA });
    const den = await client.query(
      `select reason_code, object_type, object_id from audit.audit_event
        where action = 'billing.trial.denied' and object_id = $1`,
      [p.id],
    );
    assert.equal(den.rows.length, 1);
    assert.equal(den.rows[0].reason_code, 'trial_used');
    assert.equal(den.rows[0].object_type, 'professional_profile');
  });
});

test('T-15: negacoes not_verified e paid_access_active nao geram evento de auditoria', async () => {
  await tx(async () => {
    const naoVerificado = await perfil({ status: 'pendente' });
    await ativar(naoVerificado.id);
    const pago = await perfil();
    await pagoSintetico(pago.id, { starts: T0 - DIA, ends: T0 + 29 * DIA });
    await ativar(pago.id);
    const n = await client.query(
      `select count(*)::int as n from audit.audit_event
        where action like 'billing.trial.%' and object_id = any($1::uuid[])`,
      [[naoVerificado.id, pago.id]],
    );
    assert.equal(n.rows[0].n, 0);
  });
});

test('T-15: falha da auditoria desfaz o trial (nenhuma linha gravada)', async () => {
  await tx(async () => {
    const p = await perfil();
    const err = await erroEm(
      `select out_code from private.trial_activate($1::uuid, 'x y', $2::timestamptz, null)`,
      [p.id, iso(T0)],
    );
    assert.ok(err, 'a auditoria com ator invalido devia falhar');
    assert.equal((await trials(p.id)).length, 0);
  });
});

test('T-15: parametro nulo levanta 22023 (falha tecnica, nunca codigo de negocio)', async () => {
  await tx(async () => {
    const err = await erroEm(`select out_code from private.trial_activate(null, 'professional:x', $1::timestamptz, null)`, [iso(T0)]);
    assert.ok(err);
    assert.equal(err.code, '22023');
  });
});

// ---------------------------------------------------------------- T-14 (banco) ---

test('T-14: resultado da ativacao expoe so codigo e datas (sem identidade, documento ou grant em texto)', async () => {
  await tx(async () => {
    const p = await perfil();
    const r = await ativar(p.id);
    const texto = JSON.stringify(r);
    assert.ok(!texto.includes(p.hmac));
    assert.ok(!texto.includes('@example.test'));
    assert.deepEqual(Object.keys(r).sort(), ['out_code', 'out_ends_at', 'out_grant_id', 'out_starts_at']);
  });
});
