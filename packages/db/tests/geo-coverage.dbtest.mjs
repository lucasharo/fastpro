// Issue 37 (H-024) | Testes de banco da cobertura booleana sem contagem (docs/factory/99-DESENHO-H024.md, §7).
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before, que reaplica a migracao 20261113220000
// (idempotencia) e no after faz rollback. Cada teste roda num savepoint desfeito. Dados 100 % sinteticos, sem rede.
// O after confere a limpeza com uma segunda conexao.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/geo-coverage.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const ARQ = (caminho) => new URL(`../../../${caminho}`, import.meta.url);
const MIG = ARQ('supabase/migrations/20261113220000_geo_expand_coverage.sql');
const DOWN = ARQ('supabase/rollbacks/20261113220000_geo_expand_coverage.down.sql');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const AGORA = '2099-08-15T12:00:00.000Z';
const SUF = randomUUID().slice(0, 8);
const MARCA = `h024-${SUF}`;
const IP_PADRAO = sha(`ip-sintetico-${SUF}`);
const SP = { lon: -46.6333, lat: -23.5505 };
const POA = { lon: -51.23, lat: -30.03 };
const M_POR_GRAU_LAT = 111195;

const SQL_COBERTURA =
  'select out_result from private.coverage_for_request($1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::integer, $6::integer, $7::integer)';
const SQL_EXISTE = 'select private.coverage_exists($1::uuid, $2::float8, $3::float8, $4::timestamptz) as existe';
const SQL_SCAN =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_scan($1::uuid, $2::float8, $3::float8, $4::integer, $5::integer, $6::smallint, $7::integer, $8::uuid, $9::timestamptz)';
const FUNCOES_COBERTURA = [
  'coverage_exists',
  'coverage_for_request',
  'coverage_take',
  'discovery_dist_m',
  'discovery_open',
  'discovery_mod_pres',
  'discovery_mod_onl',
  'discovery_serves',
];

// Remove BEGIN/COMMIT/ROLLBACK do arquivo: o teste ja esta numa transacao.
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');

// Desloca um ponto para o norte (km).
const norte = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  // Reaplica a migracao: precisa ser idempotente (T-C15).
  await client.query(semControle(readFileSync(MIG, 'utf8')));
});

after(async () => {
  await client.query('rollback');
  await client.end();
  // Confere a limpeza com outra conexao: nenhuma linha marcada pode ter ficado gravada.
  const outra = await connect();
  try {
    const r = await outra.query('select count(*)::int as n from app.app_user where email like $1', [`${MARCA}%`]);
    assert.equal(r.rows[0].n, 0, 'limpeza: usuarios sinteticos sobraram');
  } finally {
    await outra.end();
  }
});

/** Executa um teste dentro de um savepoint que e desfeito ao final. */
async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

/** Erro esperado: o savepoint protege a transacao; o erro volta ao teste. */
async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a funcao devolveu resultado');
}

async function usuario(c) {
  const id = randomUUID();
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $4)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), AGORA],
  );
  return id;
}

async function profissional(c) {
  const id = await usuario(c);
  await c.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', $2, $2, $2)`,
    [id, AGORA],
  );
  return id;
}

async function ponto(c, tipo, sujeito, p) {
  const r = await c.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ($1, $2, $3, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography,
             'permanent', 'endereco', $6)
     returning id`,
    [tipo, sujeito, sha(`end-${randomUUID()}`), p.lon, p.lat, AGORA],
  );
  return r.rows[0].id;
}

/** Base do profissional (professional_base) com raio. Devolve o id do ponto. */
async function base(c, prof, p = SP, raio = 20000) {
  const g = await ponto(c, 'professional_base', prof, p);
  await c.query(
    `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
     values ($1, $2, 'Base sintetica', $3, $4, $4)`,
    [prof, g, raio, AGORA],
  );
  return g;
}

async function servico(c, { modalidade = 'presencial', regulado = false } = {}) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, $4, $5, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`, modalidade, regulado],
  );
  return id;
}

async function declara(c, prof, svc, modalidade) {
  await c.query(
    'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, $4)',
    [prof, svc, modalidade, AGORA],
  );
}

/** Rascunho sintetico de origem do pedido (o necessario para o gatilho de ponto). */
async function rascunho(c, svc) {
  const id = randomUUID();
  const expira = new Date(Date.parse(AGORA) + 7 * 86400000).toISOString();
  const email = `${MARCA}-rascunho-${id.slice(0, 8)}@example.test`;
  await c.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [id, sha(`cookie-${id}`), svc, expira, sha('ip-sintetico'), AGORA, email, sha(email)],
  );
  return id;
}

