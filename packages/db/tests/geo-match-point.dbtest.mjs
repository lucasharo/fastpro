// H-022 | Testes de banco da celula generalizada e do match_point (docs/factory/88-DESENHO-H022.md, §8).
// Banco de desenvolvimento COMPARTILHADO: nada e gravado de forma permanente. O teste abre UMA transacao,
// aplica nela 20261111370000 e 20261111390000 (H-021) e 20261112120500 (H-022), e faz rollback ao final;
// cada teste roda num savepoint que tambem e desfeito. Dados 100 % sinteticos, sem rede (RF-163).
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/geo-match-point.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { connect } from '../scripts/lib/env.mjs';

const ARQ = (caminho) => new URL(`../../../${caminho}`, import.meta.url);
const MIG_TABELA = ARQ('supabase/migrations/20261111370000_geo_create_geocode_point.sql');
const MIG_FUNCOES = ARQ('supabase/migrations/20261111390000_geo_create_geocode_functions.sql');
const MIG_MATCH = ARQ('supabase/migrations/20261112120500_geo_expand_match_point.sql');
const DOWN_MATCH = ARQ('supabase/rollbacks/20261112120500_geo_expand_match_point.down.sql');
const DOURADOS = JSON.parse(readFileSync(new URL('./fixtures/geo-match-point-dourados.json', import.meta.url), 'utf8'));

const AGORA = '2099-08-15T12:00:00.000Z';
const SP = { lon: -46.6333, lat: -23.5505 };
const RAIO_TOLERANCIA_M = 10;
const LIMITE_ERRO_M = 355;
const R_TERRA = 6371008.8;

// Remove BEGIN/COMMIT/ROLLBACK dos arquivos: o teste ja esta numa transacao, e um COMMIT interno a encerraria.
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');

// Haversine em SQL (esfera 6 371 008,8 m). Mesma formula do banco; usada como medida independente nos testes.
const DIST = (a, b, c, d) => {
  const soma = `sqrt(power(sin(radians((${b}) - (${d})) / 2), 2) + cos(radians(${d})) * cos(radians(${b})) * power(sin(radians((${a}) - (${c})) / 2), 2))`;
  return `(2 * ${R_TERRA} * asin(least(1::float8, ${soma})))`;
};

// Haversine em JavaScript (para os pontos isolados dos testes de extremos e fronteira).
function haversine(lon1, lat1, lon2, lat2) {
  const k = Math.PI / 180;
  const dLat = (lat2 - lat1) * k;
  const dLon = (lon2 - lon1) * k;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}

const BASES = [
  [-46.63, -23.55], [-43.17, -22.91], [-38.54, -3.73], [-47.88, -15.79], [-51.23, -30.03],
  [-60.02, -3.12], [-48.5, -1.46], [-49.27, -25.43], [-35.21, -5.79], [-56.1, -15.6],
];

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  await client.query(readFileSync(MIG_TABELA, 'utf8'));
  await client.query(readFileSync(MIG_FUNCOES, 'utf8'));
  await client.query(semControle(readFileSync(MIG_MATCH, 'utf8')));
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

async function reservar(subject, rotulo) {
  const { rows } = await client.query(
    'select out_acao, out_ref from private.geo_reserve($1, $2, $3, $4, $5, $6, $7, $8)',
    ['request', subject, hash(rotulo), AGORA, 60, 3, 2, 3],
  );
  return rows[0];
}

async function gravar(ref, lon = SP.lon, lat = SP.lat) {
  await client.query("select private.geo_store_permanent($1, 'permanent', $2, $3, 'endereco', $4)", [
    ref,
    lon,
    lat,
    AGORA,
  ]);
}

async function publicar(rotulo, lon = SP.lon, lat = SP.lat) {
  const subject = randomUUID();
  const r = await reservar(subject, rotulo);
  await gravar(r.out_ref, lon, lat);
  return { subject, ref: r.out_ref };
}

