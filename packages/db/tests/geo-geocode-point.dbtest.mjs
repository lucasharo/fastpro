// H-021 | Testes de banco da coordenada permanente (docs/factory/68-DESENHO-H021.md, §2, §3.2, §5; §7 G-03', G-05,
// G-06). Banco de desenvolvimento COMPARTILHADO: nada e gravado de forma permanente. O teste abre UMA transacao,
// aplica nela as migracoes 20261111370000 (tabelas) e 20261111390000 (funcoes) e faz rollback ao final; cada teste
// roda num savepoint que tambem e desfeito. Mes sintetico de 2099 para a cota. Sem rede.
// Executar: pnpm db:test (roda sozinho; nao executar em paralelo com outros testes de banco).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIG_TABELA = new URL('../../../supabase/migrations/20261111370000_geo_create_geocode_point.sql', import.meta.url);
const MIG_FUNCOES = new URL('../../../supabase/migrations/20261111390000_geo_create_geocode_functions.sql', import.meta.url);

const AGORA = '2099-08-15T12:00:00.000Z';
const MES = '2099-08-01';
const CAPS = { soft: 2, hard: 3 };
const SP_LON = -46.6333;
const SP_LAT = -23.5505;

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  await client.query(readFileSync(MIG_TABELA, 'utf8'));
  await client.query(readFileSync(MIG_FUNCOES, 'utf8'));
});

after(async () => {
  await client?.query('rollback');
  await client?.end();
});

const hash = (rotulo) => createHash('sha256').update(rotulo).digest('hex');

/** Executa `fn` num savepoint, sempre desfeito; o papel volta ao dono ao sair. */
async function isolado(fn) {
  await client.query('savepoint isolado');
  try {
    return await fn();
  } finally {
    // Primeiro o rollback do savepoint (recupera a transacao mesmo que o corpo tenha abortado); depois o papel.
    await client.query('rollback to savepoint isolado');
    await client.query('reset role');
  }
}

/** Captura o erro de uma instrucao sem abortar a transacao (savepoint proprio). */
async function erroDe(sql, params = []) {
  await client.query('savepoint erro');
  try {
    await client.query(sql, params);
  } catch (e) {
    await client.query('rollback to savepoint erro');
    return e;
  }
  await client.query('release savepoint erro');
  return null;
}

async function reservar(subject, rotulo, { agora = AGORA, lease = 60, cap = 3, caps = CAPS, kind = 'request' } = {}) {
  const soft = caps === null ? null : caps.soft;
  const hard = caps === null ? null : caps.hard;
  const { rows } = await client.query(
    'select out_acao, out_ref, out_point_id from private.geo_reserve($1, $2, $3, $4, $5, $6, $7, $8)',
    [kind, subject, hash(rotulo), agora, lease, cap, soft, hard],
  );
  return rows[0];
}

async function gravar(ref, lon = SP_LON, lat = SP_LAT, precisao = 'endereco') {
  const { rows } = await client.query(
    "select private.geo_store_permanent($1, 'permanent', $2, $3, $4, $5) as id",
    [ref, lon, lat, precisao, AGORA],
  );
  return rows[0].id;
}

async function linhaPonto(id) {
  const { rows } = await client.query(
    `select state, geocode_mode, precision,
            extensions.st_x(exact_point::extensions.geometry) as lon,
            extensions.st_y(exact_point::extensions.geometry) as lat
       from app.geocode_point where id = $1`,
    [id],
  );
  return rows[0];
}

async function contagemPedido(subject) {
  const { rows } = await client.query(
    `select calls from app.geocode_budget where subject_kind = 'request' and subject_id = $1`,
    [subject],
  );
  return rows[0]?.calls ?? null;
}

async function cota(mes = MES) {
  const { rows } = await client.query(
    `select used, soft_limit, hard_limit, alert_level, breaker_state
       from ops.external_quota where service = 'mapbox_permanent' and period = 'mes' and period_start = $1`,
    [mes],
  );
  return rows[0];
}