/** Pedido sintetico publicado. Devolve id, dono e ponto de origem. */
async function pedido(c, { svc, p = SP, status = 'publicado', prazo = '168 hours' }) {
  const cliente = await usuario(c);
  const rascunhoId = await rascunho(c, svc);
  const geo = await ponto(c, 'request', rascunhoId, p);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + $6::interval as dl) d
     returning id`,
    [cliente, svc, geo, rascunhoId, AGORA, prazo],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await c.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return { id, cliente, geo };
}

/** Centro da celula (o que a cobertura e a descoberta enxergam). */
async function centro(geoId) {
  const r = await client.query('select match_lon, match_lat, match_cell from app.geocode_point where id = $1', [geoId]);
  return { lon: r.rows[0].match_lon, lat: r.rows[0].match_lat, celula: r.rows[0].match_cell };
}

async function existe(svc, p, agora = AGORA) {
  const r = await client.query(SQL_EXISTE, [svc, p.lon, p.lat, agora]);
  return r.rows[0].existe;
}

async function cobertura(p, { ip = IP_PADRAO, agora = AGORA, lim = {} } = {}) {
  const r = await client.query(SQL_COBERTURA, [
    p.id,
    p.cliente,
    ip,
    agora,
    lim.ip ?? 1000,
    lim.cliente ?? 1000,
    lim.pedido ?? 1000,
  ]);
  return r.rows;
}

const valores = (linhas) => linhas.map((x) => x.out_result);

// ---------------------------------------------------------------------------------------------------------------

test('CA-01/CA-02: uma coluna out_result; so com ou sem; mesma forma com 0, 1 e 5 profissionais elegiveis', async () => {
  await isolado(async () => {
    const r = await client.query(
      "select pg_get_function_result('private.coverage_for_request(uuid,uuid,text,timestamptz,integer,integer,integer)'::regprocedure) as t",
    );
    assert.equal(r.rows[0].t, 'TABLE(out_result text)');

    const respostas = [];
    for (const n of [0, 1, 5]) {
      const svc = await servico(client, { modalidade: 'presencial' });
      for (let i = 0; i < n; i += 1) {
        const prof = await profissional(client);
        await base(client, prof, SP, 20000);
        await declara(client, prof, svc, 'presencial');
      }
      const p = await pedido(client, { svc, p: norte(SP, 2) });
      respostas.push(await cobertura(p));
    }
    assert.deepEqual(respostas.map(valores), [['sem'], ['com'], ['com']]);
    for (const linhas of respostas) {
      assert.equal(linhas.length, 1);
      assert.deepEqual(Object.keys(linhas[0]), ['out_result']);
    }
  });
});

test('CA-02/CA-12: nenhuma funcao de cobertura devolve contagem, lista, coordenada, nem escreve log', async () => {
  const r = await client.query(
    `select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = any($1::text[])`,
    [FUNCOES_COBERTURA],
  );
  assert.equal(r.rows.length, FUNCOES_COBERTURA.length, 'faltam funcoes de cobertura');
  const proibido =
    /\b(count|array_agg|string_agg|json_agg|jsonb_agg|json_build_object|jsonb_build_object)\s*\(|exact_point|geography|\bst_|raise\s+(notice|log|warning)|\bformat\s*\(|6371008|\bradians\(/i;
  for (const f of r.rows) {
    if (f.proname === 'discovery_dist_m') continue; // o unico lugar com a formula; ela nao devolve contagem.
    assert.doesNotMatch(f.prosrc, proibido, `funcao ${f.proname} contem trecho proibido`);
  }
  const erros = r.rows.find((f) => f.proname === 'coverage_for_request').prosrc.match(/raise exception '[^']*'/g);
  assert.deepEqual([...new Set(erros)], ["raise exception 'coverage_parametro_invalido'"]);
});

test('CA-03: a existencia para na primeira base elegivel (limit 1) e devolve so o booleano', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    for (let i = 0; i < 3; i += 1) {
      const prof = await profissional(client);
      await base(client, prof, SP, 20000);
      await declara(client, prof, svc, 'presencial');
    }
    assert.equal(await existe(svc, norte(SP, 2)), true);
    const r = await client.query("select prosrc from pg_proc where proname = 'coverage_exists'");
    assert.match(r.rows[0].prosrc, /limit 1/);
  });
});

test('CA-04: cada requisito isolado (presencial, raio, base, aprovacao, servico, online)', async () => {
  // Presencial dentro do raio de 5 km (pedido a 4 km).
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 5000);
    await declara(client, prof, svc, 'presencial');
    assert.equal(await existe(svc, norte(SP, 4)), true, 'dentro do raio');
    assert.equal(await existe(svc, norte(SP, 6.5)), false, 'fora do raio');
  });
  // Profissional nao elegivel (e-mail nao verificado) nao conta.
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    await client.query('update app.app_user set email_verified_at = null where id = $1', [prof]);
    assert.equal(await existe(svc, norte(SP, 2)), false, 'nao elegivel');
  });
  // Servico nao declarado pelo profissional.
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const outro = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, outro, 'presencial');
    assert.equal(await existe(svc, norte(SP, 2)), false, 'servico nao declarado');
  });
  // Online nao regulamentado: sem raio, conta a 3.000 km.
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'online', regulado: false });
    const prof = await profissional(client);
    await declara(client, prof, svc, 'online');
    assert.equal(await existe(svc, POA), true, 'online nacional');
  });
  // Online regulamentado: nao ganha alcance nacional.
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'online', regulado: true });
    const prof = await profissional(client);
    await declara(client, prof, svc, 'online');
    assert.equal(await existe(svc, POA), false, 'online regulamentado');
  });
  // Cada profissional usa o proprio raio: 5 km nao alcanca a 20 km; 100 km alcanca.
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const perto = await profissional(client);
    await base(client, perto, SP, 5000);
    await declara(client, perto, svc, 'presencial');
    assert.equal(await existe(svc, norte(SP, 20)), false, 'so raio de 5 km');
    const longe = await profissional(client);
    await base(client, longe, SP, 100000);
    await declara(client, longe, svc, 'presencial');
    assert.equal(await existe(svc, norte(SP, 20)), true, 'raio de 100 km');
  });
});

test('paridade com a descoberta da Issue 36 (T-C02, reduzido): mesma resposta para o mesmo pedido', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    const geoBase = await base(client, prof, SP, 5000);
    await declara(client, prof, svc, 'presencial');
    const b = await centro(geoBase);
    for (const km of [4, 6.5]) {
      const p = await pedido(client, { svc, p: norte(SP, km) });
      const c = await centro(p.geo);
      const pelaDescoberta = await client.query(SQL_SCAN, [prof, b.lon, b.lat, 5000, 200, null, null, null, AGORA]);
      const achou = pelaDescoberta.rows.some((x) => x.out_request_id === p.id);
      const pelaCobertura = await existe(svc, c);
      assert.equal(pelaCobertura, achou, `divergencia a ${km} km`);
    }
  });
});

test('CA-05: dois pontos exatos na mesma celula dao o mesmo resultado (so o centro da celula conta)', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const a = await pedido(client, { svc, p: norte(SP, 2) });
    const ca = await centro(a.geo);
    // Ponto exato a ~1 m do centro: continua na mesma celula de 500 m.
    const b = await pedido(client, { svc, p: { lon: ca.lon + 0.00001, lat: ca.lat } });
    const cb = await centro(b.geo);
    assert.equal(cb.celula, ca.celula, 'mesma celula');
    assert.deepEqual(valores(await cobertura(a)), valores(await cobertura(b)));
  });
});

test('CA-06: cache de cinco minutos com relogio simulado (menos de 5 min vem do cache; 5 min recalcula)', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const p = await pedido(client, { svc, p: norte(SP, 2) });
    assert.deepEqual(valores(await cobertura(p, { agora: AGORA })), ['com']);

    await client.query('update app.app_user set email_verified_at = null where id = $1', [prof]);
    const t299 = new Date(Date.parse(AGORA) + 299000).toISOString();
    const t300 = new Date(Date.parse(AGORA) + 300000).toISOString();
    assert.deepEqual(valores(await cobertura(p, { agora: t299 })), ['com'], 'cache valido aos 4 min 59 s');
    assert.deepEqual(valores(await cobertura(p, { agora: t300 })), ['sem'], 'recalcula aos 5 min');

    const colunas = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'ops' and table_name = 'coverage_cache' order by column_name`,
    );
    assert.deepEqual(colunas.rows.map((r) => r.column_name), [
      'computed_at',
      'covered',
      'match_cell',
      'match_grid_version',
      'service_id',
    ]);
  });
});

