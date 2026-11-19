// Issue 68 (H-055) | Integracao da descoberta no banco de desenvolvimento (docs/factory/153-DESENHO-H055.md, §5 e §7:
// T-24, T-33 no banco, T-34). Mesmo padrao de geo-discovery-requests.dbtest.mjs: uma transacao aberta no before,
// um savepoint desfeito por teste, rollback no after e conferencia de limpeza com uma segunda conexao.
// Dados 100 % sinteticos com marca propria; nada e gravado de forma permanente. Sem rede e sem migracao nova.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/discovery-h055-integracao.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const SUF = randomUUID().slice(0, 8);
const MARCA = `h055-${SUF}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const M_POR_GRAU_LAT = 111195;
const ROTULOS_PESSOAIS = ['exact_point', 'first_name', 'email', 'telefone', 'phone', 'address', 'endereco', 'cursor_key'];

// Assinaturas exatas das funcoes que a API usa (adaptadores da descoberta, fotos e detalhe).
const FN_ENTRADA = 'private.discover_requests(uuid,integer,smallint,integer,uuid,timestamptz)';
const FN_DETALHE = 'private.request_detail_professional(uuid,uuid,timestamptz)';
const FN_FOTOS = 'private.request_discovery_photo_flags(uuid[])';

const SQL_ENTRADA =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_requests($1::uuid, $2::integer, $3::smallint, $4::integer, $5::uuid, $6::timestamptz)';
const SQL_DETALHE = 'select * from private.request_detail_professional($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_FOTOS = 'select out_request_id from private.request_discovery_photo_flags($1::uuid[])';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const norte = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
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

/** Executa um teste dentro de um savepoint que e desfeito ao final (nada do teste persiste). */
async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

/** Erro esperado: o savepoint protege a transacao e o erro volta ao teste. */
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
  await concederAcessoVigente(c, id, AGORA);
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

async function base(c, prof, p = SP, raio = 20000) {
  const g = await ponto(c, 'professional_base', prof, p);
  await c.query(
    `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
     values ($1, $2, 'Base sintetica', $3, $4, $4)`,
    [prof, g, raio, AGORA],
  );
}

async function servico(c, { modalidade = 'presencial' } = {}) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, $4, false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`, modalidade],
  );
  return id;
}

async function declara(c, prof, svc, modalidade) {
  await c.query(
    'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, $4)',
    [prof, svc, modalidade, AGORA],
  );
}

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

/** Pedido publicado sintetico (publicacao 168 h antes do prazo, como no teste da migracao 20261113210000). */
async function pedido(c, { svc, p = SP }) {
  const cliente = await usuario(c);
  const rascunhoId = await rascunho(c, svc);
  const g = await ponto(c, 'request', rascunhoId, p);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + interval '168 hours' as dl) d
     returning id`,
    [cliente, svc, g, rascunhoId, AGORA],
  );
  return { id: r.rows[0].id, rascunhoId };
}

/** Foto sintetica ligada ao pedido. status: ready (com todas as colunas de pronta), pending ou rejected. */
async function foto(c, { rascunhoId, pedidoId, status, expurgada = false }) {
  const pronta = status === 'ready';
  await c.query(
    `insert into app.media_asset (draft_id, client_upload_id, declared_type, declared_bytes, status, confirmed_at,
                                  confirmed_bytes, pending_expires_at, purge_requested_at, request_id, ready_at,
                                  ready_bytes, ready_width, ready_height, reject_code)
     values ($1, $2, 'image/jpeg', 1000, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      rascunhoId,
      randomUUID(),
      status,
      pronta ? AGORA : null,
      pronta ? 1000 : null,
      new Date(Date.parse(AGORA) + 86400000).toISOString(),
      expurgada ? AGORA : null,
      pedidoId,
      pronta ? AGORA : null,
      pronta ? 900 : null,
      pronta ? 800 : null,
      pronta ? 600 : null,
      status === 'rejected' ? 'imagem_invalida' : null,
    ],
  );
}

test('T-34 | so app_system executa as funcoes da descoberta; papeis de API, anonimo e autenticado nao', async () => {
  await isolado(async () => {
    for (const fn of [FN_ENTRADA, FN_DETALHE, FN_FOTOS]) {
      const r = await client.query(
        `select
           has_function_privilege('app_system', $1::regprocedure, 'EXECUTE') as sistema,
           has_function_privilege('app_api', $1::regprocedure, 'EXECUTE') as api,
           has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anonimo,
           has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as autenticado,
           has_function_privilege('app_backup_reader', $1::regprocedure, 'EXECUTE') as backup,
           exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico`,
        [fn],
      );
      assert.deepEqual(r.rows[0], { sistema: true, api: false, anonimo: false, autenticado: false, backup: false, publico: false }, fn);

      // Nenhum papel fora do dono e de app_system tem EXECUTE: a lista de concessoes e exata.
      const concedidos = await client.query(
        `select r.rolname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           join pg_roles r on r.oid = a.grantee
          where p.oid = $1::regprocedure and a.privilege_type = 'EXECUTE' and r.rolname <> pg_get_userbyid(p.proowner)
          order by 1`,
        [fn],
      );
      assert.deepEqual(
        concedidos.rows.map((x) => x.rolname),
        ['app_system'],
        `${fn}: papeis com EXECUTE alem do dono`,
      );
    }
  });
});

