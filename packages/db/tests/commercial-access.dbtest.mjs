// H-045 (Issue 58) | Provas de banco do acesso comercial derivado (docs/factory/114-DESENHO-H045.md, §8, T-01 a T-16, T-18, T-19).
// Roda no DEV ja migrado (20261113170000). Cada teste roda numa transacao e desfaz tudo no fim: o livro nao aceita
// DELETE nem TRUNCATE, entao nada commitado pode ser removido. Dados sinteticos (@example.test, sufixo aleatorio).
// Sem rede, sem provedor externo, sem relogio do banco: todos os instantes sao explicitos.
// Concorrencia entre duas conexoes (T-09) nao roda aqui: exigiria fixtures commitadas (sem limpeza possivel).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/commercial-access.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
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
const T1 = T0 + 30 * DIA;
const T2 = T1 + 30 * DIA;
const CARENCIA = 72 * HORA;
const TRIAL_FIM = T0 + 14 * DIA;
const iso = (ms) => new Date(ms).toISOString();
const SUF = randomUUID().slice(0, 8);
const ROLE_SERVICE = ['service', 'role'].join('_');
const ROLE_NEGADOS = ['anon', 'authenticated', ROLE_SERVICE, 'app_api'];

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

async function profissional() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `h045-${id.slice(0, 8)}-${SUF}@example.test`, randomUUID()],
  );
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', now(), now(), now())`,
    [id],
  );
  return id;
}

/** Concessao inserida direto (fixture sintetica). Pago recebe source_payment_id novo, salvo se informado. */
async function concessao({ pro, type, starts, ends, identity, payment, status = 'ativa', revogadaEm }) {
  const id = randomUUID();
  const pagamento = payment !== undefined ? payment : type === 'paid' ? randomUUID() : null;
  await client.query(
    `insert into billing.access_grant
       (id, professional_id, identity_id, type, starts_at, ends_at, source_payment_id, status, revoked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      pro,
      identity ?? randomUUID(),
      type,
      iso(starts),
      iso(ends),
      pagamento,
      status,
      status === 'revogada' ? iso(revogadaEm ?? T0) : null,
    ],
  );
  return id;
}

async function assinatura(pro, { cancelar = false, mode = 'manual' } = {}) {
  await client.query(
    `insert into billing.subscription (professional_id, mode, cancel_at_period_end, canceled_at)
     values ($1, $2, $3, $4)`,
    [pro, mode, cancelar, cancelar ? iso(T0) : null],
  );
}

async function estadoEm(pro, ms) {
  const { rows } = await client.query(
    'select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)',
    [pro, iso(ms)],
  );
  assert.equal(rows.length, 1, 'a funcao devolve exatamente uma linha');
  return {
    estado: rows[0].estado,
    ate: rows[0].access_until === null ? null : new Date(rows[0].access_until).getTime(),
  };
}

// T-01 (CA-H045-01) | Esquema: 3 invalidas recusadas, 1 valida aceita; trial com duracao errada e pago sem pagamento recusados.
test('T-01 esquema recusa entradas invalidas e aceita a valida', () =>
  tx(async () => {
    const pro = await profissional();
    const base = { pro, type: 'paid', starts: T0, ends: T1, identity: randomUUID() };
    const tipoInvalido = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
       values ($1, $2, 'x', $3, $4)`,
      [pro, base.identity, iso(T0), iso(T1)],
    );
    const statusInvalido = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status, source_payment_id)
       values ($1, $2, 'paid', $3, $4, 'x', $5)`,
      [pro, base.identity, iso(T0), iso(T1), randomUUID()],
    );
    const fimAntes = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id)
       values ($1, $2, 'paid', $3, $3, $4)`,
      [pro, base.identity, iso(T0), randomUUID()],
    );
    for (const e of [tipoInvalido, statusInvalido, fimAntes]) assert.equal(e?.code, '23514');

    const trialErrado = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
       values ($1, $2, 'trial', $3, $4)`,
      [pro, randomUUID(), iso(T0), iso(T0 + 15 * DIA)],
    );
    assert.equal(trialErrado?.constraint, 'access_grant_trial_14d');
    const pagoSemPagamento = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
       values ($1, $2, 'paid', $3, $4)`,
      [pro, randomUUID(), iso(T0), iso(T1)],
    );
    assert.equal(pagoSemPagamento?.constraint, 'access_grant_paid_com_pagamento');

    await concessao(base);
    const linhas = await client.query('select count(*)::int as n from billing.access_grant where professional_id = $1', [pro]);
    assert.equal(linhas.rows[0].n, 1, 'a valida foi aceita');
  }));

