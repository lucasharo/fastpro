// Issue 47 (H-034) | Testes de banco do painel do cliente (docs/factory/133-DESENHO-H034.md, §8; T-01, T-03, T-04, T-05,
// T-07, T-13, T-15, T-16). Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before, savepoint por teste e
// rollback no after. Dados 100 % sinteticos (marca h034-...), sem rede e sem apagar nada do banco.
// Cada pedido sintetico nasce com rascunho e ponto proprios (gatilho pedido_ponto_invalido da Issue 44).
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/request-list-h034.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIG = new URL('../../../supabase/migrations/20261113430000_requests_expand_customer_panel.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261113430000_requests_expand_customer_panel.down.sql', import.meta.url);

const AGORA = '2099-08-15T12:00:00.000000Z';
const FUNC_SIG = 'private.request_list_owner(uuid,timestamptz,timestamptz,uuid,integer)';
const SQL_LISTA = 'select * from private.request_list_owner($1::uuid, $2::timestamptz, $3::timestamptz, $4::uuid, $5::integer)';
const SQL_DONO = 'select * from private.request_owner_get($1::uuid, $2::uuid)';
const PAPEL_SERVICO = ['service', 'role'].join('_');
const PAPEIS_SEM_EXECUCAO = ['app_api', 'anon', 'authenticated', 'app_backup_reader', PAPEL_SERVICO];
const MARCA = `h034-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
});

after(async () => {
  await client.query('rollback');
  await client.end();
});

/** Executa um teste dentro de um savepoint desfeito ao final. */
async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
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

async function servico(c) {
  const r = await c.query('select id from app.service where active order by id limit 1');
  return r.rows[0].id;
}

async function rascunho(c, svc) {
  const id = randomUUID();
  await c.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4::timestamptz + interval '7 days', $5, $4, $4, 'Ana', $6, $7, $4, $4)`,
    [id, sha(`cookie-${id}`), svc, AGORA, sha('ip-sintetico'), `${MARCA}-${id.slice(0, 8)}@example.test`, sha(id)],
  );
  return id;
}

async function ponto(c, sujeito) {
  const r = await c.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
             'permanent', 'endereco', $5)
     returning id`,
    [sujeito, sha(randomUUID()), SP.lon, SP.lat, AGORA],
  );
  return r.rows[0].id;
}

/**
 * Pedido sintetico com rascunho e ponto proprios. O insert do gatilho so aceita 'publicado'; os demais estados
 * entram por update. O prazo e publicado + 168 h (CHECK da Issue 44).
 */
async function pedido(c, { dono, svc, publicadoEm, status = 'publicado' }) {
  const draft = await rascunho(c, svc);
  const geo = await ponto(c, draft);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5::timestamptz,
             $5::timestamptz + interval '168 hours')
     returning id`,
    [dono, svc, geo, draft, publicadoEm],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') await c.query('update app.service_request set status = $2 where id = $1', [id, status]);
  return id;
}

async function lista(c, dono, agora, cursor = null, limite = 21) {
  const r = await c.query(SQL_LISTA, [dono, agora, cursor?.ts ?? null, cursor?.id ?? null, limite]);
  return r.rows;
}

async function funcaoExiste(c) {
  const r = await c.query('select to_regprocedure($1) is not null as ok', [FUNC_SIG]);
  return r.rows[0].ok === true;
}

/** Instante ISO com seis casas: segundos inteiros a partir de 2099-08-14T10:00:00Z mais u microssegundos. */
function instante(n, u) {
  const base = new Date(Date.parse('2099-08-14T10:00:00.000Z') + n * 1000).toISOString();
  return base.slice(0, 23) + String(u).padStart(3, '0') + 'Z';
}

test('T-01 isolamento: cada dono ve so os seus pedidos; usuario sem pedido recebe zero linhas (CA-01)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    const b = await usuario(client);
    const vazio = await usuario(client);
    const aIds = [];
    const bIds = [];
    for (let i = 0; i < 3; i += 1) aIds.push(await pedido(client, { dono: a, svc, publicadoEm: `2099-08-14T1${i}:00:00Z` }));
    for (let i = 0; i < 2; i += 1) bIds.push(await pedido(client, { dono: b, svc, publicadoEm: `2099-08-14T2${i}:00:00Z` }));
    const deA = (await lista(client, a, AGORA)).map((x) => x.out_id).sort();
    const deB = (await lista(client, b, AGORA)).map((x) => x.out_id).sort();
    assert.deepEqual(deA, [...aIds].sort());
    assert.deepEqual(deB, [...bIds].sort());
    assert.equal((await lista(client, vazio, AGORA)).length, 0);
  });
});

