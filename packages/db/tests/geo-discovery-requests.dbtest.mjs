// Issue 36 (H-023) | Testes de banco da descoberta por raio e online nacional (docs/factory/97-DESENHO-H023.md, §7).
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before, que aplica so a migracao 20261113210000
// (as anteriores ja estao aplicadas). Cada teste roda num savepoint desfeito; rollback no after. Dados 100 % sinteticos,
// sem rede. O after confere a limpeza com uma segunda conexao.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/geo-discovery-requests.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const ARQ = (caminho) => new URL(`../../../${caminho}`, import.meta.url);
const MIG = ARQ('supabase/migrations/20261113210000_geo_expand_discovery_requests.sql');
const DOWN = ARQ('supabase/rollbacks/20261113210000_geo_expand_discovery_requests.down.sql');

const AGORA = '2099-08-15T12:00:00.000Z';
const SUF = randomUUID().slice(0, 8);
const MARCA = `h023-${SUF}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const MANAUS = { lon: -60.02, lat: -3.12 };
const POA = { lon: -51.23, lat: -30.03 };
const M_POR_GRAU_LAT = 111195;
const SQL_SCAN =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_scan($1::uuid, $2::float8, $3::float8, $4::integer, $5::integer, $6::smallint, $7::integer, $8::uuid, $9::timestamptz)';
const SQL_ENTRADA =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_requests($1::uuid, $2::integer, $3::smallint, $4::integer, $5::uuid)';

const sha = (s) => createHash('sha256').update(s).digest('hex');
// Remove BEGIN/COMMIT/ROLLBACK do arquivo: o teste ja esta numa transacao.
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');

// Desloca um ponto para o norte (km): usado para colocar pedidos a uma distancia conhecida da base.
const norte = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  await client.query(semControle(readFileSync(MIG, 'utf8')));
});

after(async () => {
  await client.query('rollback');
  await client.end();
  // Confere a limpeza com outra conexao: nenhuma linha marcada pode ter ficado gravada.
  const outra = await connect();
  try {
    const r = await outra.query("select count(*)::int as n from app.app_user where email like $1", [`${MARCA}%`]);
    assert.equal(r.rows[0].n, 0, 'limpeza: usuarios sinteticos sobraram');
  } finally {
    await outra.end();
  }
});

/** Executa um teste dentro de um savepoint que e desfeito ao final (nada do teste persiste). */
async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

/** Erro esperado: o savepoint protege a transacao; a funcao falha e o erro volta ao teste. */
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

/** Base do profissional: ponto de base (professional_base) e raio, como publica H-036. */
async function base(c, prof, p = SP, raio = 20000) {
  const g = await ponto(c, 'professional_base', prof, p);
  await c.query(
    `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
     values ($1, $2, 'Base sintetica', $3, $4, $4)`,
    [prof, g, raio, AGORA],
  );
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

/** Pedido sintetico. prazo: deslocamento de AGORA para o fim da admissao (publicacao = prazo - 168 h). */
async function pedido(c, { svc, p = SP, status = 'publicado', prazo = '168 hours' }) {
  const cliente = await usuario(c);
  // O gatilho de insercao exige: status publicado, ponto permanente e ok, e ponto do mesmo rascunho de origem.
  const rascunhoId = await rascunho(c, svc);
  const g = await ponto(c, 'request', rascunhoId, p);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + $6::interval as dl) d
     returning id`,
    [cliente, svc, g, rascunhoId, AGORA, prazo],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await c.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return id;
}

/** Rascunho sintetico de origem do pedido (so o necessario para o gatilho de ponto). */
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

/** Consulta interna (p_now fixo). base: {lon, lat} ou null; raio em metros. */
async function varre(prof, b, raio, { limite = 200, apos = null } = {}) {
  const r = await client.query(SQL_SCAN, [
    prof,
    b ? b.lon : null,
    b ? b.lat : null,
    raio ?? null,
    limite,
    apos ? apos.group : null,
    apos ? apos.key : null,
    apos ? apos.id : null,
    AGORA,
  ]);
  return r.rows.map((x) => ({ id: x.out_request_id, group: x.out_cursor_group, key: x.out_cursor_key }));
}