async function inserir({ subject = randomUUID(), rotulo = 'linha', estado = 'ok', ponto = true, modo = 'permanent', precisao = 'endereco', lon = SP_LON, lat = SP_LAT }) {
  const geo = ponto ? `extensions.st_setsrid(extensions.st_makepoint(${lon}, ${lat}), 4326)::extensions.geography` : 'null';
  return erroDe(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision)
     values ('request', $1, $2, $3, ${geo}, $4, $5)`,
    [subject, hash(rotulo), estado, modo, precisao],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// CA-4 / G-05 | CHECKs da tabela, como dono (SQL direto).
// ---------------------------------------------------------------------------------------------------------------

test('CA-4: ponto sem selo permanente (modo nulo) e recusado pelo CHECK', () =>
  isolado(async () => {
    const e = await inserir({ modo: null });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: modo temporary e recusado (so existe permanent no dominio)', () =>
  isolado(async () => {
    const e = await inserir({ modo: 'temporary' });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: ponto fora do Brasil e recusado pelo CHECK da caixa', () =>
  isolado(async () => {
    const e = await inserir({ lon: 10, lat: 10 });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: eixos invertidos (latitude no lugar da longitude) e recusado', () =>
  isolado(async () => {
    const e = await inserir({ lon: SP_LAT, lat: SP_LON });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: estado ok sem ponto e recusado (ponto e estado andam juntos)', () =>
  isolado(async () => {
    const e = await inserir({ ponto: false, modo: null });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: estado ok sem precisao gravada e recusado', () =>
  isolado(async () => {
    const e = await inserir({ precisao: null });
    assert.equal(e?.code, '23514');
  }));

test('CA-4: hash de endereco fora do formato HMAC hexadecimal e recusado', () =>
  isolado(async () => {
    const e = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state) values ('request', $1, 'texto-em-claro', 'aguardando')`,
      [randomUUID()],
    );
    assert.equal(e?.code, '23514');
  }));

test('CA-5/teto: contador do pedido acima de 3 e recusado pelo CHECK do orcamento', () =>
  isolado(async () => {
    const e = await erroDe(
      `insert into app.geocode_budget (subject_kind, subject_id, calls) values ('request', $1, 4)`,
      [randomUUID()],
    );
    assert.equal(e?.code, '23514');
  }));

test('CA-4: linha permanente valida e aceita (controle positivo)', () =>
  isolado(async () => {
    const e = await inserir({});
    assert.equal(e, null);
  }));

// ---------------------------------------------------------------------------------------------------------------
// G-05 | Permissoes: nenhum papel de aplicacao le ou escreve as tabelas direto.
// ---------------------------------------------------------------------------------------------------------------

// Privilegios por papel, lidos do catalogo (has_table_privilege / has_function_privilege). Nao trocamos de papel
// (SET ROLE): o papel de conexao nao tem a opcao SET para app_system, app_api nem app_backup_reader nesta base.
// O que o catalogo nao prova (que a negacao acontece na execucao real do papel) fica como NAO_VERIFICAVEL.
for (const papel of ['app_system', 'app_api', 'app_backup_reader']) {
  test(`G-05 (catalogo): ${papel} sem INSERT, UPDATE, DELETE nem SELECT nas tabelas da coordenada`, async () => {
    const { rows } = await client.query(
      `select has_table_privilege($1, 'app.geocode_point', 'SELECT, INSERT, UPDATE, DELETE') as pt,
              has_table_privilege($1, 'app.geocode_budget', 'SELECT, INSERT, UPDATE, DELETE') as bt`,
      [papel],
    );
    assert.equal(rows[0].pt, false, `${papel} tem privilegio em app.geocode_point`);
    assert.equal(rows[0].bt, false, `${papel} tem privilegio em app.geocode_budget`);
  });
}

test('G-05 (catalogo): so app_system executa as funcoes da coordenada', async () => {
  const funcoes = [
    'private.geo_reserve(text,uuid,text,timestamptz,integer,integer,integer,integer)',
    'private.geo_store_permanent(uuid,text,double precision,double precision,text,timestamptz)',
    'private.geo_mark_no_result(uuid,timestamptz)',
    'private.geo_release(uuid)',
    'private.geo_panel(timestamptz)',
    'private.mapbox_permanent_quota_take(timestamptz,integer,integer)',
  ];
  for (const f of funcoes) {
    const { rows } = await client.query(
      `select has_function_privilege('app_system', $1, 'EXECUTE') as sys,
              has_function_privilege('app_api', $1, 'EXECUTE') as api,
              has_function_privilege('app_backup_reader', $1, 'EXECUTE') as bkp`,
      [f],
    );
    assert.deepEqual([rows[0].sys, rows[0].api, rows[0].bkp], [true, false, false], f);
  }
});

