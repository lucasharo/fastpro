// H-046 (Issue 59) | Provas de banco de planos e precos (docs/factory/120-DESENHO-H046.md, §8, T-01 a T-12).
// Roda no DEV ja migrado (20261113190000). Cada teste roda numa transacao e desfaz tudo no fim.
// Sem rede, sem provedor externo, sem relogio do banco: todos os instantes sao explicitos.
// A carga de referencia persiste no DEV (dado legitimo); as trocas de preco das provas nao.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/plan-pricing.dbtest.mjs
// Nota: o literal 29.90 nao prova a recusa de fracionario numa coluna inteira (vira 30). A prova usa parametro de texto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIGRACAO = new URL(
  '../../../supabase/migrations/20261113190000_billing_create_plan_pricing.sql',
  import.meta.url,
);
const ROLE_SERVICE = ['service', 'role'].join('_');
const ROLES_NEGADOS = ['anon', 'authenticated', ROLE_SERVICE, 'app_api'];
const PRIVS_TABELA = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const PRIVS_ESCRITA = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABELAS = ['billing.plan', 'billing.plan_price'];
const FUNCAO = 'private.plan_price_at(timestamptz,text)';

const SEG = 1000;
const T_REF = '2026-11-13T12:00:00.000Z';
const T_TROCA = '2030-06-01T00:00:00.000Z';
const iso = (ms) => new Date(ms).toISOString();

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

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

async function planoId(code) {
  return (await client.query('select id from billing.plan where code = $1', [code])).rows[0].id;
}

async function precoAberto(code) {
  const r = await client.query(
    `select pp.id, pp.amount_cents, pp.valid_from
       from billing.plan_price pp join billing.plan p on p.id = pp.plan_id
      where p.code = $1 and pp.valid_to is null`,
    [code],
  );
  return r.rows[0];
}

/** Leitura da funcao: code nulo devolve os quatro planos. */
async function leitura(code, at) {
  const r = await client.query(
    `select plan_code, months, plan_price_id, amount_cents, currency
       from private.plan_price_at($1::timestamptz, $2::text) order by months`,
    [at, code],
  );
  return r.rows;
}

/** Troca de preco do jeito que a fase administrativa fara: fecha a vigente em T e abre a nova em T. */
async function trocarPreco(code, cents, instante) {
  const id = await planoId(code);
  await client.query(
    'update billing.plan_price set valid_to = $2::timestamptz where plan_id = $1 and valid_to is null',
    [id, instante],
  );
  const r = await client.query(
    `insert into billing.plan_price (plan_id, amount_cents, currency, valid_from)
     values ($1, $2, 'BRL', $3::timestamptz) returning id`,
    [id, cents, instante],
  );
  return r.rows[0].id;
}

async function contagens() {
  const r = await client.query(
    `select (select count(*)::int from billing.plan) as planos,
            (select count(*)::int from billing.plan_price) as precos,
            (select count(*)::int from billing.plan_price where valid_to is null) as abertos`,
  );
  return r.rows[0];
}

test('T-01 CA-H046-01: quatro planos com meses fixos; codigo ou par fora da lista e recusado', () =>
  tx(async () => {
    const r = await client.query('select code, months from billing.plan order by months');
    assert.deepEqual(
      r.rows.map((x) => [x.code, x.months]),
      [
        ['mensal', 1],
        ['trimestral', 3],
        ['semestral', 6],
        ['anual', 12],
      ],
    );
    for (const [code, months] of [
      ['bienal', 2],
      ['mensal', 12],
      ['anual', 1],
    ]) {
      const err = await erroEm('insert into billing.plan (code, months) values ($1, $2)', [code, months]);
      assert.equal(err?.code, '23514', `${code}/${months} deveria ser recusado`);
    }
  }));