const ids = (lista) => lista.map((x) => x.id);

test('T-D03 raio: 4.999, 100.001, 0 e nulo recusados; 5.000 e 100.000 aceitos; origem invalida recusada (CA-04)', async () => {
  await isolado(async () => {
    const prof = randomUUID();
    for (const raio of [4999, 100001, 0, -1, null]) {
      const e = await erroEm(SQL_SCAN, [prof, SP.lon, SP.lat, raio, 50, null, null, null, AGORA]);
      assert.equal(e.message, 'discover_raio_invalido', `raio ${raio}`);
    }
    assert.deepEqual(await varre(prof, SP, 5000), []);
    assert.deepEqual(await varre(prof, SP, 100000), []);
    // Origem nula ignora o raio (so online): aceita sem raio.
    assert.deepEqual(await varre(prof, null, null), []);
    const so = await erroEm(SQL_SCAN, [prof, SP.lon, null, 20000, 50, null, null, null, AGORA]);
    assert.equal(so.message, 'discover_parametro_invalido');
    const fora = await erroEm(SQL_SCAN, [prof, 10, 10, 20000, 50, null, null, null, AGORA]);
    assert.equal(fora.message, 'discover_parametro_invalido');
  });
});

test('T-D01/T-D02 presencial: aparece dentro do raio, some fora dele, com faixa de incerteza (CA-01 a CA-03)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const svc = await servico(client, { modalidade: 'presencial' });
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    const perto = await pedido(client, { svc, p: norte(SP, 1) });
    const dez = await pedido(client, { svc, p: norte(SP, 10) });
    const dezoito = await pedido(client, { svc, p: norte(SP, 18) });
    const fronteiraDentro = await pedido(client, { svc, p: norte(SP, 18.5) });
    const fronteiraFora = await pedido(client, { svc, p: norte(SP, 21.5) });
    const longe = await pedido(client, { svc, p: norte(SP, 30) });
    const achados = ids(await varre(prof, SP, 20000));
    for (const x of [perto, dez, dezoito, fronteiraDentro]) assert.ok(achados.includes(x));
    for (const x of [fronteiraFora, longe]) assert.ok(!achados.includes(x));
  });
});

test('T-D04 online sem raio: aparece em qualquer UF, com e sem base (CA-05)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const svc = await servico(client, { modalidade: 'online' });
    await declara(client, prof, svc, 'online');
    const sp = await pedido(client, { svc, p: SP });
    const man = await pedido(client, { svc, p: MANAUS });
    const poa = await pedido(client, { svc, p: POA });
    assert.deepEqual(new Set(ids(await varre(prof, null, null))), new Set([sp, man, poa]));
    await base(client, prof, SP, 5000);
    assert.deepEqual(new Set(ids(await varre(prof, SP, 5000))), new Set([sp, man, poa]));
    // Entrada publica (usa now(); prazo em 2099): mesmo resultado sem origem explicita.
    const entrada = await client.query(SQL_ENTRADA, [prof, 50, null, null, null]);
    assert.deepEqual(new Set(entrada.rows.map((r) => r.out_request_id)), new Set([sp, man, poa]));
  });
});

test('T-D05/T-D06 presencial nao ganha alcance nacional; servico nao declarado nao aparece (CA-06, CA-07)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const declarado = await servico(client, { modalidade: 'presencial' });
    const nao = await servico(client, { modalidade: 'presencial' });
    await base(client, prof, SP, 20000);
    await declara(client, prof, declarado, 'presencial');
    const dentro = await pedido(client, { svc: declarado, p: norte(SP, 1) });
    const longe = await pedido(client, { svc: declarado, p: MANAUS });
    const naoDeclarado = await pedido(client, { svc: nao, p: norte(SP, 1) });
    const achados = ids(await varre(prof, SP, 20000));
    assert.ok(achados.includes(dentro));
    assert.ok(!achados.includes(longe), 'presencial nao pode ver pedido fora do raio');
    assert.ok(!achados.includes(naoDeclarado), 'servico nao declarado nao pode aparecer');
  });
});