async function linha(id) {
  const { rows } = await client.query(
    `select state, match_cell, match_lon, match_lat, match_grid_version,
            extensions.st_x(exact_point::extensions.geometry) as lon,
            extensions.st_y(exact_point::extensions.geometry) as lat
       from app.geocode_point where id = $1`,
    [id],
  );
  return rows[0];
}

async function grade(lon, lat) {
  const { rows } = await client.query('select out_cell, out_c_lon, out_c_lat from private.match_grid(1::smallint, $1::float8, $2::float8)', [lon, lat]);
  return rows[0];
}

async function semear(n, seed, bases = BASES) {
  await client.query('select setseed($1)', [seed]);
  await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     select 'request', gen_random_uuid(), md5(s::text) || md5((s + 7919)::text), 'ok',
            extensions.st_setsrid(extensions.st_makepoint(
              ($1::float8[])[(s % $3::int) + 1] + (random() - 0.5),
              ($2::float8[])[(s % $3::int) + 1] + (random() - 0.5)), 4326)::extensions.geography,
            'permanent', 'endereco', $4::timestamptz
       from generate_series(1, $5::int) s`,
    [bases.map((b) => b[0]), bases.map((b) => b[1]), bases.length, AGORA, n],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// CA-02 e CA-01 | Determinismo e gravacao atomica (gatilho na mesma instrucao).
// ---------------------------------------------------------------------------------------------------------------

test('T-CA01: publicar grava exact_point e os quatro match_* na mesma linha', () =>
  isolado(async () => {
    const { ref } = await publicar('ca01-ok');
    const l = await linha(ref);
    const esperado = await grade(SP.lon, SP.lat);
    assert.equal(l.state, 'ok');
    assert.equal(l.match_cell, esperado.out_cell);
    assert.equal(l.match_lon, esperado.out_c_lon);
    assert.equal(l.match_lat, esperado.out_c_lat);
    assert.equal(l.match_grid_version, 1);
  }));

test('T-CA01: falha no calculo aborta a instrucao: estado segue reservado, sem exact_point nem match_*', () =>
  isolado(async () => {
    const subject = randomUUID();
    const r = await reservar(subject, 'ca01-falha');
    // Falha injetada: a grade passa a recusar qualquer ponto (so dentro desta transacao; o desfazer restaura).
    await client.query(`
      create or replace function private.match_grid(p_version smallint, p_lon double precision, p_lat double precision)
      returns table (out_cell integer, out_c_lon double precision, out_c_lat double precision)
      language plpgsql set search_path = ''
      as $$ begin raise exception 'match_grade_fora_do_dominio' using errcode = '22023'; end $$`);
    const e = await erroDe(
      "select private.geo_store_permanent($1, 'permanent', $2, $3, 'endereco', $4)",
      [r.out_ref, SP.lon, SP.lat, AGORA],
    );
    assert.equal(e?.code, '22023');
    const l = await linha(r.out_ref);
    assert.equal(l.state, 'reservado');
    assert.equal(l.lon, null);
    assert.equal(l.match_cell, null);
    assert.equal(l.match_lon, null);
  }));

test('T-CA02: mesma coordenada em duas linhas e duas execucoes gera o mesmo match_*', () =>
  isolado(async () => {
    const a = await publicar('ca02-a');
    const b = await publicar('ca02-b');
    const la = await linha(a.ref);
    const lb = await linha(b.ref);
    assert.deepEqual(
      [la.match_cell, la.match_lon, la.match_lat],
      [lb.match_cell, lb.match_lon, lb.match_lat],
    );
    assert.deepEqual(await grade(SP.lon, SP.lat), await grade(SP.lon, SP.lat));
  }));

test('T-CA02: repetir a publicacao (reutilizar) e recalcular a mesma linha nao altera o match_*', () =>
  isolado(async () => {
    const a = await publicar('ca02-repete');
    const antes = await linha(a.ref);
    const r = await reservar(a.subject, 'ca02-repete');
    assert.equal(r.out_acao, 'reutilizar');
    await client.query('update app.geocode_point set exact_point = exact_point where id = $1', [a.ref]);
    const depois = await linha(a.ref);
    assert.deepEqual(depois, antes);
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-04 e G-05 | Origem do match_*: CHECKs e gatilho, como dono (SQL direto).
// ---------------------------------------------------------------------------------------------------------------

test('T-CA04: match_* sem exact_point e recusado pelo gatilho (23514, texto fixo)', () =>
  isolado(async () => {
    const e = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, match_cell, match_lon, match_lat, match_grid_version)
       values ('request', $1, $2, 'aguardando', 424242, -46.5, -23.5, 1)`,
      [randomUUID(), hash('t04-a')],
    );
    assert.equal(e?.code, '23514');
    assert.equal(e?.message, 'match_sem_exact_point');
  }));