// T-02 (CA-H045-02) | Um trial por identidade, inclusive apos revogar; paid e adjustment da mesma identidade aceitos.
test('T-02 um trial por identidade mesmo apos revogacao', () =>
  tx(async () => {
    const pro = await profissional();
    const identidade = randomUUID();
    const trial = await concessao({ pro, type: 'trial', starts: T0, ends: TRIAL_FIM, identity: identidade });
    const segundo = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
       values ($1, $2, 'trial', $3, $4)`,
      [pro, identidade, iso(T0), iso(TRIAL_FIM)],
    );
    assert.equal(segundo?.code, '23505');
    await client.query(
      `update billing.access_grant set status = 'revogada', revoked_at = now() where id = $1`,
      [trial],
    );
    const apos = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at)
       values ($1, $2, 'trial', $3, $4)`,
      [pro, identidade, iso(T0), iso(TRIAL_FIM)],
    );
    assert.equal(apos?.code, '23505', 'revogar o trial nao reabre outro');
    await concessao({ pro, type: 'paid', starts: T0, ends: T1, identity: identidade });
    await concessao({ pro, type: 'adjustment', starts: T0, ends: T1, identity: identidade });
  }));

// T-03 (CA-H045-03) | Sete estados, um fixture por estado, com estado e access_until exatos.
test('T-03 sete estados com access_until exato', () =>
  tx(async () => {
    const casos = [];
    const sem = await profissional();
    casos.push([sem, T0, 'sem_acesso', null]);

    const tri = await profissional();
    await concessao({ pro: tri, type: 'trial', starts: T0, ends: TRIAL_FIM });
    casos.push([tri, T0 + DIA, 'trial_ativo', TRIAL_FIM]);
    casos.push([tri, TRIAL_FIM + HORA, 'trial_expirado', null]);

    const pag = await profissional();
    await concessao({ pro: pag, type: 'paid', starts: T0, ends: T1 });
    casos.push([pag, T0 + DIA, 'ativa', T1]);
    casos.push([pag, T1 + HORA, 'em_carencia', T1 + CARENCIA]);
    casos.push([pag, T1 + CARENCIA, 'expirada', null]);

    const canc = await profissional();
    await concessao({ pro: canc, type: 'paid', starts: T0, ends: T1 });
    await assinatura(canc, { cancelar: true });
    casos.push([canc, T1 - SEG, 'cancelada_com_acesso_ate_fim_do_periodo', T1]);

    assert.equal(casos.length, 7, 'sete fixtures, um por estado');
    for (const [pro, ms, estado, ate] of casos) {
      const r = await estadoEm(pro, ms);
      assert.equal(r.estado, estado, `estado em ${iso(ms)}`);
      assert.equal(r.ate, ate, `access_until em ${iso(ms)}`);
    }
    const vistos = new Set(casos.map((c) => c[2]));
    assert.equal(vistos.size, 7, 'os sete estados da 08 §6 aparecem');
  }));

// T-04 (CA-H045-04) | Fronteiras: trial, pago e carencia em -1 s, exato e +1 s.
test('T-04 fronteiras em microssegundos e segundos', () =>
  tx(async () => {
    const tri = await profissional();
    await concessao({ pro: tri, type: 'trial', starts: T0, ends: TRIAL_FIM });
    const pag = await profissional();
    await concessao({ pro: pag, type: 'paid', starts: T0, ends: T1 });

    const esperado = [
      [tri, T0 - SEG, 'sem_acesso'],
      [tri, T0, 'trial_ativo'],
      [tri, T0 + SEG, 'trial_ativo'],
      [tri, TRIAL_FIM - SEG, 'trial_ativo'],
      [tri, TRIAL_FIM, 'trial_expirado'],
      [tri, TRIAL_FIM + SEG, 'trial_expirado'],
      [pag, T0 - SEG, 'sem_acesso'],
      [pag, T0, 'ativa'],
      [pag, T0 + SEG, 'ativa'],
      [pag, T1 - SEG, 'ativa'],
      [pag, T1, 'em_carencia'],
      [pag, T1 + SEG, 'em_carencia'],
      [pag, T1 + CARENCIA - SEG, 'em_carencia'],
      [pag, T1 + CARENCIA, 'expirada'],
      [pag, T1 + CARENCIA + SEG, 'expirada'],
    ];
    for (const [pro, ms, estado] of esperado) {
      assert.equal((await estadoEm(pro, ms)).estado, estado, `fronteira em ${iso(ms)}`);
    }
    // Microssegundo: 1 us antes do fim do trial ainda vale; o instante exato ja expirou (intervalo [ini, fim)).
    const antes = await client.query(
      `select estado from private.commercial_access($1::uuid, ($2::timestamptz - interval '1 microsecond'))`,
      [tri, iso(TRIAL_FIM)],
    );
    assert.equal(antes.rows[0].estado, 'trial_ativo');
  }));