test('T-D07 so pedido com admissao aberta: estados e fronteira do prazo (CA-08), ramo com raio e ramo online', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const pres = await servico(client, { modalidade: 'presencial' });
    const onl = await servico(client, { modalidade: 'online' });
    await base(client, prof, SP, 20000);
    await declara(client, prof, pres, 'presencial');
    await declara(client, prof, onl, 'online');
    const abertoPres = await pedido(client, { svc: pres, p: norte(SP, 1) });
    const abertoOnl = await pedido(client, { svc: onl, p: MANAUS });
    const selecionado = await pedido(client, { svc: pres, p: norte(SP, 1), status: 'selecionado' });
    const concluido = await pedido(client, { svc: pres, p: norte(SP, 1), status: 'concluido' });
    const cancelado = await pedido(client, { svc: pres, p: norte(SP, 1), status: 'cancelado' });
    const noPrazo = await pedido(client, { svc: pres, p: norte(SP, 1), prazo: '0 seconds' });
    const umAntes = await pedido(client, { svc: pres, p: norte(SP, 1), prazo: '-1 microsecond' });
    const umDepois = await pedido(client, { svc: pres, p: norte(SP, 1), prazo: '1 microsecond' });
    const achados = ids(await varre(prof, SP, 20000));
    assert.ok(achados.includes(abertoPres) && achados.includes(umDepois), 'aberto e 1 us depois do prazo devem aparecer');
    assert.ok(achados.includes(abertoOnl), 'online aberto deve aparecer');
    for (const x of [selecionado, concluido, cancelado, noPrazo, umAntes]) {
      assert.ok(!achados.includes(x), 'pedido fechado nao pode aparecer');
    }
  });
});

test('T-D08/T-D09/T-D10 varreduras: assinatura fixa, sem exact_point, sem notice/log/format e erros de texto fixo (CA-09 a CA-11)', async () => {
  await isolado(async () => {
    const r = await client.query(
      `select p.proname, pg_get_function_result(p.oid) as res, lower(p.prosrc) as corpo
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('discover_scan', 'discover_requests')`,
    );
    assert.equal(r.rows.length, 2);
    for (const f of r.rows) {
      assert.match(f.res, /out_request_id uuid, out_cursor_group smallint, out_cursor_key integer/, f.proname);
      assert.ok(!/exact_point|geography|raise (notice|log|warning)|format\(/.test(f.corpo), `corpo de ${f.proname}`);
    }
    const prof = randomUUID();
    const e = await erroEm(SQL_SCAN, [prof, SP.lon, SP.lat, 4999, 50, null, null, null, AGORA]);
    assert.equal(e.message, 'discover_raio_invalido');
    assert.ok(!e.message.includes(String(prof)), 'mensagem nao pode carregar identificador');
  });
});

test('T-D11 paginacao: paginas de 1, 7 e 200 concatenam a lista inteira, sem repetir nem pular, e cursor invalido e recusado (CA-12)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const pres = await servico(client, { modalidade: 'presencial' });
    const onl = await servico(client, { modalidade: 'online' });
    await base(client, prof, SP, 20000);
    await declara(client, prof, pres, 'presencial');
    await declara(client, prof, onl, 'online');
    for (let i = 0; i < 12; i += 1) await pedido(client, { svc: pres, p: SP });
    for (let i = 1; i <= 6; i += 1) await pedido(client, { svc: pres, p: norte(SP, i) });
    for (const p of [MANAUS, POA, MANAUS, POA, MANAUS]) await pedido(client, { svc: onl, p });
    const completa = await varre(prof, SP, 20000);
    assert.equal(completa.length, 23);
    assert.ok(completa.some((x) => x.group === 1), 'deve atravessar o grupo online');
    for (const tam of [1, 7, 200]) {
      const juntas = [];
      let apos = null;
      for (let guarda = 0; guarda < 100; guarda += 1) {
        const pagina = await varre(prof, SP, 20000, { limite: tam, apos });
        if (pagina.length === 0) break;
        juntas.push(...pagina);
        const u = pagina[pagina.length - 1];
        apos = { group: u.group, key: u.key, id: u.id };
      }
      assert.deepEqual(
        juntas.map((x) => x.id),
        completa.map((x) => x.id),
        `pagina de ${tam}`,
      );
    }
    const parcial = await erroEm(SQL_SCAN, [prof, SP.lon, SP.lat, 20000, 5, 0, null, null, AGORA]);
    assert.equal(parcial.message, 'discover_parametro_invalido');
    const grupo2 = await erroEm(SQL_SCAN, [prof, SP.lon, SP.lat, 20000, 5, 2, 0, randomUUID(), AGORA]);
    assert.equal(grupo2.message, 'discover_parametro_invalido');
    const negativo = await erroEm(SQL_SCAN, [prof, SP.lon, SP.lat, 20000, 5, 0, -1, randomUUID(), AGORA]);
    assert.equal(negativo.message, 'discover_parametro_invalido');
  });
});