test('T-03 detalhe da Issue 45 (sem alterar): pedido de terceiro nao aparece no dono (CA-03, parte de banco)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    const b = await usuario(client);
    const pedidoDeB = await pedido(client, { dono: b, svc, publicadoEm: '2099-08-14T10:00:00Z' });
    const pedidoDeA = await pedido(client, { dono: a, svc, publicadoEm: '2099-08-14T11:00:00Z' });
    assert.equal((await client.query(SQL_DONO, [a, pedidoDeB])).rows.length, 0);
    assert.equal((await client.query(SQL_DONO, [a, pedidoDeA])).rows.length, 1);
  });
});

test('T-04 estados: cinco fixtures com o estado e o prazo esperados; prazo so para publicado (CA-04, decisao 522)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    const esperado = new Map();
    const fixtures = [
      { status: 'publicado', publicadoEm: '2099-08-15T11:00:00Z', prazo: 'aberto' },
      { status: 'publicado', publicadoEm: '2099-08-01T11:00:00Z', prazo: 'encerrado' },
      { status: 'selecionado', publicadoEm: '2099-08-14T11:00:00Z', prazo: null },
      { status: 'concluido', publicadoEm: '2099-08-13T11:00:00Z', prazo: null },
      { status: 'cancelado', publicadoEm: '2099-08-12T11:00:00Z', prazo: null },
    ];
    for (const f of fixtures) {
      const id = await pedido(client, { dono: a, svc, publicadoEm: f.publicadoEm, status: f.status });
      esperado.set(id, f);
    }
    const linhas = await lista(client, a, AGORA);
    assert.equal(linhas.length, 5);
    for (const linha of linhas) {
      const f = esperado.get(linha.out_id);
      assert.ok(f, 'pedido inesperado na lista');
      assert.equal(linha.out_status, f.status);
      assert.equal(linha.out_deadline_state, f.prazo);
    }
  });
});

test('T-05 fronteira do prazo em microssegundos (CA-05): aberto em deadline-1us, encerrado em deadline e depois', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    const id = await pedido(client, { dono: a, svc, publicadoEm: '2099-08-15T11:00:00.000001Z' });
    const prazo = `(select acceptance_deadline_at from app.service_request where id = '${id}')`;
    const porInstante = async (expr) => {
      const r = await client.query(`select * from private.request_list_owner($1::uuid, ${expr}, null, null, 21)`, [a]);
      return r.rows;
    };
    const menos = await porInstante(`(${prazo}) - interval '1 microsecond'`);
    const igual = await porInstante(`(${prazo})`);
    const mais = await porInstante(`(${prazo}) + interval '1 microsecond'`);
    assert.equal(menos[0]?.out_deadline_state, 'aberto');
    assert.equal(igual[0]?.out_deadline_state, 'encerrado');
    assert.equal(mais[0]?.out_deadline_state, 'encerrado');
    assert.equal(mais[0]?.out_status, 'publicado');
    assert.equal(mais.length, 1, 'o pedido continua na lista depois do prazo');
    assert.equal(menos[0]?.out_cursor_ts, '2099-08-15T11:00:00.000001Z', 'microssegundos preservados no cursor');
  });
});

test('T-07 paginacao: 25 pedidos com empates e diferenca de 1 us; 20 + 5 sem repeticao nem falta; pedido novo no topo (CA-07)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    // [segundos, microssegundos]: 20 distintos, 3 empatados, 2 com 1 us e 2 us de diferenca = 25 pedidos.
    const pares = [];
    for (let n = 0; n < 20; n += 1) pares.push([n, 0]);
    for (let k = 0; k < 3; k += 1) pares.push([25, 0]);
    pares.push([30, 1], [30, 2]);
    const ids = [];
    for (const [n, u] of pares) ids.push(await pedido(client, { dono: a, svc, publicadoEm: instante(n, u) }));
    assert.equal(new Set(ids).size, 25);
    const p1 = await lista(client, a, AGORA, null, 21);
    assert.equal(p1.length, 21, 'a busca de 21 mostra que ha proxima pagina');
    const pagina1 = p1.slice(0, 20);
    const ultimo = pagina1[19];
    const p2 = await lista(client, a, AGORA, { ts: ultimo.out_cursor_ts, id: ultimo.out_id }, 21);
    assert.equal(p2.length, 5);
    const todos = [...pagina1, ...p2].map((x) => x.out_id);
    assert.equal(new Set(todos).size, 25, 'sem repeticao');
    const esperado = ids
      .map((id, i) => ({ id, ts: instante(pares[i][0], pares[i][1]) }))
      .sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : x.id < y.id ? 1 : -1))
      .map((x) => x.id);
    assert.deepEqual(todos, esperado, 'ordem published_at desc, id desc');
    // Pedido novo publicado depois da primeira leitura: aparece no topo e nao duplica a pagina 2.
    const novo = await pedido(client, { dono: a, svc, publicadoEm: '2099-08-14T10:00:40Z' });
    const topo = await lista(client, a, AGORA, null, 21);
    assert.equal(topo[0].out_id, novo);
    const p2Depois = await lista(client, a, AGORA, { ts: ultimo.out_cursor_ts, id: ultimo.out_id }, 21);
    assert.deepEqual(p2Depois.map((x) => x.out_id), p2.map((x) => x.out_id));
    assert.ok(!p2Depois.some((x) => x.out_id === novo));
  });
});