test('T-CA04: exact_point sem modo permanent e recusado pelo CHECK de selo', () =>
  isolado(async () => {
    const e = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision)
       values ('request', $1, $2, 'ok', extensions.st_setsrid(extensions.st_makepoint(-46.5, -23.5), 4326)::extensions.geography, null, 'endereco')`,
      [randomUUID(), hash('t04-b')],
    );
    assert.equal(e?.code, '23514');
  }));

test('T-CA04: match_* forjado com exact_point valido e sobrescrito pelo calculo', () =>
  isolado(async () => {
    const subject = randomUUID();
    const { rows } = await client.query(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision,
                                      match_cell, match_lon, match_lat, match_grid_version)
       values ('request', $1, $2, 'ok', extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
               'permanent', 'endereco', 1, -33.5, 6.5, 1)
       returning id`,
      [subject, hash('t04-forjado'), SP.lon, SP.lat],
    );
    const l = await linha(rows[0].id);
    const esperado = await grade(SP.lon, SP.lat);
    assert.equal(l.match_cell, esperado.out_cell);
    assert.equal(l.match_lon, esperado.out_c_lon);
    assert.equal(l.match_lat, esperado.out_c_lat);
  }));

test('T-CA04 (CHECK, gatilho desligado): match_* parcial (1 a 3 nulos) e recusado', () =>
  isolado(async () => {
    await client.query('alter table app.geocode_point disable trigger geocode_point_match_biu');
    const e = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, match_cell)
       values ('request', $1, $2, 'aguardando', 1)`,
      [randomUUID(), hash('t04-parcial')],
    );
    assert.equal(e?.code, '23514');
  }));

test('T-CA04 (CHECK, gatilho desligado): origem sem exact_point e dominio fora do Brasil sao recusados', () =>
  isolado(async () => {
    await client.query('alter table app.geocode_point disable trigger geocode_point_match_biu');
    const origem = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, match_cell, match_lon, match_lat, match_grid_version)
       values ('request', $1, $2, 'aguardando', 1, -46.5, -23.5, 1)`,
      [randomUUID(), hash('t04-origem')],
    );
    assert.equal(origem?.code, '23514');
    const dominio = await erroDe(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision,
                                      match_cell, match_lon, match_lat, match_grid_version)
       values ('request', $1, $2, 'ok', extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
               'permanent', 'endereco', 1, 10, 10, 1)`,
      [randomUUID(), hash('t04-dominio'), SP.lon, SP.lat],
    );
    assert.equal(dominio?.code, '23514');
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-05 | Privacidade: catalogo (T-CA05a/b), mensagens (T-CA05c) e papel real.
// ---------------------------------------------------------------------------------------------------------------

test('T-CA05a: nenhum papel de API ou de servico tem DML nem SELECT em app.geocode_point (catalogo)', async () => {
  const { rows } = await client.query(
    `select r.papel,
            has_table_privilege(r.papel, 'app.geocode_point', 'SELECT, INSERT, UPDATE, DELETE') as tem
       from (values ('app_api'), ('app_system'), ('anon'), ('authenticated'), ('app_backup_reader')) r(papel)`,
  );
  for (const r of rows) assert.equal(r.tem, false, `papel ${r.papel} com privilegio indevido`);
  const { rows: publico } = await client.query(
    `select count(*)::int as n from pg_class c, lateral aclexplode(c.relacl) a
      where c.oid = 'app.geocode_point'::regclass and a.grantee = 0`,
  );
  assert.equal(publico[0].n, 0, 'PUBLIC com privilegio em app.geocode_point');
  const { rows: vis } = await client.query(
    `select (select count(*) from pg_views where definition ilike '%exact_point%')::int
          + (select count(*) from pg_matviews where definition ilike '%exact_point%')::int as n`,
  );
  assert.equal(vis[0].n, 0, 'alguma view referencia exact_point');
});

test('T-CA05b: so app_system executa funcoes que tocam exact_point (lista fechada)', async () => {
  const { rows } = await client.query(
    `select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'private', 'public', 'extensions', 'ops', 'api')
        and p.prosrc ilike '%exact_point%'
        and (has_function_privilege('app_api', p.oid, 'EXECUTE')
             or has_function_privilege('app_system', p.oid, 'EXECUTE')
             or p.proacl is null
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
      order by p.proname`,
  );
  // Lista fechada atualizada na #140 (triagem do db:test): request_publish_commit (H-031,
  // docs/factory/110-DESENHO-H031 §4.4 e D-04) toca exact_point e e executada so por app_system.
  assert.deepEqual(rows.map((r) => r.proname), ['geo_store_permanent', 'request_publish_commit']);
  const apiExecuta = await client.query(
    `select has_function_privilege('app_api', 'private.request_publish_commit(uuid,uuid,text,text,text,integer,uuid,boolean,timestamptz)'::regprocedure, 'EXECUTE') as n`,
  );
  assert.equal(apiExecuta.rows[0].n, false, 'app_api nao executa request_publish_commit (H-031 D-04)');
});

test('T-CA05b: o retorno de match_points_within e exatamente subject, centro e distancia', async () => {
  const { rows } = await client.query(
    "select pg_get_function_result('private.match_points_within(double precision,double precision,integer,integer,smallint)'::regprocedure) as r",
  );
  assert.equal(
    rows[0].r,
    'TABLE(out_subject_id uuid, out_match_lon double precision, out_match_lat double precision, out_distance_m integer)',
  );
});

// O papel conectado (postgres) nao e membro de app_api nem de app_system: SET ROLE e negado. A verificacao de
// privilegio e feita pelo catalogo, que e o que o Postgres usa na checagem de EXECUTE.
test('T-CA05b: EXECUTE de match_points_within so para app_system (catalogo; app_api sem permissao)', async () => {
  const { rows } = await client.query(
    `select has_function_privilege('app_system', 'private.match_points_within(double precision,double precision,integer,integer,smallint)'::regprocedure, 'EXECUTE') as sistema,
            has_function_privilege('app_api', 'private.match_points_within(double precision,double precision,integer,integer,smallint)'::regprocedure, 'EXECUTE') as api,
            has_function_privilege('app_backup_reader', 'private.match_points_within(double precision,double precision,integer,integer,smallint)'::regprocedure, 'EXECUTE') as bkp`,
  );
  assert.deepEqual(rows[0], { sistema: true, api: false, bkp: false });
});

test('T-CA05b: a consulta devolve so subject_id, centro e distancia; nenhum valor e o ponto exato', () =>
  isolado(async () => {
    const a = await publicar('t05b-app', SP.lon, SP.lat);
    const { rows } = await client.query(
      'select * from private.match_points_within($1, $2, 100000, 50, 1::smallint)',
      [SP.lon + 0.01, SP.lat + 0.01],
    );
    assert.ok(rows.length >= 1);
    assert.deepEqual(Object.keys(rows[0]), ['out_subject_id', 'out_match_lon', 'out_match_lat', 'out_distance_m']);
    for (const r of rows) {
      for (const v of Object.values(r)) {
        assert.notEqual(v, SP.lon);
        assert.notEqual(v, SP.lat);
      }
    }
    assert.ok(rows.some((r) => r.out_subject_id === a.subject));
  }));

test('T-CA05c: erros das funcoes novas nao repetem o valor de entrada (canario numerico)', async () => {
  const canario = '987654.321';
  const mensagens = [];
  for (const sql of [
    `select * from private.match_grid(1::smallint, ${canario}::float8, 0)`,
    `select * from private.match_points_within(-46.6, -23.5, 987654, 10, 1::smallint)`,
    `select * from private.match_points_within(-46.6, -23.5, 1000, 10, 7::smallint)`,
  ]) {
    const e = await erroDe(sql);
    if (e) mensagens.push(e.message);
  }
  const e2 = await erroDe(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, match_cell)
     values ('request', $1, $2, 'aguardando', 424242)`,
    [randomUUID(), hash('t05c')],
  );
  if (e2) mensagens.push(e2.message);
  assert.ok(mensagens.length >= 3, 'erros esperados nao ocorreram');
  for (const m of mensagens) {
    assert.doesNotMatch(m, /987654|424242/);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// CA-06 | Triangulacao: dois pontos na mesma celula produzem a mesma resposta.
// ---------------------------------------------------------------------------------------------------------------

test('T-CA06: dois pontos na mesma celula devolvem linhas identicas para 20 bases', () =>
  isolado(async () => {
    const centro = await grade(SP.lon, SP.lat);
    const pa = [centro.out_c_lon + 0.0001, centro.out_c_lat + 0.0001];
    const pb = [centro.out_c_lon - 0.0001, centro.out_c_lat - 0.0001];
    assert.equal((await grade(...pa)).out_cell, centro.out_cell);
    assert.equal((await grade(...pb)).out_cell, centro.out_cell);
    const a = await publicar('t06-a', ...pa);
    const b = await publicar('t06-b', ...pb);
    for (let i = 0; i < 20; i++) {
      const base = [SP.lon + 0.05 * Math.cos(i), SP.lat + 0.05 * Math.sin(i)];
      const { rows } = await client.query(
        'select out_subject_id, out_match_lon, out_match_lat, out_distance_m from private.match_points_within($1::float8, $2::float8, 100000, 50, 1::smallint)',
        base,
      );
      const ra = rows.find((r) => r.out_subject_id === a.subject);
      const rb = rows.find((r) => r.out_subject_id === b.subject);
      assert.ok(ra && rb, `base ${i} sem os dois pedidos`);
      assert.deepEqual(
        [ra.out_match_lon, ra.out_match_lat, ra.out_distance_m],
        [rb.out_match_lon, rb.out_match_lat, rb.out_distance_m],
        `base ${i} distingue os dois pontos`,
      );
    }
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-03 | Precisao: erro maximo ponto -> centro <= 355 m (medido na esfera), por faixa de latitude.
// ---------------------------------------------------------------------------------------------------------------

async function erroMaximo(seed, n, latMin, latMax) {
  await client.query('select setseed($1)', [seed]);
  const { rows } = await client.query(
    `with p as (
       select -74 + 40 * random() as lon, $2::float8 + ($3::float8 - $2::float8) * random() as lat
         from generate_series(1, $1::int)
     ), m as (
       select p.lon, p.lat, g.out_c_lon as clon, g.out_c_lat as clat
         from p cross join lateral private.match_grid(1::smallint, p.lon, p.lat) g
     )
     select max(${DIST('lon', 'lat', 'clon', 'clat')}) as maximo, count(*)::int as n from m`,
    [n, latMin, latMax],
  );
  return rows[0];
}

for (const [nome, latMin, latMax, seed] of [
  ['Norte', -5, 6, 0.11],
  ['Centro', -20, -5, 0.22],
  ['Sul', -34, -20, 0.33],
]) {
  test(`T-CA03 (${nome}): 100.000 pontos sinteticos, erro maximo <= 355 m`, () =>
    isolado(async () => {
      const r = await erroMaximo(seed, 100000, latMin, latMax);
      console.log(`    [T-CA03 ${nome}] pontos=${r.n} erro_maximo_m=${Number(r.maximo).toFixed(3)} limite_m=${LIMITE_ERRO_M}`);
      assert.equal(r.n, 100000);
      assert.ok(Number(r.maximo) <= LIMITE_ERRO_M, `erro maximo ${r.maximo}`);
    }));
}

// ---------------------------------------------------------------------------------------------------------------
// CA-09 | Borda de grade: extremos, fronteira de linha e de coluna, ida e volta.
// ---------------------------------------------------------------------------------------------------------------

test('T-CA09: extremos do territorio recebem celula, centro no dominio e erro <= 355 m', async () => {
  const extremos = [
    ['Oiapoque', -51.8, 4.4], ['Monte Caburai', -60.213333, 5.266667], ['Chui', -53.373611, -33.751111],
    ['Ponta do Seixas', -34.7925, -7.15], ['Serra do Divisor', -73.833333, -7.5],
    ['canto NO', -74, 6], ['canto NE', -34, 6], ['canto SO', -74, -34], ['canto SE', -34, -34],
  ];
  for (const [nome, lon, lat] of extremos) {
    const g = await grade(lon, lat);
    assert.ok(g.out_c_lon >= -75 && g.out_c_lon <= -33, `${nome}: longitude do centro fora do dominio`);
    assert.ok(g.out_c_lat >= -35 && g.out_c_lat <= 7, `${nome}: latitude do centro fora do dominio`);
    assert.ok(haversine(lon, lat, g.out_c_lon, g.out_c_lat) <= LIMITE_ERRO_M, `${nome}: erro acima de 355 m`);
  }
});

test('T-CA09: ponto em lat_u = LAT0 + k*DLAT cai na linha k; 1 micrograu abaixo cai na linha k-1', async () => {
  const k = 1000;
  const acima = await grade(-50, (-35000000 + k * 4497) / 1e6);
  const abaixo = await grade(-50, (-35000000 + k * 4497 - 1) / 1e6);
  assert.equal(Math.floor(acima.out_cell / 65536), k);
  assert.equal(Math.floor(abaixo.out_cell / 65536), k - 1);
});

test('T-CA09: ponto em lon_u = LON0 + c*DLON cai na coluna c; 1 micrograu a oeste cai na c-1', async () => {
  const { rows } = await client.query('select private.match_grid_dlon(1000) as d');
  const dlon = rows[0].d;
  const lat = (-35000000 + 1000 * 4497 + 2000) / 1e6;
  const c = 3000;
  const dentro = await grade((-75000000 + c * dlon) / 1e6, lat);
  const antes = await grade((-75000000 + c * dlon - 1) / 1e6, lat);
  assert.equal(dentro.out_cell % 65536, c);
  assert.equal(antes.out_cell % 65536, c - 1);
});

test('T-CA09: ida e volta: o centro de uma celula pertence a propria celula', async () => {
  for (let i = 0; i < 60; i++) {
    const lon = -74 + (40 * (i * 37 % 97)) / 97;
    const lat = -34 + (40 * (i * 53 % 89)) / 89;
    const g = await grade(lon, lat);
    const volta = await grade(g.out_c_lon, g.out_c_lat);
    assert.equal(volta.out_cell, g.out_cell);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// T-DOUR | Valores dourados: a fixture e calculada por outra implementacao (JavaScript), independente do SQL.
// ---------------------------------------------------------------------------------------------------------------

test('T-DOUR: 30 coordenadas fixas batem com a fixture (celula e centro)', async () => {
  assert.equal(DOURADOS.length, 30);
  for (const f of DOURADOS) {
    const g = await grade(f.lon, f.lat);
    assert.equal(g.out_cell, f.cell, `celula de (${f.lon}, ${f.lat})`);
    assert.equal(g.out_c_lon, f.c_lon, `centro lon de (${f.lon}, ${f.lat})`);
    assert.equal(g.out_c_lat, f.c_lat, `centro lat de (${f.lon}, ${f.lat})`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// CA-07 | Paridade com o oraculo PostGIS (esfera, use_spheroid=false). Fora da faixa de 10 m, nada diverge.
// ---------------------------------------------------------------------------------------------------------------

test('T-CA07: match_points_within bate com ST_DWithin (esfera) fora da faixa de 10 m, 20.000 pontos', () =>
  isolado(async () => {
    await semear(20000, 0.07);
    let excluidos = 0;
    let dentro = 0;
    for (const [lon, lat] of BASES) {
      for (const raio of [5000, 20000, 50000, 100000]) {
        const { rows } = await client.query(
          `with f as (select out_subject_id as s from private.match_points_within($1::float8, $2::float8, $3::integer, 5000, 1::smallint)),
                o as (select g.subject_id as s,
                             extensions.st_distance(extensions.st_setsrid(extensions.st_makepoint(g.match_lon, g.match_lat), 4326)::extensions.geography,
                                                    extensions.st_setsrid(extensions.st_makepoint($1::float8, $2::float8), 4326)::extensions.geography, false) as d
                        from app.geocode_point g
                       where g.subject_kind = 'request' and g.state = 'ok' and g.match_grid_version = 1)
           select count(*) filter (where (f.s is not null) <> (o.d <= $4::float8) and abs(o.d - $4::float8) > ${RAIO_TOLERANCIA_M})::int as divergentes,
                  count(*) filter (where (f.s is not null) <> (o.d <= $4::float8) and abs(o.d - $4::float8) <= ${RAIO_TOLERANCIA_M})::int as excluidos,
                  count(*) filter (where f.s is not null)::int as dentro,
                  (select count(*) from f)::int as n_resposta
             from o left join f on f.s = o.s`,
          [lon, lat, raio, raio],
        );
        const r = rows[0];
        assert.equal(r.divergentes, 0, `divergencia fora da faixa (base ${lon},${lat}, raio ${raio})`);
        assert.ok(r.n_resposta < 5000, 'resposta truncada pelo limite; o oraculo nao compara');
        excluidos += r.excluidos;
        dentro += r.dentro;
      }
    }
    console.log(`    [T-CA07] combinacoes=40 pontos_dentro_total=${dentro} excluidos_na_faixa_10m=${excluidos}`);
    assert.ok(dentro > 0, 'nenhum ponto dentro dos raios: teste sem valor');
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-08 | Desempenho e plano: indice parcial, sem varredura sequencial. Medida registrada, nao forcada.
// ---------------------------------------------------------------------------------------------------------------

test('T-CA08: 50.000 pontos, analyze: plano usa geocode_point_match_cell_idx e nao varre a tabela', () =>
  isolado(async () => {
    await semear(50000, 0.08);
    await client.query('analyze app.geocode_point');
    const { rows } = await client.query(
      `explain (costs off)
       select g.subject_id, g.match_lon, g.match_lat
         from private.match_janela(-47.8825, -15.7942, 100000) w
         join app.geocode_point g
           on g.match_grid_version = 1 and g.match_cell between w.out_cell_lo and w.out_cell_hi
        where g.subject_kind = 'request' and g.state = 'ok'`,
    );
    const plano = rows.map((r) => r['QUERY PLAN']).join('\n');
    console.log(`    [T-CA08] plano:\n${plano}`);
    assert.match(plano, /geocode_point_match_cell_idx/);
    assert.doesNotMatch(plano, /Seq Scan on geocode_point/);
    const t0 = performance.now();
    const { rows: res } = await client.query(
      'select count(*)::int as n from private.match_points_within(-47.8825, -15.7942, 100000, 5000, 1::smallint)',
    );
    const ms = performance.now() - t0;
    console.log(`    [T-CA08] raio 100 km em Brasilia, 50.000 pontos: ${res[0].n} resultados em ${ms.toFixed(1)} ms (meta < 200 ms, medida)`);
  }));

// ---------------------------------------------------------------------------------------------------------------
// CA-10 | Migracao por expansao: linhas antigas, idempotencia e desfazer (dentro da transacao).
// ---------------------------------------------------------------------------------------------------------------

test('T-CA10: linhas antigas recebem match_* so se ok; idempotente; desfazer e refazer', () =>
  isolado(async () => {
    await client.query(semControle(readFileSync(DOWN_MATCH, 'utf8')));
    const lin = await client.query(
      "select count(*)::int as n from information_schema.columns where table_schema = 'app' and table_name = 'geocode_point' and column_name like 'match_%'",
    );
    assert.equal(lin.rows[0].n, 0, 'o desfazer deveria remover as colunas');

    const subjOk = randomUUID();
    const subjAg = randomUUID();
    const subjSr = randomUUID();
    await client.query(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
       values ('request', $1, $2, 'ok', extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
               'permanent', 'endereco', $5)`,
      [subjOk, hash('t10-ok'), SP.lon, SP.lat, AGORA],
    );
    await client.query(
      "insert into app.geocode_point (subject_kind, subject_id, address_hash, state) values ('request', $1, $2, 'aguardando')",
      [subjAg, hash('t10-ag')],
    );
    await client.query(
      "insert into app.geocode_point (subject_kind, subject_id, address_hash, state) values ('request', $1, $2, 'sem_resultado')",
      [subjSr, hash('t10-sr')],
    );
    const contagem = async () => (await client.query('select count(*)::int as n from app.geocode_point')).rows[0].n;
    const antes = await contagem();

    await client.query(semControle(readFileSync(MIG_MATCH, 'utf8')));
    assert.equal(await contagem(), antes);
    const { rows } = await client.query(
      `select subject_id, state, match_cell, match_lon, match_lat from app.geocode_point order by state`,
    );
    // So as linhas gravadas por este teste. O DEV pode ter outras linhas 'ok' (dados de demonstracao):
    // a primeira 'ok' da tabela inteira nao e a linha de Sao Paulo (triagem #140, T-CA10).
    const proprias = rows.filter((r) => [subjOk, subjAg, subjSr].includes(r.subject_id));
    const ok = proprias.find((r) => r.state === 'ok');
    const esperado = await grade(SP.lon, SP.lat);
    assert.equal(ok.match_cell, esperado.out_cell);
    for (const r of proprias.filter((x) => x.state !== 'ok')) assert.equal(r.match_cell, null);

    await client.query(semControle(readFileSync(MIG_MATCH, 'utf8')));
    assert.equal(await contagem(), antes, 'segunda aplicacao mudou a contagem');

    await client.query(semControle(readFileSync(DOWN_MATCH, 'utf8')));
    const { rows: ex } = await client.query(
      `select extensions.st_x(exact_point::extensions.geometry) as lon from app.geocode_point where subject_id = $1`,
      [subjOk],
    );
    assert.equal(ex[0].lon, SP.lon, 'exact_point alterado pelo desfazer');
    assert.equal(
      (await client.query("select to_regprocedure('private.match_grid(smallint,double precision,double precision)') as f")).rows[0].f,
      null,
    );
    assert.equal(
      (await client.query("select count(*)::int as n from pg_trigger where tgname = 'geocode_point_match_biu' and not tgisinternal")).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query("select to_regprocedure('private.geo_store_permanent(uuid,text,double precision,double precision,text,timestamp with time zone)') as f")).rows[0].f !== null,
      true,
      'geo_store_permanent deveria continuar',
    );

    await client.query(semControle(readFileSync(MIG_MATCH, 'utf8')));
    const { rows: volta } = await client.query('select match_cell from app.geocode_point where subject_id = $1', [subjOk]);
    assert.equal(volta[0].match_cell, esperado.out_cell, 'refazer nao restaurou o centro');
  }));