test('T-D14 sem base: presencial vazio; online aparece; regulamentado so online nao ganha alcance (decisao 106)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const pres = await servico(client, { modalidade: 'presencial' });
    const onlNormal = await servico(client, { modalidade: 'online' });
    const onlReg = await servico(client, { modalidade: 'ambos', regulado: true });
    await declara(client, prof, onlNormal, 'online');
    await declara(client, prof, onlReg, 'online');
    const aPres = await pedido(client, { svc: pres, p: SP });
    const aOnl = await pedido(client, { svc: onlNormal, p: MANAUS });
    const aReg = await pedido(client, { svc: onlReg, p: SP });
    const semBase = ids(await varre(prof, null, null));
    assert.ok(semBase.includes(aOnl));
    assert.ok(!semBase.includes(aPres), 'presencial sem base nao aparece');
    assert.ok(!semBase.includes(aReg), 'regulamentado so online nao ganha alcance nacional');
    // Declarado tambem presencial: aparece so dentro do raio.
    await base(client, prof, SP, 20000);
    await declara(client, prof, pres, 'presencial');
    await declara(client, prof, onlReg, 'presencial');
    const dentro = ids(await varre(prof, SP, 20000));
    assert.ok(dentro.includes(aReg), 'regulamentado presencial dentro do raio aparece');
    const fora = await pedido(client, { svc: onlReg, p: MANAUS });
    assert.ok(!ids(await varre(prof, SP, 20000)).includes(fora));
  });
});

test('T-D15 privilegios: so app_system executa a entrada; app_api, anon, authenticated, service_role e backup nao; PUBLIC sem execute (padrao do repo)', async () => {
  await isolado(async () => {
    const entrada = 'private.discover_requests(uuid,integer,smallint,integer,uuid)';
    const interna = 'private.discover_scan(uuid,double precision,double precision,integer,integer,smallint,integer,uuid,timestamptz)';
    const r = await client.query(
      `select
         has_function_privilege('app_system', $1::regprocedure, 'EXECUTE') as sistema_entrada,
         has_function_privilege('app_system', $2::regprocedure, 'EXECUTE') as sistema_interna,
         has_function_privilege('app_api', $1::regprocedure, 'EXECUTE') as api,
         has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
         has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth,
         has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as servico,
         has_function_privilege('app_backup_reader', $1::regprocedure, 'EXECUTE') as backup,
         exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
         exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = $2::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico_interna`,
      [entrada, interna],
    );
    assert.deepEqual(r.rows[0], {
      sistema_entrada: true,
      sistema_interna: false,
      api: false,
      anon: false,
      auth: false,
      servico: false,
      backup: false,
      publico: false,
      publico_interna: false,
    });
  });
});