// T-05 (CA-H045-05) | Relogio injetado: mesmo instante, duas chamadas com 2 s reais de intervalo; corpo sem relogio do banco.
test('T-05 mesmo at devolve o mesmo resultado e o corpo nao le relogio', () =>
  tx(async () => {
    const pro = await profissional();
    await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    const primeira = await estadoEm(pro, T1 + HORA);
    await esperar(2100);
    const segunda = await estadoEm(pro, T1 + HORA);
    assert.deepEqual(segunda, primeira);
    const { rows } = await client.query(
      `select pg_get_functiondef('private.commercial_access(uuid, timestamptz)'::regprocedure) as corpo,
              pg_get_function_arguments('private.commercial_access(uuid, timestamptz)'::regprocedure) as args`,
    );
    assert.doesNotMatch(rows[0].corpo, /now\(\)|clock_timestamp|current_timestamp/i);
    assert.doesNotMatch(rows[0].args, /default/i);
  }));

// T-06 (CA-H045-06) | Sem job: so os tres gatilhos de imutabilidade; fixture vencida sem tick ja devolve o estado certo.
test('T-06 nenhum job ou gatilho de tempo; fixture vencida sem tick', () =>
  tx(async () => {
    const gatilhos = await client.query(
      `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'billing'::regnamespace and not t.tgisinternal order by t.tgname`,
    );
    assert.deepEqual(
      gatilhos.rows.map((r) => r.tgname),
      ['access_grant_guard_bu', 'access_grant_sem_delete_bd', 'access_grant_sem_truncate_bt'],
    );
    const cron = await client.query(`select to_regclass('cron.job') is not null as existe`);
    if (cron.rows[0].existe) {
      const jobs = await client.query(
        `select count(*)::int as n from cron.job where command ilike '%access_grant%' or command ilike '%commercial_access%'`,
      );
      assert.equal(jobs.rows[0].n, 0);
    }
    const pro = await profissional();
    await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    assert.equal((await estadoEm(pro, T1 + 2 * CARENCIA)).estado, 'expirada');
  }));

// T-07 (CA-H045-07) | Somente leitura: STABLE e contagem/soma iguais antes e depois.
test('T-07 commercial_access e STABLE e nao altera as tabelas', () =>
  tx(async () => {
    const vol = await client.query(
      `select provolatile from pg_proc where oid = 'private.commercial_access(uuid, timestamptz)'::regprocedure`,
    );
    assert.equal(vol.rows[0].provolatile, 's');
    const pro = await profissional();
    await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    await assinatura(pro);
    const soma = () =>
      client.query(
        `select (select count(*)::int from billing.access_grant) as g,
                (select coalesce(sum(extract(epoch from ends_at)), 0)::float8 from billing.access_grant) as ge,
                (select count(*)::int from billing.subscription) as s`,
      ).then((r) => r.rows[0]);
    const antes = await soma();
    await estadoEm(pro, T1 - SEG);
    await estadoEm(pro, T1 + HORA);
    assert.deepEqual(await soma(), antes);
  }));