test('T-13 leitura sem escrita: contagem, soma de versoes, xmin e auditoria iguais antes e depois (CA-13)', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const a = await usuario(client);
    await pedido(client, { dono: a, svc, publicadoEm: '2099-08-14T10:00:00Z' });
    const foto = async () => {
      const s = await client.query(
        `select count(*)::int as n, coalesce(sum(version), 0)::bigint as v, coalesce(sum(acceptances_count), 0)::bigint as c,
                coalesce(string_agg(xmin::text, ',' order by id), '') as x
           from app.service_request where customer_user_id = $1`,
        [a],
      );
      const au = await client.query('select count(*)::int as n from audit.audit_event');
      return { servico: s.rows[0], auditoria: au.rows[0].n };
    };
    const antes = await foto();
    await lista(client, a, AGORA, null, 21);
    const depois = await foto();
    assert.deepEqual(depois, antes);
  });
});

test('T-15 catalogo: colunas de saida fechadas, corpo sem colunas proibidas, so app_system executa (CA-16)', async () => {
  const r = await client.query(
    `select pg_get_function_result(p.oid) as res, p.prosrc as src, p.prosecdef as definer, p.proconfig as cfg, p.oid as oid
       from pg_proc p where p.oid = to_regprocedure($1)`,
    [FUNC_SIG],
  );
  const f = r.rows[0];
  assert.ok(f, 'funcao ausente');
  const nomes = f.res.match(/out_\w+/g);
  assert.deepEqual(nomes, [
    'out_id',
    'out_service_name',
    'out_status',
    'out_deadline_state',
    'out_published_at',
    'out_deadline_at',
    'out_cursor_ts',
  ]);
  for (const proibido of ['address', 'public_label', 'exact_point', 'geocode', 'email', 'phone', 'customer_user_id', 'acceptances', 'match_', 'description', 'urgency', 'first_name']) {
    assert.ok(!f.res.includes(proibido), `coluna proibida na saida: ${proibido}`);
  }
  for (const termo of ['exact_point', 'address_text', 'email', 'phone']) {
    assert.ok(!f.src.includes(termo), `corpo menciona ${termo}`);
  }
  assert.equal(f.definer, true);
  assert.ok((f.cfg ?? []).some((x) => x.startsWith('search_path=')), 'search_path fixado');
  const exec = await client.query(
    `select r.role, has_function_privilege(r.role, $1::oid, 'EXECUTE') as ok
       from unnest($2::text[]) as r(role)`,
    [f.oid, ['app_system', ...PAPEIS_SEM_EXECUCAO]],
  );
  const mapa = Object.fromEntries(exec.rows.map((x) => [x.role, x.ok]));
  assert.equal(mapa.app_system, true);
  for (const papel of PAPEIS_SEM_EXECUCAO) assert.equal(mapa[papel], false, `${papel} nao executa`);
});

test('T-16 migracao: reaplicar, reverter e reaplicar sem erro (CA-15); plano usa o indice sem Sort', async () => {
  await isolado(async () => {
    await client.query(semControle(readFileSync(MIG, 'utf8')));
    await client.query(semControle(readFileSync(DOWN, 'utf8')));
    assert.equal(await funcaoExiste(client), false, 'a reversao remove a funcao');
    await client.query(semControle(readFileSync(MIG, 'utf8')));
    assert.equal(await funcaoExiste(client), true, 'a reaplicacao recria a funcao');
  });
  await isolado(async () => {
    await client.query('set local enable_seqscan = off');
    const plano = (
      await client.query(
        `explain (costs off) select r.id from app.service_request r where r.customer_user_id = $1
          order by r.published_at desc, r.id desc limit 21`,
        [randomUUID()],
      )
    ).rows
      .map((x) => x['QUERY PLAN'])
      .join('\n');
    assert.match(plano, /service_request_cliente_recente_idx/);
    assert.doesNotMatch(plano, /Sort/);
  });
});

test('T-04 privilegio de tabela: papeis de API nao leem a tabela direto (RLS forcada, sem politica)', async () => {
  const r = await client.query(
    `select r.role, has_table_privilege(r.role, 'app.service_request', 'select') as ok
       from unnest($1::text[]) as r(role)`,
    [['app_api', 'anon', 'authenticated']],
  );
  for (const linha of r.rows) assert.equal(linha.ok, false, `${linha.role} sem SELECT direto`);
});
