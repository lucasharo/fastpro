// H-108 (Issue #117) | Painel operacional minimo: leitura por private.ops_panel_read, escrita por ops_metric_incr
// (docs/factory/76-DESENHO-H108.md §4, T-H108-10 a T-H108-14; 73-REFINO-H108.md CA-H108-04 a CA-H108-14).
// Migracao 20261111430000_ops_create_ops_metric_panel, aplicada DENTRO da transacao de cada teste.
// Tudo e desfeito com rollback; nada persiste no banco de desenvolvimento. Valores sinteticos (@example.test).
// Erros esperados usam savepoint, porque um erro no Postgres aborta a transacao inteira.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/ops-panel-h108.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

const MIGRACAO = readFileSync(
  join(REPO_ROOT, 'supabase', 'migrations', '20261111430000_ops_create_ops_metric_panel.sql'),
  'utf8',
);
const HORA = 3600000;
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();

/** Transacao de teste: aplica a migracao e desfaz tudo no fim. Nada fica no banco compartilhado. */
async function tx(fn) {
  await client.query('begin');
  try {
    await client.query(MIGRACAO);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Executa fn dentro de savepoint. Devolve o erro (ou null). Mantem a transacao utilizavel. */
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

/** Item da fila de e-mail (insert direto no banco de teste; so colunas obrigatorias e as que o painel le). */
async function item(state, { criadoEm = T0, reason = null, dedupe = randomUUID(), params = {} } = {}) {
  await client.query(
    `insert into ops.email_outbox
       (recipient_user_id, category, class, email_type, template, template_params, dedupe_key,
        state, reason_code, created_at)
     values ($1, 'verificacao', 'auth', 'teste_h108', 'teste_h108', $2::jsonb, $3, $4, $5, $6::timestamptz)`,
    [randomUUID(), JSON.stringify(params), dedupe, state, reason, at(criadoEm)],
  );
}

const painel = async (ms = T0) =>
  (await client.query('select private.ops_panel_read($1::timestamptz) as p', [at(ms)])).rows[0].p;

// T-H108-10 | fila: contagem por estado, idade do pendente mais antigo e falhas por codigo batem com a consulta direta
test('T-H108-10 fila de e-mail: contagens, idade e falhas batem com a consulta direta', () =>
  tx(async () => {
    await item('pendente', { criadoEm: T0 - 2 * HORA });
    await item('pendente', { criadoEm: T0 - HORA });
    await item('enviado');
    await item('suprimido');
    await item('falha', { reason: 'timeout' });
    await item('falha', { reason: 'heic_invalido' });
    await item('falha', { reason: 'timeout' });

    const p = await painel();

    const { rows: porEstado } = await client.query(
      'select state, count(*)::int as n from ops.email_outbox group by state');
    assert.deepEqual(p.fila.por_estado, Object.fromEntries(porEstado.map((r) => [r.state, r.n])));

    const { rows: [minimo] } = await client.query(
      `select min(created_at) as m from ops.email_outbox where state = 'pendente'`);
    assert.equal(p.fila.idade_pendente_s, Math.floor((T0 - new Date(minimo.m).getTime()) / 1000),
      'idade do pendente mais antigo, em segundos');
    assert.ok(p.fila.idade_pendente_s >= 2 * 3600, 'o pendente de 2 h entra no calculo');

    const { rows: falhas } = await client.query(
      `select reason_code as codigo, count(*)::int as n from ops.email_outbox
        where state = 'falha' and reason_code is not null group by reason_code`);
    assert.deepEqual(p.fila.falhas_por_codigo, Object.fromEntries(falhas.map((r) => [r.codigo, r.n])));
    assert.ok(p.fila.falhas_por_codigo.timeout >= 2, 'as duas falhas de timeout contam');
  }));

// T-H108-11 | cota: so o periodo corrente (dia e mes UTC) entra; uso, limite, alerta e alertado_em batem
test('T-H108-11 cota: periodo corrente (UTC) com uso, limite, alerta e data de alerta', () =>
  tx(async () => {
    await client.query(
      `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, alert_level, alerted_at)
       values ('email', 'dia_utc', date '2099-01-01', 70, 80, 100, 1, $1::timestamptz),
              ('email', 'mes', date '2099-01-01', 2100, 2500, 3000, 2, $1::timestamptz),
              ('email', 'dia_utc', date '2098-12-31', 99, 80, 100, 2, $1::timestamptz)
       on conflict (service, period, period_start) do update
         set used = excluded.used, soft_limit = excluded.soft_limit, hard_limit = excluded.hard_limit,
             alert_level = excluded.alert_level, alerted_at = excluded.alerted_at`,
      [at(T0)],
    );

    const p = await painel();
    const diaUtc = p.cotas.filter((c) => c.servico === 'email' && c.periodo === 'dia_utc');
    assert.equal(diaUtc.length, 1, 'so o dia UTC corrente; o dia anterior nao entra');
    assert.equal(diaUtc[0].usado, 70);
    assert.equal(diaUtc[0].limite, 100);
    assert.equal(diaUtc[0].alerta, 1);
    assert.equal(new Date(diaUtc[0].alertado_em).getTime(), T0);

    const mes = p.cotas.find((c) => c.servico === 'email' && c.periodo === 'mes');
    assert.equal(mes.usado, 2100);
    assert.equal(mes.alerta, 2);

    const { rows: mapbox } = await client.query(
      `select count(*)::int as n from ops.external_quota
        where service = 'mapbox_geocoding_temp' and period_start = date '2099-01-01'`);
    assert.equal(p.cotas.some((c) => c.servico === 'mapbox_geocoding_temp'), mapbox[0].n > 0,
      'servico sem linha no periodo nao aparece com dado inventado');
  }));

// T-H108-10 (fila vazia) | sem linhas em ops.email_outbox: nenhum estado, nenhuma falha e idade nula.
// Os zeros por estado sao preenchidos no dominio (filaDoPainel); aqui o banco so nao inventa valor.
test('T-H108-10 fila vazia: sem estados, sem falhas e idade do pendente nula', () =>
  tx(async () => {
    await client.query('delete from ops.email_outbox');

    const p = await painel();
    assert.deepEqual(p.fila.por_estado, {}, 'nenhum estado com contagem');
    assert.equal(p.fila.idade_pendente_s, null, 'idade nula sem pendente');
    assert.deepEqual(p.fila.falhas_por_codigo, {}, 'nenhuma falha por codigo');
  }));

// T-H108-11 (servico sem linha) | servico sem linha no periodo nao aparece na leitura: o dominio o transforma em
// sem_dados (CA-H108-10), nunca em 0%. So o e-mail tem linha nesta transacao.
test('T-H108-11 cota: servico sem linha no periodo nao aparece na leitura (vira sem_dados no dominio)', () =>
  tx(async () => {
    await client.query(
      `insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, alert_level, alerted_at)
       values ('email', 'dia_utc', date '2099-01-01', 10, 80, 100, 0, null)
       on conflict (service, period, period_start) do update set used = excluded.used`);

    const p = await painel();
    assert.equal(p.cotas.some((c) => c.servico === 'email' && c.periodo === 'dia_utc'), true,
      'o servico com linha aparece');
    for (const servico of ['mapbox_permanent', 'mapbox_geocoding_temp', 'storage', 'banco']) {
      assert.equal(p.cotas.some((c) => c.servico === servico), false,
        `${servico} sem linha nao aparece na leitura`);
    }
  }));

// T-H108-12 | ops_metric: metrica fora da lista e dimensao fora do formato sao recusadas; soma sem duplicar
test('T-H108-12 ops_metric recusa metrica e dimensao fora do formato', () =>
  tx(async () => {
    const casos = [
      ['webhook_xpto', 'ok'],
      ['webhook_falha', 'Com_Maiuscula'],
      ['webhook_falha', 'arroba@x'],
      ['webhook_falha', 'com espaco'],
    ];
    for (const [chave, dim] of casos) {
      const erro = await erroEm(() => client.query(
        'select private.ops_metric_incr($1, $2, $3::timestamptz, 1, null, null)', [chave, dim, at(T0)]));
      assert.equal(erro?.code, '23514', `recusado: ${chave} / ${dim}`);
    }
    const negativo = await erroEm(() => client.query(
      'select private.ops_metric_incr($1, $2, $3::timestamptz, -1, null, null)', ['webhook_falha', 'ok', at(T0)]));
    assert.equal(negativo?.code, '22023', 'valor negativo recusado');
  }));

test('T-H108-12 ops_metric soma no mesmo bucket horario e guarda o maior valor', () =>
  tx(async () => {
    await client.query(
      `select private.ops_metric_incr('webhook_latencia', 'ok_200', $1::timestamptz, 1, 120, 120)`,
      [at(T0 + 10 * 60000)]);
    await client.query(
      `select private.ops_metric_incr('webhook_latencia', 'ok_200', $1::timestamptz, 2, 300, 250)`,
      [at(T0 + 40 * 60000)]);

    const { rows } = await client.query(
      `select value, sum_ms, max_ms from ops.ops_metric
        where metric_key = 'webhook_latencia' and dimension = 'ok_200'
          and bucket_start = date_trunc('hour', $1::timestamptz)`,
      [at(T0 + 40 * 60000)]);
    assert.equal(rows.length, 1, 'uma linha por hora: nao duplica');
    assert.equal(Number(rows[0].value), 3);
    assert.equal(Number(rows[0].sum_ms), 420);
    assert.equal(Number(rows[0].max_ms), 250);

    const p = await painel();
    const entrada = p.metricas.find((m) => m.chave === 'webhook_latencia' && m.dimensao === 'ok_200');
    assert.ok(entrada, 'o painel mostra a metrica das ultimas 24 h');
    assert.equal(entrada.n, 3);
    assert.equal(entrada.soma_ms, 420);
    assert.equal(entrada.max_ms, 250);
  }));

test('T-H108-12 ops_metric sem coluna de identificador, texto livre ou jsonb', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'ops' and table_name = 'ops_metric' order by column_name`);
    assert.deepEqual(rows.map((r) => r.column_name),
      ['bucket_start', 'dimension', 'max_ms', 'metric_key', 'sum_ms', 'value']);
  }));

// T-H108-13 | privilegios e RLS: leitura so por app_system; app_api e papeis de borda sem acesso direto
test('T-H108-13 RLS forcada em ops_metric, sem politica e sem acesso direto a tabela', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'ops.ops_metric'::regclass`);
    assert.equal(rows[0].relrowsecurity, true, 'RLS habilitada');
    assert.equal(rows[0].relforcerowsecurity, true, 'RLS forcada');

    const { rows: pol } = await client.query(
      `select count(*)::int as n from pg_policies where schemaname = 'ops' and tablename = 'ops_metric'`);
    assert.equal(pol[0].n, 0, 'nenhuma politica de linha');

    for (const papel of ['anon', 'authenticated', 'service_role', 'app_api']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows: r } = await client.query(
          `select has_table_privilege($1, 'ops.ops_metric', $2) as ok`, [papel, priv]);
        assert.equal(r[0].ok, false, `${papel} sem ${priv} direto em ops_metric`);
      }
    }
  }));