// T-08 (CA-H045-08) | Imutabilidade: repeticao de pagamento, UPDATE, DELETE, TRUNCATE e revogada->ativa recusados.
test('T-08 livro imutavel: sem repeticao, sem UPDATE de datas, sem DELETE nem TRUNCATE', () =>
  tx(async () => {
    const pro = await profissional();
    const pagamento = randomUUID();
    const id = await concessao({ pro, type: 'paid', starts: T0, ends: T1, payment: pagamento });
    const antes = await estadoEm(pro, T0 + DIA);

    const repetido = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id)
       values ($1, $2, 'paid', $3, $4, $5)`,
      [pro, randomUUID(), iso(T1), iso(T2), pagamento],
    );
    assert.equal(repetido?.code, '23505');

    for (const coluna of ['starts_at', 'ends_at', 'type', 'professional_id']) {
      const valor = coluna === 'type' ? 'adjustment' : coluna === 'professional_id' ? randomUUID() : iso(T2);
      const e = await erroEm(`update billing.access_grant set ${coluna} = $2 where id = $1`, [id, valor]);
      assert.ok(e?.message.includes('access_grant_imutavel') || e?.code === '23514', `UPDATE de ${coluna} recusado`);
    }
    const del = await erroEm('delete from billing.access_grant where id = $1', [id]);
    assert.ok(del?.message.includes('access_grant_sem_delete'), 'DELETE recusado');
    const trunc = await erroEm('truncate billing.access_grant');
    assert.ok(trunc?.message.includes('access_grant_sem_delete'), 'TRUNCATE recusado');

    await client.query(`update billing.access_grant set status = 'revogada', revoked_at = now() where id = $1`, [id]);
    const volta = await erroEm(`update billing.access_grant set status = 'ativa', revoked_at = null where id = $1`, [id]);
    assert.ok(volta?.message.includes('access_grant_transicao_invalida'), 'revogada para ativa recusado');

    assert.equal((await estadoEm(pro, T0 + DIA)).estado, 'sem_acesso', 'revogada nao conta');
    assert.notDeepEqual(antes.estado, 'sem_acesso', 'antes da revogacao havia acesso');
  }));

// T-09 (CA-H045-09) | Sobreposicao parcial e total recusada; contigua aceita; sobreposicao com paga revogada aceita.
// A parte de concorrencia entre duas conexoes NAO roda aqui (ver cabecalho).
test('T-09 nao sobreposicao de pagas ativas', () =>
  tx(async () => {
    const pro = await profissional();
    const original = await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    const parcial = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id)
       values ($1, $2, 'paid', $3, $4, $5)`,
      [pro, randomUUID(), iso(T0 + DIA), iso(T1 + DIA), randomUUID()],
    );
    assert.equal(parcial?.code, '23P01');
    const total = await erroEm(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id)
       values ($1, $2, 'paid', $3, $4, $5)`,
      [pro, randomUUID(), iso(T0 + DIA), iso(T1 - DIA), randomUUID()],
    );
    assert.equal(total?.code, '23P01');
    await concessao({ pro, type: 'paid', starts: T1, ends: T2 });
    const contiguaAceita = await client.query('select count(*)::int as n from billing.access_grant where professional_id = $1', [pro]);
    assert.equal(contiguaAceita.rows[0].n, 2, 'contigua [T1,T2) aceita');

    await client.query('select private.access_grant_revoke($1, $2, $3, $4, null)', [
      original,
      'system:h045_teste',
      'system',
      'ajuste_teste',
    ]);
    // Com a original revogada, um pago que so colide com ela (e nao com [T1,T2)) passa.
    await concessao({ pro, type: 'paid', starts: T0 + DIA, ends: T1 });
  }));

// T-10 (CA-H045-10) | Carencia de pago: T+71h59m59s em carencia, T+72h expirada; trial terminado nunca em carencia.
test('T-10 carencia so para pago; trial terminado nunca em carencia', () =>
  tx(async () => {
    const pag = await profissional();
    await concessao({ pro: pag, type: 'paid', starts: T0, ends: T1 });
    assert.equal((await estadoEm(pag, T1 + 71 * HORA + 59 * 60 * SEG + 59 * SEG)).estado, 'em_carencia');
    assert.equal((await estadoEm(pag, T1 + CARENCIA)).estado, 'expirada');

    const tri = await profissional();
    await concessao({ pro: tri, type: 'trial', starts: T0, ends: TRIAL_FIM });
    assert.equal((await estadoEm(tri, TRIAL_FIM + HORA)).estado, 'trial_expirado');
    assert.equal((await estadoEm(tri, TRIAL_FIM + CARENCIA)).estado, 'trial_expirado');
  }));

// T-11 (CA-H045-11) | Cartao recorrente e manual produzem a mesma saida.
test('T-11 modo de cobranca nao altera o estado', () =>
  tx(async () => {
    const cartao = await profissional();
    const manual = await profissional();
    for (const pro of [cartao, manual]) {
      await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    }
    await assinatura(cartao, { mode: 'cartao_recorrente' });
    await assinatura(manual, { mode: 'manual' });
    for (const ms of [T1 - SEG, T1 + HORA, T1 + CARENCIA]) {
      assert.deepEqual(await estadoEm(cartao, ms), await estadoEm(manual, ms), `em ${iso(ms)}`);
    }
  }));

// T-12 (CA-H045-12) | Cancelamento: acesso ate o fim do periodo, sem carencia.
test('T-12 cancelamento preserva acesso ate o fim e nao concede carencia', () =>
  tx(async () => {
    const pro = await profissional();
    await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    await assinatura(pro, { cancelar: true });
    assert.deepEqual(await estadoEm(pro, T1 - SEG), { estado: 'cancelada_com_acesso_ate_fim_do_periodo', ate: T1 });
    assert.equal((await estadoEm(pro, T1)).estado, 'expirada');
    assert.equal((await estadoEm(pro, T1 + HORA)).estado, 'expirada');
  }));

// T-13 (CA-H045-13) | Retorno dentro e fora da carencia.
test('T-13 renovacao contigua e retorno dentro e fora da carencia', () =>
  tx(async () => {
    const contigua = await profissional();
    await concessao({ pro: contigua, type: 'paid', starts: T0, ends: T1 });
    await concessao({ pro: contigua, type: 'paid', starts: T1, ends: T2 });
    assert.deepEqual(await estadoEm(contigua, T1 + 60 * HORA), { estado: 'ativa', ate: T2 });

    const tarde = await profissional();
    await concessao({ pro: tarde, type: 'paid', starts: T0, ends: T1 });
    await concessao({ pro: tarde, type: 'paid', starts: T1 + 73 * HORA, ends: T2 });
    assert.equal((await estadoEm(tarde, T1 + CARENCIA)).estado, 'expirada');
    assert.equal((await estadoEm(tarde, T1 + 73 * HORA)).estado, 'ativa');
  }));

// T-14 (CA-H045-14) | Privilegios por catalogo, RLS forcada e zero politicas.
test('T-14 privilegios negados a anon, authenticated, servidor de servico e app_api; app_system so le', () =>
  tx(async () => {
    const tabelas = ['billing.access_grant', 'billing.subscription'];
    for (const t of tabelas) {
      for (const papel of ROLE_NEGADOS) {
        for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const r = await client.query('select has_table_privilege($1, $2, $3) as ok', [papel, t, op]);
          assert.equal(r.rows[0].ok, false, `${papel} ${op} em ${t}`);
        }
      }
      const s = await client.query('select has_table_privilege($1, $2, $3) as ok', ['app_system', t, 'SELECT']);
      assert.equal(s.rows[0].ok, true, `app_system le ${t}`);
      const w = await client.query('select has_table_privilege($1, $2, $3) as ok', ['app_system', t, 'INSERT']);
      assert.equal(w.rows[0].ok, false, `app_system nao escreve ${t} ainda`);
    }
    const fn = 'private.commercial_access(uuid, timestamptz)';
    for (const papel of ['anon', 'authenticated', ROLE_SERVICE]) {
      const r = await client.query('select has_function_privilege($1, $2, $3) as ok', [papel, fn, 'EXECUTE']);
      assert.equal(r.rows[0].ok, false, `${papel} nao executa a leitura`);
    }
    for (const papel of ['app_api', 'app_system']) {
      const r = await client.query('select has_function_privilege($1, $2, $3) as ok', [papel, fn, 'EXECUTE']);
      assert.equal(r.rows[0].ok, true, `${papel} executa a leitura`);
    }
    const rev = 'private.access_grant_revoke(uuid, text, text, text, uuid)';
    const apiRev = await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_api', rev, 'EXECUTE']);
    assert.equal(apiRev.rows[0].ok, false, 'app_api nao revoga');
    const sysRev = await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_system', rev, 'EXECUTE']);
    assert.equal(sysRev.rows[0].ok, true, 'app_system revoga');

    const rls = await client.query(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where oid in ('billing.access_grant'::regclass, 'billing.subscription'::regclass)`,
    );
    for (const r of rls.rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname} com RLS`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname} com RLS forcada`);
    }
    const pol = await client.query(
      `select count(*)::int as n from pg_policies where schemaname = 'billing'`,
    );
    assert.equal(pol.rows[0].n, 0, 'zero politicas');
  }));