test('T-33 (banco) | foto pronta e sem expurgo conta; pendente, rejeitada, expurgada e sem foto nao contam; 201 ids recusados', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    const svc = await servico(client);
    await declara(client, prof, svc, 'presencial');
    const a = await pedido(client, { svc });
    const b = await pedido(client, { svc });
    const c = await pedido(client, { svc });
    const d = await pedido(client, { svc });
    const e = await pedido(client, { svc });
    await foto(client, { rascunhoId: a.rascunhoId, pedidoId: a.id, status: 'ready' });
    await foto(client, { rascunhoId: b.rascunhoId, pedidoId: b.id, status: 'pending' });
    await foto(client, { rascunhoId: c.rascunhoId, pedidoId: c.id, status: 'ready', expurgada: true });
    await foto(client, { rascunhoId: e.rascunhoId, pedidoId: e.id, status: 'rejected' });

    const r = await client.query(SQL_FOTOS, [[a.id, b.id, c.id, d.id, e.id]]);
    assert.deepEqual(
      r.rows.map((x) => x.out_request_id),
      [a.id],
      'so o pedido com foto pronta e sem expurgo deve sair',
    );
    // A saida tem uma unica coluna, so o id do pedido: nenhuma chave de arquivo, nome ou contagem.
    assert.deepEqual(Object.keys(r.rows[0]), ['out_request_id']);

    const muitos = Array.from({ length: 201 }, () => randomUUID());
    const err = await erroEm(SQL_FOTOS, [muitos]);
    assert.equal(err.code, '22023');
    assert.equal(err.message, 'foto_parametro_invalido');
  });
});

test('T-24 e integracao | a cadeia descoberta, detalhe e fotos devolve distancia em km de 0,5 e nulo para online, com chaves fixas', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    const svcPres = await servico(client);
    await declara(client, prof, svcPres, 'presencial');
    const svcOnline = await servico(client, { modalidade: 'online' });
    await declara(client, prof, svcOnline, 'online');

    const perto = await pedido(client, { svc: svcPres, p: SP });
    const longe = await pedido(client, { svc: svcPres, p: norte(SP, 2.5) });
    const online = await pedido(client, { svc: svcOnline, p: norte(SP, 40) });
    await foto(client, { rascunhoId: longe.rascunhoId, pedidoId: longe.id, status: 'ready' });

    // 1. Descoberta: os tres pedidos visiveis, com cursor de grupo presencial antes do online.
    const achados = await client.query(SQL_ENTRADA, [prof, 50, null, null, null, AGORA]);
    const ids = achados.rows.map((x) => x.out_request_id);
    assert.equal(ids.length, 3, 'descoberta devolve os tres pedidos');
    assert.ok(ids.includes(perto.id) && ids.includes(longe.id) && ids.includes(online.id));

    // 2. Projecao de cada pedido: chaves exatas (sem coordenada, sem contato) e distancia em km arredondada.
    const chavesEsperadas = [
      'out_id',
      'out_service_id',
      'out_service_name',
      'out_urgency',
      'out_description',
      'out_public_label',
      'out_distance_km',
      'out_modality',
      'out_published_at',
      'out_deadline_at',
    ];
    const porId = new Map();
    for (const id of [perto.id, longe.id, online.id]) {
      const r = await client.query(SQL_DETALHE, [prof, id, AGORA]);
      assert.equal(r.rows.length, 1, `detalhe do pedido ${id}`);
      assert.deepEqual(Object.keys(r.rows[0]), chavesEsperadas, 'colunas da projecao');
      for (const rotulo of ROTULOS_PESSOAIS) {
        assert.ok(!Object.keys(r.rows[0]).some((k) => k.includes(rotulo)), `coluna pessoal ${rotulo}`);
      }
      porId.set(id, r.rows[0]);
    }

    // 3. T-24: presencial em km, multiplo de 0,5 e maior ou igual a 0,5; nunca metros; online sem distancia.
    for (const id of [perto.id, longe.id]) {
      const km = Number(porId.get(id).out_distance_km);
      assert.ok(km >= 0.5, `distancia ${km} abaixo de 0,5 km`);
      assert.ok(km <= 20, `distancia ${km} acima do raio de 20 km: provavelmente em metros`);
      assert.equal(Number.isInteger(km * 2), true, `distancia ${km} nao e multiplo de 0,5`);
    }
    assert.equal(porId.get(online.id).out_distance_km, null, 'online sem distancia');
    assert.equal(porId.get(online.id).out_modality, 'online');

    // 4. Fotos: so o pedido de longe tem foto pronta.
    const fotos = await client.query(SQL_FOTOS, [[perto.id, longe.id, online.id]]);
    assert.deepEqual(
      fotos.rows.map((x) => x.out_request_id),
      [longe.id],
    );
  });
});