test('T-D16 reversibilidade: o rollback remove as duas funcoes e a migracao reaplica sem erro, duas vezes', async () => {
  await isolado(async () => {
    await client.query(semControle(readFileSync(DOWN, 'utf8')).replace(/delete from ops\.schema_migration[^;]*;/i, ''));
    const sumiu = await client.query(
      "select to_regprocedure('private.discover_requests(uuid,integer,smallint,integer,uuid)') as a, to_regprocedure('private.discover_scan(uuid,double precision,double precision,integer,integer,smallint,integer,uuid,timestamptz)') as b",
    );
    assert.deepEqual(sumiu.rows[0], { a: null, b: null });
    await client.query(semControle(readFileSync(MIG, 'utf8')));
    await client.query(semControle(readFileSync(MIG, 'utf8')));
    const volta = await client.query("select to_regprocedure('private.discover_requests(uuid,integer,smallint,integer,uuid)') as a");
    assert.notEqual(volta.rows[0].a, null);
  });
});

test('T-D12 paridade: o ramo com raio devolve o mesmo conjunto que private.match_points_within (CA-01, reuso)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const svc = await servico(client, { modalidade: 'presencial' });
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    for (const km of [2, 7, 12, 17, 25, 40, 55, 80, 99]) {
      await pedido(client, { svc, p: norte(SP, km) });
      await pedido(client, { svc, p: norte(SP, -km) });
    }
    const esperado = (
      await client.query(
        `select r.id from private.match_points_within($1::float8, $2::float8, 20000, 5000, 1::smallint) m
           join app.service_request r on r.origin_draft_id = m.out_subject_id
          where r.service_id = $3::uuid and r.status = 'publicado' and $4::timestamptz < r.acceptance_deadline_at`,
        [SP.lon, SP.lat, svc, AGORA],
      )
    ).rows.map((r) => r.id);
    const obtido = ids(await varre(prof, SP, 20000));
    assert.equal(obtido.length, 8, 'pedidos a 2, 7, 12 e 17 km, nos dois rumos');
    assert.deepEqual(new Set(obtido), new Set(esperado));
  });
});

test('T-D13 desempenho (medido, nao condicao): o plano da janela usa o indice parcial, sem Seq Scan (CA-13)', async () => {
  await isolado(async () => {
    await client.query(
      `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
       select 'request', gen_random_uuid(), md5(s::text) || md5((s + 7919)::text), 'ok',
              extensions.st_setsrid(extensions.st_makepoint(-46.6333 + (random() - 0.5) * 3, -23.5505 + (random() - 0.5) * 3), 4326)::extensions.geography,
              'permanent', 'endereco', $1::timestamptz
         from generate_series(1, 50000) s`,
      [AGORA],
    );
    await client.query('analyze app.geocode_point');
    const w = await client.query('select out_cell_lo as lo, out_cell_hi as hi from private.match_janela($1::float8, $2::float8, 100000)', [SP.lon, SP.lat]);
    const lo = Number(w.rows[0].lo);
    const hi = Number(w.rows[0].hi);
    const inicio = Date.now();
    const plano = await client.query(
      `explain (analyze, buffers) select g.id from app.geocode_point g
        where g.match_grid_version = 1 and g.match_cell between ${lo} and ${hi}
          and g.subject_kind = 'request' and g.state = 'ok'`,
    );
    const tempo = Date.now() - inicio;
    const texto = plano.rows.map((r) => r['QUERY PLAN']).join('\n');
    console.log(`T-D13 EXPLAIN ANALYZE (50.000 pontos, raio 100 km): ${tempo} ms com o plano; meta de 200 ms medida, nao condicao.`);
    assert.match(texto, /geocode_point_match_cell_idx/);
    assert.doesNotMatch(texto, /Seq Scan on geocode_point/);
  });
});