test('T-02 CA-H046-02: centavos inteiros positivos em BRL; recusa por parametro de texto', () =>
  tx(async () => {
    // Prova de por que o literal nao serve: 29.90 arredonda para 30 em coluna inteira.
    const arredonda = await client.query('select 29.90::integer as v');
    assert.equal(arredonda.rows[0].v, 30);

    const id = await planoId('mensal');
    await client.query(
      'update billing.plan_price set valid_to = $2::timestamptz where plan_id = $1 and valid_to is null',
      [id, T_TROCA],
    );
    const inserir = 'insert into billing.plan_price (plan_id, amount_cents, valid_from) values ($1, $2, $3::timestamptz)';
    assert.equal((await erroEm(inserir, [id, '0', T_TROCA]))?.code, '23514');
    assert.equal((await erroEm(inserir, [id, '-1', T_TROCA]))?.code, '23514');
    assert.equal((await erroEm(inserir, [id, null, T_TROCA]))?.code, '23502');
    assert.equal((await erroEm(inserir, [id, '29.90', T_TROCA]))?.code, '22P02');
    const moeda = await erroEm(
      'insert into billing.plan_price (plan_id, amount_cents, currency, valid_from) values ($1, $2, $3, $4::timestamptz)',
      [id, '2990', 'USD', T_TROCA],
    );
    assert.equal(moeda?.code, '23514');
    // Valor valido e encostado no fechamento (sem sobreposicao): aceito.
    assert.equal(await erroEm(inserir, [id, '2990', T_TROCA]), null);
  }));

test('T-03 CA-H046-03: valores aprovados por plano na data de referencia', () =>
  tx(async () => {
    const linhas = await leitura(null, T_REF);
    assert.deepEqual(
      linhas.map((l) => [l.plan_code, l.amount_cents, l.currency]),
      [
        ['mensal', 2990, 'BRL'],
        ['trimestral', 8070, 'BRL'],
        ['semestral', 14940, 'BRL'],
        ['anual', 23880, 'BRL'],
      ],
    );
  }));