test('G-05 (catalogo): as funcoes sao security definer com search_path vazio', async () => {
  const { rows } = await client.query(`
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and (p.proname like 'geo\\_%' or p.proname = 'mapbox_permanent_quota_take')`);
  assert.ok(rows.length >= 6, `funcoes encontradas: ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.prosecdef, true, r.proname);
    assert.ok((r.proconfig ?? []).some((x) => x.startsWith('search_path=')), `${r.proname} sem search_path`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// G-05 | A funcao de gravacao so aceita o selo permanente, caixa e reserva viva.
// ---------------------------------------------------------------------------------------------------------------

test('G-05: gravar com modo temporary e recusado e a linha continua reservada', () =>
  isolado(async () => {
    const subject = randomUUID();
    const r = await reservar(subject, 'rua a 10');
    assert.equal(r.out_acao, 'chamar');
    const e = await erroDe(
      `select private.geo_store_permanent($1, 'temporary', $2, $3, 'endereco', $4)`,
      [r.out_ref, SP_LON, SP_LAT, AGORA],
    );
    assert.equal(e?.code, '22023');
    assert.match(e.message, /geo_modo_nao_permanente/);
    const { rows } = await client.query('select state from app.geocode_point where id = $1', [r.out_ref]);
    assert.equal(rows[0].state, 'reservado');
  }));

test('G-05: gravar sem reserva viva e recusado', () =>
  isolado(async () => {
    const e = await erroDe(
      `select private.geo_store_permanent($1, 'permanent', $2, $3, 'endereco', $4)`,
      [randomUUID(), SP_LON, SP_LAT, AGORA],
    );
    assert.equal(e?.code, 'P0001');
    assert.match(e.message, /geo_store_sem_reserva/);
  }));

test('G-05: gravar fora do Brasil pela funcao e recusado mesmo com reserva', () =>
  isolado(async () => {
    const r = await reservar(randomUUID(), 'rua b 20');
    const e = await erroDe(
      `select private.geo_store_permanent($1, 'permanent', 10, 10, 'endereco', $2)`,
      [r.out_ref, AGORA],
    );
    assert.match(e.message, /geo_ponto_fora_do_brasil/);
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-1 / CA-2 | Sequencia completa como app_system (o papel real de chamada).
// ---------------------------------------------------------------------------------------------------------------

test('CA-1/CA-2: publicar grava uma vez; repetir reutiliza sem nova reserva paga (como dono; app_system NAO_VERIFICAVEL na execucao)', () =>
  isolado(async () => {
    const subject = randomUUID();

    const primeira = await reservar(subject, 'rua alfa 10');
    assert.equal(primeira.out_acao, 'chamar');
    assert.ok(primeira.out_ref);

    const concorrente = await reservar(subject, 'rua alfa 10');
    assert.equal(concorrente.out_acao, 'em_andamento');

    const pontoId = await gravar(primeira.out_ref);
    assert.equal(pontoId, primeira.out_ref);

    const linha = await linhaPonto(pontoId);
    assert.equal(linha.state, 'ok');
    assert.equal(linha.geocode_mode, 'permanent');
    assert.equal(linha.precision, 'endereco');
    assert.equal(Number(linha.lon), SP_LON);
    assert.equal(Number(linha.lat), SP_LAT);

    const repetida = await reservar(subject, 'rua alfa 10');
    assert.equal(repetida.out_acao, 'reutilizar');
    assert.equal(repetida.out_point_id, pontoId);

    assert.equal(await contagemPedido(subject), 1);
    assert.equal((await cota()).used, 1);
  }));

test('CA-2: reserva vencida (fora da concessao) e retomada; a chamada conta de novo', () =>
  isolado(async () => {
    const subject = randomUUID();
    const r1 = await reservar(subject, 'rua vencida 1');
    assert.equal(r1.out_acao, 'chamar');
    const depois = new Date(Date.parse(AGORA) + 61_000).toISOString();
    const r2 = await reservar(subject, 'rua vencida 1', { agora: depois, lease: 60 });
    assert.equal(r2.out_acao, 'chamar');
    assert.equal(await contagemPedido(subject), 2);
  }));

test('CA-2: sem resultado nao cobra de novo o mesmo texto', () =>
  isolado(async () => {
    const subject = randomUUID();
    const r = await reservar(subject, 'rua inexistente 9');
    const id = (await client.query('select private.geo_mark_no_result($1, $2) as ok', [r.out_ref, AGORA])).rows[0].ok;
    assert.equal(id, true);
    const de_novo = await reservar(subject, 'rua inexistente 9');
    assert.equal(de_novo.out_acao, 'sem_resultado');
    assert.equal(await contagemPedido(subject), 1);
  }));

test('CA-2: marcar sem resultado sem reserva viva e recusado', () =>
  isolado(async () => {
    const e = await erroDe('select private.geo_mark_no_result($1, $2)', [randomUUID(), AGORA]);
    assert.match(e.message, /geo_store_sem_reserva/);
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-5 | Teto por pedido, breaker de cota, alerta uma vez, painel, teto ausente e liberacao.
// ---------------------------------------------------------------------------------------------------------------

test('CA-5: o 4o endereco distinto do mesmo pedido recebe teto, sem consumir cota', () =>
  isolado(async () => {
    const subject = randomUUID();
    const caps = { soft: 2, hard: 10 };
    for (const rot of ['a 1', 'b 2', 'c 3']) {
      assert.equal((await reservar(subject, rot, { caps })).out_acao, 'chamar');
    }
    assert.equal((await reservar(subject, 'd 4', { caps })).out_acao, 'teto');
    assert.equal(await contagemPedido(subject), 3);
    assert.equal((await cota()).used, 3);
  }));

test('CA-5: outro pedido comeca do zero (teto por cadeia, nao global)', () =>
  isolado(async () => {
    const caps = { soft: 2, hard: 10 };
    for (const rot of ['a 1', 'b 2', 'c 3']) await reservar(randomUUID(), rot, { caps });
    assert.equal((await reservar(randomUUID(), 'd 4', { caps })).out_acao, 'chamar');
  }));

test('CA-5: cota no limite vira breaker; linha aguardando sem ponto; alerta de nivel 2; painel mostra', () =>
  isolado(async () => {
    const subject = randomUUID();
    const caps = { soft: 1, hard: 1 };
    const primeira = await reservar(subject, 'rua 1', { caps });
    assert.equal(primeira.out_acao, 'chamar');
    assert.equal((await cota()).alert_level, 1);

    const bloqueada = await reservar(subject, 'rua 2', { caps });
    assert.equal(bloqueada.out_acao, 'breaker');
    assert.equal(await contagemPedido(subject), 1);

    const c = await cota();
    assert.equal(c.used, 1);
    assert.equal(c.alert_level, 2);
    assert.equal(c.breaker_state, 'aberto');

    const { rows: aguardando } = await client.query(
      `select state, exact_point from app.geocode_point where subject_id = $1 and address_hash = $2`,
      [subject, hash('rua 2')],
    );
    assert.equal(aguardando[0].state, 'aguardando');
    assert.equal(aguardando[0].exact_point, null);

    const { rows: painel } = await client.query('select * from private.geo_panel($1)', [AGORA]);
    assert.equal(painel[0].out_used, 1);
    assert.equal(painel[0].out_hard, 1);
    assert.equal(painel[0].out_breaker_state, 'aberto');
    assert.equal(painel[0].out_alert_level, 2);
    assert.ok(Number(painel[0].out_aguardando) >= 1);
  }));

test('CA-5: aumentar o teto reabre; o texto aguardando vira chamada e paga uma vez', () =>
  isolado(async () => {
    const subject = randomUUID();
    await reservar(subject, 'rua 1', { caps: { soft: 1, hard: 1 } });
    assert.equal((await reservar(subject, 'rua 2', { caps: { soft: 1, hard: 1 } })).out_acao, 'breaker');
    const reaberta = await reservar(subject, 'rua 2', { caps: { soft: 1, hard: 2 } });
    assert.equal(reaberta.out_acao, 'chamar');
    assert.equal((await cota()).used, 2);
  }));

test('CA-5: teto ausente ou invalido = breaker, sem consumir cota nem teto', () =>
  isolado(async () => {
    const subject = randomUUID();
    assert.equal((await reservar(subject, 'rua x', { caps: null })).out_acao, 'breaker');
    assert.equal((await reservar(subject, 'rua x', { caps: { soft: 5, hard: 2 } })).out_acao, 'breaker');
    assert.equal(await cota(), undefined);
    // A linha de orcamento e criada antes da decisao (com calls = 0); o breaker nao a incrementa.
    assert.equal(await contagemPedido(subject), 0);
  }));

test('CA-5: mes novo reabre o breaker com o mesmo teto', () =>
  isolado(async () => {
    const subject = randomUUID();
    const caps = { soft: 1, hard: 1 };
    await reservar(subject, 'rua 1', { caps });
    assert.equal((await reservar(subject, 'rua 2', { caps })).out_acao, 'breaker');
    const proximoMes = '2099-09-01T12:00:00.000Z';
    assert.equal((await reservar(subject, 'rua 2', { caps, agora: proximoMes })).out_acao, 'chamar');
    assert.equal((await cota('2099-09-01')).used, 1);
  }));

test('CA-5: falha do provedor (liberacao) devolve o teto do pedido e mantem a cota consumida', () =>
  isolado(async () => {
    const subject = randomUUID();
    const r = await reservar(subject, 'rua falha 1');
    assert.equal(await contagemPedido(subject), 1);
    const liberado = (await client.query('select private.geo_release($1) as ok', [r.out_ref])).rows[0].ok;
    assert.equal(liberado, true);
    assert.equal(await contagemPedido(subject), 0);
    const { rows } = await client.query('select count(*)::int as n from app.geocode_point where id = $1', [r.out_ref]);
    assert.equal(rows[0].n, 0);
    assert.equal((await cota()).used, 1);
    assert.equal((await reservar(subject, 'rua falha 1')).out_acao, 'chamar');
  }));

test('CA-5: liberar sem reserva viva e recusado', () =>
  isolado(async () => {
    const e = await erroDe('select private.geo_release($1)', [randomUUID()]);
    assert.match(e.message, /geo_store_sem_reserva/);
  }));

test('CA-5: cota direta: 2o aviso uma vez; teto recusa sem passar do hard', () =>
  isolado(async () => {
    const q = async () =>
      (await client.query('select * from private.mapbox_permanent_quota_take($1, 1, 2)', [AGORA])).rows[0];
    const a = await q();
    assert.deepEqual([a.out_ok, a.out_novo_alerta, a.out_used], [true, true, 1]);
    const b = await q();
    assert.deepEqual([b.out_ok, b.out_novo_alerta, b.out_used], [true, false, 2]);
    const c = await q();
    assert.deepEqual([c.out_ok, c.out_novo_alerta, c.out_used], [false, true, 2]);
    const d = await q();
    assert.deepEqual([d.out_ok, d.out_novo_alerta, d.out_used], [false, false, 2]);
    assert.equal((await cota()).used, 2);
  }));

test('CA-5: cota com tetos invalidos e recusada com erro', () =>
  isolado(async () => {
    const e = await erroDe('select * from private.mapbox_permanent_quota_take($1, 5, 2)', [AGORA]);
    assert.match(e.message, /quota_entrada_invalida/);
  }));

test('CA-5: painel sem linha de cota mostra zero, breaker fechado e sem teto', () =>
  isolado(async () => {
    const { rows } = await client.query('select * from private.geo_panel($1)', ['2099-11-01T00:00:00.000Z']);
    assert.equal(rows[0].out_used, 0);
    assert.equal(rows[0].out_soft, null);
    assert.equal(rows[0].out_hard, null);
    assert.equal(rows[0].out_breaker_state, 'fechado');
    assert.equal(rows[0].out_alert_level, 0);
  }));

test('G-05: entrada invalida na reserva (hash ou assunto) e recusada antes de qualquer efeito', () =>
  isolado(async () => {
    const e1 = await erroDe(
      'select * from private.geo_reserve($1, $2, $3, $4, 60, 3, 2, 3)',
      ['request', randomUUID(), 'curto', AGORA],
    );
    assert.equal(e1?.code, '22023');
    const e2 = await erroDe(
      'select * from private.geo_reserve($1, $2, $3, $4, 60, 3, 2, 3)',
      ['outro', randomUUID(), hash('x'), AGORA],
    );
    assert.equal(e2?.code, '22023');
    assert.equal(await cota(), undefined);
  }));