test('T-H108-13 funcoes do painel executadas so por app_system', () =>
  tx(async () => {
    const funcoes = [
      'private.ops_panel_read(timestamptz)',
      'private.ops_metric_incr(text,text,timestamptz,bigint,bigint,bigint)',
    ];
    for (const f of funcoes) {
      const { rows } = await client.query(
        `select has_function_privilege('app_system', $1, 'execute') as sistema,
                has_function_privilege('app_api', $1, 'execute') as api,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as servico`, [f]);
      assert.equal(rows[0].sistema, true, `app_system executa ${f}`);
      assert.equal(rows[0].api, false, `app_api nao executa ${f}`);
      assert.equal(rows[0].anon, false, `anon nao executa ${f}`);
      assert.equal(rows[0].auth, false, `authenticated nao executa ${f}`);
      assert.equal(rows[0].servico, false, `service_role nao executa ${f}`);
    }
  }));

test('T-H108-13 funcao de leitura e security definer com search_path vazio', () =>
  tx(async () => {
    const { rows } = await client.query(
      `select prosecdef, proconfig from pg_proc where oid = 'private.ops_panel_read(timestamptz)'::regprocedure`);
    assert.equal(rows[0].prosecdef, true, 'security definer');
    const cfg = (rows[0].proconfig ?? []).find((c) => c.startsWith('search_path='));
    assert.ok(cfg, 'define search_path');
    assert.equal(cfg.replace(/"/g, '').replace('search_path=', ''), '', 'search_path vazio');
  }));

// T-H108-14 | sem PII: sentinelas de destinatario, parametros e telefone/CPF nao aparecem na resposta
test('T-H108-14 a resposta do painel nao contem dado pessoal semeado na fila', () =>
  tx(async () => {
    const sentinela = `sentinela-${randomUUID()}@example.test`;
    await item('falha', {
      reason: 'timeout',
      dedupe: `dedupe-${sentinela}`,
      params: { destinatario: sentinela, nome: 'Nome Sentinela', telefone: '11 99999-0000', cpf: '123.456.789-09' },
    });
    await item('pendente', { criadoEm: T0 - HORA, dedupe: `d2-${randomUUID()}`, params: { email: sentinela } });

    const texto = JSON.stringify(await painel());
    assert.equal(texto.includes(sentinela), false, 'nenhum e-mail da semente');
    assert.equal(texto.includes('Nome Sentinela'), false, 'nenhum nome da semente');
    assert.doesNotMatch(texto, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'nenhum padrao de e-mail');
    assert.doesNotMatch(texto, /\d{3}\.\d{3}\.\d{3}-\d{2}/, 'nenhum padrao de CPF');
    assert.doesNotMatch(texto, /\d{2}\s\d{5}-\d{4}/, 'nenhum padrao de telefone');
    assert.doesNotMatch(texto, /dedupe|template|destinatario/i, 'nenhum campo bruto da fila');
  }));