test('T-04 CA-H046-04: sem coluna de beneficio ou limite nas tabelas de preco', async () => {
  const r = await client.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'billing' and table_name in ('plan', 'plan_price')`,
  );
  // plan: id, code, months, created_at (4); plan_price: id, plan_id, amount_cents, currency, valid_from, valid_to, created_at (7).
  assert.equal(r.rows.length, 11);
  for (const { column_name: coluna } of r.rows) {
    assert.doesNotMatch(coluna, /benef|limit|feature|recurso|quota|cota/i, coluna);
  }
});

test('T-05 CA-H046-05: sem promocao, desconto ou cupom no esquema criado pela migracao', async () => {
  const termos = /promo|discount|desconto|coupon|cupom|launch|lancamento/i;
  const colunas = await client.query(
    `select column_name as nome from information_schema.columns
      where table_schema = 'billing' and table_name in ('plan', 'plan_price')`,
  );
  const tabelas = await client.query(
    `select table_name as nome from information_schema.tables
      where table_schema = 'billing' and table_name like 'plan%'`,
  );
  const funcoes = await client.query(
    `select p.proname as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('plan_price_at', 'billing_plan_guard', 'billing_plan_price_guard')`,
  );
  const nomes = [...colunas.rows, ...tabelas.rows, ...funcoes.rows].map((r) => r.nome);
  assert.equal(nomes.length, 11 + 2 + 3);
  for (const nome of nomes) assert.doesNotMatch(nome, termos, nome);
});

test('T-06 CA-H046-06: fronteira de vigencia em T-1 s, T e T+1 s; antes da carga, zero linhas', () =>
  tx(async () => {
    const T = Date.parse(T_TROCA);
    await trocarPreco('mensal', 3190, T_TROCA);
    const antes = await leitura('mensal', iso(T - SEG));
    const em = await leitura('mensal', T_TROCA);
    const depois = await leitura('mensal', iso(T + SEG));
    assert.equal(antes[0].amount_cents, 2990);
    assert.equal(em[0].amount_cents, 3190);
    assert.equal(depois[0].amount_cents, 3190);
    assert.equal((await leitura('mensal', '2025-12-31T23:59:59.000Z')).length, 0);
  }));

test('T-07 CA-H046-07: sobreposicao recusada (23P01); encostado aceito; segundo preco aberto recusado', () =>
  tx(async () => {
    const id = await planoId('mensal');
    const inserirVigencia = `insert into billing.plan_price (plan_id, amount_cents, currency, valid_from, valid_to)
      values ($1, $2, 'BRL', $3::timestamptz, $4::timestamptz)`;
    const parcial = await erroEm(inserirVigencia, [id, 3000, '2026-06-01T00:00:00.000Z', null]);
    assert.equal(parcial?.code, '23P01', 'sobreposicao parcial');
    const total = await erroEm(inserirVigencia, [
      id,
      3000,
      '2025-06-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ]);
    assert.equal(total?.code, '23P01', 'sobreposicao total');
    // Encostado: fecha a vigente em T e abre a nova em T (intervalo semiaberto).
    await client.query(
      'update billing.plan_price set valid_to = $2::timestamptz where plan_id = $1 and valid_to is null',
      [id, T_TROCA],
    );
    assert.equal(await erroEm(inserirVigencia, [id, 3190, T_TROCA, null]), null, 'encostado');
    const segundoAberto = await erroEm(inserirVigencia, [id, 3290, '2031-01-01T00:00:00.000Z', null]);
    assert.equal(segundoAberto?.code, '23P01', 'segundo preco aberto');
  }));

test('T-08 CA-H046-08: preco imutavel; valid_to fecha uma vez; sem DELETE nem TRUNCATE; plano imutavel', () =>
  tx(async () => {
    const id = await planoId('mensal');
    const aberto = await precoAberto('mensal');
    const alterado = await erroEm('update billing.plan_price set amount_cents = 1 where id = $1', [aberto.id]);
    assert.match(alterado?.message ?? '', /plan_price_imutavel/);
    const fecha = await erroEm('update billing.plan_price set valid_to = $2::timestamptz where id = $1', [
      aberto.id,
      T_TROCA,
    ]);
    assert.equal(fecha, null, 'fechamento da vigencia aceito uma vez');
    const segundo = await erroEm('update billing.plan_price set valid_to = $2::timestamptz where id = $1', [
      aberto.id,
      '2030-07-01T00:00:00.000Z',
    ]);
    assert.match(segundo?.message ?? '', /plan_price_imutavel/);
    assert.match((await erroEm('delete from billing.plan_price where id = $1', [aberto.id]))?.message ?? '', /plan_price_sem_delete/);
    assert.match((await erroEm('truncate billing.plan_price'))?.message ?? '', /plan_price_sem_delete/);
    assert.match((await erroEm('update billing.plan set months = 2 where id = $1', [id]))?.message ?? '', /plan_imutavel/);
    assert.match((await erroEm('delete from billing.plan where id = $1', [id]))?.message ?? '', /plan_imutavel/);
    // TRUNCATE de billing.plan e barrado pela FK de plan_price antes do gatilho: basta a recusa.
    assert.notEqual(await erroEm('truncate billing.plan'), null);
  }));

test('T-09 CA-H046-09: leitura estavel, sem relogio do banco, sem default em p_at, sem escrita', () =>
  tx(async () => {
    const f = (
      await client.query(
        `select p.provolatile, pg_get_function_arguments(p.oid) as args,
                pg_get_function_result(p.oid) as res, pg_get_functiondef(p.oid) as def
           from pg_proc p where p.oid = $1::regprocedure`,
        [FUNCAO],
      )
    ).rows[0];
    assert.equal(f.provolatile, 's', 'STABLE');
    assert.equal(f.args.split(',')[0], 'p_at timestamp with time zone', 'p_at sem default');
    assert.match(f.args, /p_plan_code text DEFAULT NULL/i);
    for (const coluna of ['plan_code text', 'months integer', 'plan_price_id uuid', 'amount_cents integer', 'currency text']) {
      assert.ok(f.res.includes(coluna), coluna);
    }
    assert.doesNotMatch(f.def.toLowerCase(), /now\(\)|clock_timestamp|current_timestamp/);
    const antes = await contagens();
    const somaAntes = (await client.query('select coalesce(sum(amount_cents), 0)::text as s from billing.plan_price')).rows[0].s;
    for (let i = 0; i < 3; i++) await leitura(null, T_REF);
    await leitura('anual', '2030-01-01T00:00:00.000Z');
    assert.deepEqual(await contagens(), antes, 'contagens iguais depois das leituras');
    const somaDepois = (await client.query('select coalesce(sum(amount_cents), 0)::text as s from billing.plan_price')).rows[0].s;
    assert.equal(somaDepois, somaAntes, 'soma de conferencia igual');
    assert.equal((await leitura('mensal', T_REF)).length, 1, 'filtro por codigo devolve 1');
    assert.equal((await leitura(null, T_REF)).length, 4, 'nulo devolve 4');
  }));

test('T-10 CA-H046-10: carga idempotente; reexecutar nao duplica nem recria valor antigo', () =>
  tx(async () => {
    const sqlMigracao = readFileSync(MIGRACAO, 'utf8');
    const inicio = sqlMigracao.indexOf('insert into billing.plan (code, months)');
    assert.ok(inicio > 0, 'bloco de carga presente na migracao');
    const carga = sqlMigracao.slice(inicio);

    const antes = await contagens();
    assert.equal(antes.planos, 4);
    await client.query(carga);
    await client.query(carga);
    assert.deepEqual(await contagens(), antes, 'duas reexecucoes nao mudam contagens');

    await trocarPreco('mensal', 3190, T_TROCA);
    const comTroca = await contagens();
    await client.query(carga);
    assert.deepEqual(await contagens(), comTroca, 'reexecucao depois da troca nao recria o valor antigo');
    assert.equal((await precoAberto('mensal')).amount_cents, 3190);
  }));

test('T-11 CA-H046-11: privilegios por papel, RLS forcada e zero politicas', async () => {
  for (const tabela of TABELAS) {
    for (const role of ROLES_NEGADOS) {
      for (const priv of PRIVS_TABELA) {
        const r = await client.query('select has_table_privilege($1, $2, $3) as ok', [role, tabela, priv]);
        assert.equal(r.rows[0].ok, false, `${role} ${priv} em ${tabela}`);
      }
    }
    const leituraSistema = await client.query('select has_table_privilege($1, $2, $3) as ok', ['app_system', tabela, 'SELECT']);
    assert.equal(leituraSistema.rows[0].ok, true, `app_system SELECT em ${tabela}`);
    for (const priv of PRIVS_ESCRITA) {
      const r = await client.query('select has_table_privilege($1, $2, $3) as ok', ['app_system', tabela, priv]);
      assert.equal(r.rows[0].ok, false, `app_system ${priv} em ${tabela}`);
    }
  }

  for (const role of ROLES_NEGADOS.filter((r) => r !== 'app_api')) {
    const r = await client.query('select has_function_privilege($1, $2, $3) as ok', [role, FUNCAO, 'EXECUTE']);
    assert.equal(r.rows[0].ok, false, `${role} executa a funcao`);
  }
  for (const role of ['app_api', 'app_system']) {
    const r = await client.query('select has_function_privilege($1, $2, $3) as ok', [role, FUNCAO, 'EXECUTE']);
    assert.equal(r.rows[0].ok, true, `${role} executa a funcao`);
  }

  const rls = await client.query(
    `select c.oid::regclass::text as tabela, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c where c.oid in ('billing.plan'::regclass, 'billing.plan_price'::regclass)`,
  );
  assert.equal(rls.rows.length, 2);
  for (const linha of rls.rows) {
    assert.equal(linha.relrowsecurity, true, `RLS ${linha.tabela}`);
    assert.equal(linha.relforcerowsecurity, true, `RLS forcada ${linha.tabela}`);
  }
  const politicas = await client.query(
    `select count(*)::int as n from pg_policies
      where schemaname = 'billing' and tablename in ('plan', 'plan_price')`,
  );
  assert.equal(politicas.rows[0].n, 0, 'zero politicas');
});

test('T-12 CA-H046-12: a leitura devolve o identificador e o valor gravados na linha', () =>
  tx(async () => {
    const [linha] = await leitura('trimestral', T_REF);
    assert.equal(linha.amount_cents, 8070);
    const gravado = (
      await client.query('select amount_cents from billing.plan_price where id = $1', [linha.plan_price_id])
    ).rows[0];
    assert.equal(gravado.amount_cents, linha.amount_cents);
  }));