// T-15 (CA-H045-15) | Saida minima: so estado e access_until.
test('T-15 a funcao devolve so estado e access_until', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select pg_get_function_result('private.commercial_access(uuid, timestamptz)'::regprocedure) as tipo`,
    );
    assert.equal(rows[0].tipo, 'TABLE(estado text, access_until timestamp with time zone)');
  }));

// T-16 (CA-H045-16) | Nenhuma coluna chamada estado nas tabelas de billing nem em professional_profile.
test('T-16 sem estado persistido em colunas de billing e perfil', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select table_schema, table_name, column_name from information_schema.columns
        where (table_schema = 'billing') or (table_schema = 'app' and table_name = 'professional_profile')`,
    );
    assert.equal(rows.filter((r) => r.column_name === 'estado').length, 0);
    assert.equal(rows.filter((r) => r.column_name === 'grace_until').length, 0, 'sem grace_until (decisao 271)');
  }));

// T-18 (dec. 272, 275, auditoria Issue 19) | Adjustment e revogada ignorados; revogacao audita, e idempotente; falha de auditoria desfaz.
test('T-18 revogacao audita, e idempotente; falha de auditoria desfaz a revogacao', () =>
  tx(async () => {
    const ajuste = await profissional();
    await concessao({ pro: ajuste, type: 'adjustment', starts: T0, ends: T1 });
    assert.equal((await estadoEm(ajuste, T0 + DIA)).estado, 'sem_acesso', 'adjustment ignorado');

    const pro = await profissional();
    const id = await concessao({ pro, type: 'paid', starts: T0, ends: T1 });
    const primeira = await client.query('select private.access_grant_revoke($1, $2, $3, $4, null) as ok', [
      id,
      'system:h045_teste',
      'system',
      'ajuste_teste',
    ]);
    assert.equal(primeira.rows[0].ok, true);
    const segunda = await client.query('select private.access_grant_revoke($1, $2, $3, $4, null) as ok', [
      id,
      'system:h045_teste',
      'system',
      'ajuste_teste',
    ]);
    assert.equal(segunda.rows[0].ok, false, 'idempotente');
    const eventos = await client.query(
      `select count(*)::int as n from audit.audit_event
        where action = 'billing.access_grant.revoke' and object_id = $1`,
      [id],
    );
    assert.equal(eventos.rows[0].n, 1, 'um unico evento de auditoria');
    assert.equal((await estadoEm(pro, T0 + DIA)).estado, 'sem_acesso', 'revogada ignorada');

    const outro = await profissional();
    const alvo = await concessao({ pro: outro, type: 'paid', starts: T0, ends: T1 });
    const falha = await erroEm('select private.access_grant_revoke($1, $2, $3, $4, null)', [
      alvo,
      'system:h045_teste',
      'admin',
      'ajuste_teste',
    ]);
    assert.ok(falha, 'auditoria recusada (ator de sistema com papel errado)');
    const ainda = await client.query('select status from billing.access_grant where id = $1', [alvo]);
    assert.equal(ainda.rows[0].status, 'ativa', 'falha de auditoria desfaz a revogacao');
  }));

// T-19 (dec. 269) | Pago prevalece sobre trial: trial vigente + pago vigente = ativa; trial vigente + pago em carencia = em_carencia.
test('T-19 pago prevalece sobre trial vigente, inclusive em carencia', () =>
  tx(async () => {
    const vigente = await profissional();
    await concessao({ pro: vigente, type: 'trial', starts: T0, ends: TRIAL_FIM });
    await concessao({ pro: vigente, type: 'paid', starts: T0, ends: T1 });
    assert.equal((await estadoEm(vigente, T0 + DIA)).estado, 'ativa');

    const carencia = await profissional();
    // Trial de 14 dias (CHECK) centrado no fim do pago: segue vigente quando o pago esta em carencia.
    await concessao({ pro: carencia, type: 'trial', starts: T1 - 7 * DIA, ends: T1 + 7 * DIA });
    await concessao({ pro: carencia, type: 'paid', starts: T0, ends: T1 });
    assert.deepEqual(await estadoEm(carencia, T1 + HORA), { estado: 'em_carencia', ate: T1 + CARENCIA });
  }));