test('CA-07: limite por pedido (2 por hora), 429 virar limite sem detalhe; janela libera depois de 1 hora', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const p = await pedido(client, { svc, p: norte(SP, 2) });
    const lim = { pedido: 2 };
    assert.deepEqual(valores(await cobertura(p, { lim })), ['com']);
    assert.deepEqual(valores(await cobertura(p, { lim })), ['com'], 'cache tambem conta');
    assert.deepEqual(valores(await cobertura(p, { lim })), ['limite'], 'terceira consulta');
    const depois = new Date(Date.parse(AGORA) + 3601000).toISOString();
    assert.deepEqual(valores(await cobertura(p, { lim, agora: depois })), ['com'], 'janela liberou');
  });
});

test('CA-07: limite por IP vale antes de ler o pedido; parametros invalidos viram erro com texto fixo', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const p = await pedido(client, { svc, p: norte(SP, 2) });
    const ip = sha(`ip-limite-${SUF}`);
    assert.deepEqual(valores(await cobertura(p, { ip, lim: { ip: 1 } })), ['com']);
    assert.deepEqual(valores(await cobertura(p, { ip, lim: { ip: 1 } })), ['limite']);

    const err = await erroEm(SQL_COBERTURA, [p.id, p.cliente, 'nao-hex', AGORA, 60, 60, 20]);
    assert.equal(err.message, 'coverage_parametro_invalido');
    const err2 = await erroEm(SQL_COBERTURA, [p.id, p.cliente, IP_PADRAO, AGORA, 0, 60, 20]);
    assert.equal(err2.message, 'coverage_parametro_invalido');
  });
});

test('CA-08: so o dono e so pedido aberto; alheio, inexistente e selecionado dao indisponivel', async () => {
  await isolado(async () => {
    const svc = await servico(client, { modalidade: 'presencial' });
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const p = await pedido(client, { svc, p: norte(SP, 2) });
    assert.deepEqual(valores(await cobertura({ ...p, cliente: randomUUID() })), ['indisponivel'], 'alheio');
    assert.deepEqual(valores(await cobertura({ id: randomUUID(), cliente: p.cliente })), ['indisponivel'], 'inexistente');
    const sel = await pedido(client, { svc, p: norte(SP, 3), status: 'selecionado' });
    assert.deepEqual(valores(await cobertura(sel)), ['indisponivel'], 'selecionado');
  });
});

test('CA-09/CA-10 e T-C14: privilegios: so app_system executa a entrada; nenhum papel de API; cache sem concessao', async () => {
  const papeis = ['anon', 'authenticated', 'app_api', 'app_backup_reader'];
  const servico_ = await client.query("select rolname from pg_roles where rolname like 'service%'");
  const todos = [...papeis, ...servico_.rows.map((x) => x.rolname)];
  const entrada = await client.query(
    `select p.oid, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'coverage_for_request'`,
  );
  const oid = entrada.rows[0].oid;
  for (const papel of todos) {
    const r = await client.query('select has_function_privilege($1, $2::oid, $3) as ok', [papel, oid, 'EXECUTE']);
    assert.equal(r.rows[0].ok, false, `papel ${papel} nao pode executar a entrada`);
  }
  const app = await client.query("select has_function_privilege('app_system', $1::oid, 'EXECUTE') as ok", [oid]);
  assert.equal(app.rows[0].ok, true, 'app_system executa a entrada');
  assert.ok(entrada.rows[0].proconfig.includes('search_path=""'), 'search_path vazio na entrada');

  // Publico (PUBLIC) nao tem execute em nenhuma funcao de cobertura, nem a existencia para app_system.
  const pub = await client.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'private' and p.proname = any($1::text[]) and a.grantee = 0 and a.privilege_type = 'EXECUTE'`,
    [FUNCOES_COBERTURA],
  );
  assert.deepEqual(pub.rows, [], 'PUBLIC com execute');
  const exist = await client.query(
    "select has_function_privilege('app_system', p.oid, 'EXECUTE') as ok from pg_proc p where p.proname = 'coverage_exists'",
  );
  assert.equal(exist.rows[0].ok, false, 'app_system nao executa a existencia');

  const cache = await client.query(
    `select c.relrowsecurity as rls, has_table_privilege('app_system', c.oid, 'SELECT') as sel,
            has_table_privilege('app_api', c.oid, 'SELECT') as sel_api
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relname = 'coverage_cache'`,
  );
  assert.equal(cache.rows[0].rls, true);
  assert.equal(cache.rows[0].sel, false);
  assert.equal(cache.rows[0].sel_api, false);
});

test('T-C15: o rollback remove funcoes, indice e tabela, e nada mais; reaplicar volta', async () => {
  await client.query('savepoint r');
  try {
    await client.query(semControle(readFileSync(DOWN, 'utf8')));
    const sumiu = await client.query(
      `select to_regprocedure('private.coverage_for_request(uuid, uuid, text, timestamptz, integer, integer, integer)') as f,
              to_regclass('ops.coverage_cache') as t,
              to_regprocedure('private.discover_scan(uuid, double precision, double precision, integer, integer, smallint, integer, uuid, timestamptz)') as d`,
    );
    assert.equal(sumiu.rows[0].f, null, 'funcao de entrada ainda existe');
    assert.equal(sumiu.rows[0].t, null, 'tabela ainda existe');
    assert.notEqual(sumiu.rows[0].d, null, 'a descoberta da Issue 36 nao pode sumir');
  } finally {
    await client.query('rollback to savepoint r');
  }
  const volta = await client.query(
    "select to_regprocedure('private.coverage_for_request(uuid, uuid, text, timestamptz, integer, integer, integer)') as f",
  );
  assert.notEqual(volta.rows[0].f, null, 'rollback de teste nao restaurou a funcao');
});
