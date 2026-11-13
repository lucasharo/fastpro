// H-031 (Issue #44) | Publicacao idempotente do pedido (docs/factory/110-DESENHO-H031.md, §12.1).
// Provas de banco sobre o DEV ja migrado (20261113010000). Cada teste roda numa transacao e desfaz tudo no fim.
// Dados sinteticos com sufixo aleatorio; sem rede, sem provedor externo (geocodificacao simulada por INSERT).
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/request-publish-h031.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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

const sha = (s) => createHash('sha256').update(s).digest('hex');
const DIA = 86_400_000;
const T0 = Math.floor(Date.now() / 1000) * 1000;
const iso = (ms) => new Date(ms).toISOString();
const SUF = randomUUID().slice(0, 8);
const MIG = '20261113010000_requests_create_service_request.sql';
const DOWN = '20261113010000_requests_create_service_request.down.sql';

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

async function usuario(c, verificado = true, status = 'ativo') {
  const id = randomUUID();
  const email = `cliente-${id.slice(0, 8)}-${SUF}@example.test`;
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, email, randomUUID(), status, verificado ? iso(T0) : null, iso(T0)],
  );
  return { id, email };
}

async function servico(c, ativo = true) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo H031 ${SUF} ${grupo.slice(0, 6)}`,
  ]);
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, $4)`,
    [id, grupo, `Servico H031 ${SUF} ${id.slice(0, 6)}`, ativo],
  );
  return id;
}

/** Rascunho sintetico. Campos nulos sao nulos de verdade (para as recusas). */
async function rascunho(c, servicoId, u, o = {}) {
  const d = {
    hash: sha(`cookie-${randomUUID()}`),
    address: 'Rua Sintetica 100',
    urgency: 'imediato',
    description: 'Descricao sintetica',
    status: 'aberto',
    nome: 'Ana',
    email: u.email,
    verificado: true,
    confirmado: true,
    ...o,
  };
  const colunas = [
    'browser_nonce_hash', 'service_id', 'address_text', 'urgency', 'description', 'status',
    'expires_at', 'ip_hmac', 'created_at', 'updated_at', 'first_name', 'email', 'email_hmac', 'email_verified_at',
  ];
  const valores = [
    d.hash, servicoId, d.address, d.urgency, d.description, d.status,
    iso(T0 + 7 * DIA), sha('ip-sintetico'), iso(T0), iso(T0), d.nome, d.email,
    d.email === null ? null : sha(d.email), d.verificado ? iso(T0) : null,
  ];
  if (d.confirmado) {
    colunas.push('confirmed_at');
    valores.push(iso(T0));
  }
  const marcas = valores.map((_, i) => `$${i + 1}`).join(', ');
  const r = await c.query(
    `insert into app.request_draft (${colunas.join(', ')}) values (${marcas}) returning id`,
    valores,
  );
  return { id: r.rows[0].id, hash: d.hash };
}

/** Ponto de geocodificacao do rascunho: permanente, ok, com celula de casamento (simula a porta). */
async function ponto(c, draftId, lon = -46.6, lat = -23.5) {
  const r = await c.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision,
                                    match_cell, match_lon, match_lat, match_grid_version)
     values ('request', $1, $2, 'ok', extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography,
             'permanent', 'endereco', 1, $3, $4, 1)
     returning id`,
    [draftId, sha(`end-${randomUUID()}`), lon, lat],
  );
  return r.rows[0].id;
}

const chaveUsuario = (u) => sha(`rate-user-${u}`);
const chaveIp = (ip) => sha(`rate-ip-${ip}`);
const corpoHash = (...partes) => sha(partes.join('|'));

async function begin(c, u, d, o = {}) {
  const key = o.key ?? `idem-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const r = await c.query(
    'select * from private.request_publish_begin($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)',
    [
      u.id, d.id, d.hash, key, o.body ?? corpoHash(d.id, String(o.rev ?? 0)), o.rev ?? 0,
      chaveUsuario(u.id), chaveIp('203.0.113.7'), iso(o.agoraMs ?? T0),
    ],
  );
  return { row: r.rows[0], key, body: o.body ?? corpoHash(d.id, String(o.rev ?? 0)) };
}

async function commit(c, u, d, ponto_, o = {}) {
  const r = await c.query(
    'select * from private.request_publish_commit($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)',
    [u.id, d.id, d.hash, o.key, o.body, o.rev ?? 0, ponto_, o.ack ?? false, iso(o.agoraMs ?? T0)],
  );
  return r.rows[0];
}

async function abortar(c, u, key, body) {
  return (await c.query('select private.request_publish_abort($1, $2, $3) as ok', [u.id, key, body])).rows[0].ok;
}

/** Cenario completo: usuario, servico, rascunho confirmado e ponto. */
async function cenario(c, o = {}) {
  const u = await usuario(c, o.verificado ?? true);
  const s = await servico(c);
  const d = await rascunho(c, s, u, o.draft ?? {});
  const p = await ponto(c, d.id, o.lon, o.lat);
  return { u, s, d, p };
}

test('T-DB01 contrato da #36 por catalogo: colunas, indices, unicidade e RLS forcada', async () => {
  await tx(async () => {
    const colunas = (await client.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'app' and table_name = 'service_request'`,
    )).rows.reduce((m, r) => ((m[r.column_name] = r), m), {});
    assert.equal(colunas.id.data_type, 'uuid');
    assert.equal(colunas.customer_user_id.is_nullable, 'NO');
    assert.equal(colunas.origin_draft_id.is_nullable, 'YES');
    assert.equal(colunas.geocode_point_id.is_nullable, 'NO');
    assert.equal(colunas.acceptance_deadline_at.data_type, 'timestamp with time zone');
    assert.equal(colunas.exact_point, undefined, 'sem coordenada na tabela do pedido');
    assert.equal(colunas.match_cell, undefined);

    const idx = (await client.query(
      `select indexdef from pg_indexes where schemaname = 'app' and tablename = 'service_request'`,
    )).rows.map((r) => r.indexdef).join('\n');
    assert.match(idx, /\(service_id, status, acceptance_deadline_at\)/);

    const rls = (await client.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.service_request'::regclass`,
    )).rows[0];
    assert.equal(rls.relrowsecurity, true);
    assert.equal(rls.relforcerowsecurity, true);

    const unicos = (await client.query(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conrelid = 'app.service_request'::regclass and c.contype = 'u'`,
    )).rows.map((r) => r.def).join('\n');
    assert.match(unicos, /\(geocode_point_id\)/);
    assert.match(unicos, /\(origin_draft_id\)/);
  });
});

test('T-DB02 prazo de 168 h absoluto; published_at e prazo imutaveis; sem delete', async () => {
  await tx(async () => {
    const u = await usuario(client);
    const s = await servico(client);
    const d = await rascunho(client, s, u);
    const p = await ponto(client, d.id);
    const b = await begin(client, u, d);
    assert.equal(b.row.out_status, 'ok');
    const c = await commit(client, u, d, p, { key: b.key, body: b.body });
    assert.equal(c.out_status, 'criado');
    const diff = (await client.query(
      `select extract(epoch from (acceptance_deadline_at - published_at)) as s from app.service_request where id = $1`,
      [c.out_request_id],
    )).rows[0].s;
    assert.equal(Number(diff), 168 * 3600);

    const e1 = await erroEm(`update app.service_request set acceptance_deadline_at = acceptance_deadline_at + interval '1 hour' where id = $1`, [c.out_request_id]);
    assert.match(e1?.message ?? '', /pedido_campo_imutavel|check/);
    const e2 = await erroEm(`update app.service_request set published_at = published_at - interval '1 hour' where id = $1`, [c.out_request_id]);
    assert.match(e2?.message ?? '', /pedido_campo_imutavel|check/);
    const e3 = await erroEm(`delete from app.service_request where id = $1`, [c.out_request_id]);
    assert.match(e3?.message ?? '', /pedido_nao_apagavel/);
  });
});

test('T-DB04 publicar cria pedido novo, marca rascunho publicado e preserva confirmed_at e content_rev', async () => {
  await tx(async () => {
    const { u, d, p } = await cenario(client);
    const antes = (await client.query('select confirmed_at, content_rev from app.request_draft where id = $1', [d.id])).rows[0];
    const b = await begin(client, u, d);
    assert.equal(b.row.out_status, 'ok');
    assert.equal(b.row.out_address_text, 'Rua Sintetica 100');
    const c = await commit(client, u, d, p, { key: b.key, body: b.body });
    assert.equal(c.out_status, 'criado');
    assert.notEqual(c.out_request_id, d.id, 'id do pedido e novo (RN-03)');
    const pr = (await client.query(
      `select status, acceptances_count, version, wave2_opened_at, origin_draft_id from app.service_request where id = $1`,
      [c.out_request_id],
    )).rows[0];
    assert.equal(pr.status, 'publicado');
    assert.equal(pr.acceptances_count, 0);
    assert.equal(pr.version, 1);
    assert.equal(pr.wave2_opened_at, null);
    assert.equal(pr.origin_draft_id, d.id);
    const depois = (await client.query('select status, confirmed_at, content_rev from app.request_draft where id = $1', [d.id])).rows[0];
    assert.equal(depois.status, 'publicado');
    assert.equal(depois.confirmed_at?.toISOString(), antes.confirmed_at?.toISOString(), 'gatilho da #43 preserva confirmed_at');
    assert.equal(depois.content_rev, antes.content_rev);
    const aud = (await client.query(
      `select count(*)::int as n from audit.audit_event where action = 'request.published' and object_id = $1`,
      [c.out_request_id],
    )).rows[0].n;
    assert.equal(aud, 1);
  });
});

test('T-DB05 nada publica sozinho: leitura e confirmacao nao criam pedido', async () => {
  await tx(async () => {
    const u = await usuario(client);
    const s = await servico(client);
    const d = await rascunho(client, s, u, { confirmado: false });
    await client.query('select * from private.draft_review_get($1, $2::timestamptz)', [d.hash, iso(T0)]);
    await client.query('select * from private.draft_confirm($1, $2::timestamptz, 0, 7)', [d.hash, iso(T0)]);
    const n = (await client.query('select count(*)::int as n from app.service_request')).rows[0].n;
    assert.equal(n, 0);
  });
});

test('T-DB06 recusas de e-mail e de conta nao criam nada e liberam a chave', async () => {
  const casos = [
    { nome: 'conta sem verificacao', u: { verificado: false }, draft: {} },
    { nome: 'rascunho sem verificacao', u: {}, draft: { verificado: false } },
    { nome: 'e-mail divergente', u: {}, draft: { email: 'outro@example.test' } },
    { nome: 'conta bloqueada', u: { status: 'bloqueado' }, draft: {} },
  ];
  for (const caso of casos) {
    await tx(async () => {
      const u = await usuario(client, caso.u.verificado ?? true, caso.u.status ?? 'ativo');
      const s = await servico(client);
      const d = await rascunho(client, s, u, caso.draft);
      const b = await begin(client, u, d);
      assert.notEqual(b.row.out_status, 'ok', caso.nome);
      assert.notEqual(b.row.out_status, 'criado', caso.nome);
      const chave = (await client.query(
        `select count(*)::int as n from ops.idempotency_key where principal_id = $1 and key = $2`,
        [u.id, b.key],
      )).rows[0].n;
      assert.equal(chave, 0, `${caso.nome}: chave liberada`);
      const n = (await client.query('select count(*)::int as n from app.service_request')).rows[0].n;
      assert.equal(n, 0, caso.nome);
    });
  }
});

test('T-DB08 chave: corpo diferente conflita; em andamento bloqueia; abort libera; repeticao devolve o mesmo pedido', async () => {
  await tx(async () => {
    const { u, d, p } = await cenario(client);
    const b = await begin(client, u, d);
    assert.equal(b.row.out_status, 'ok');
    const outro = await begin(client, u, d, { key: b.key, body: corpoHash('outro-corpo') });
    assert.equal(outro.row.out_status, 'conflito');
    const mesmo = await begin(client, u, d, { key: b.key, body: b.body });
    assert.equal(mesmo.row.out_status, 'em_andamento');

    const c = await commit(client, u, d, p, { key: b.key, body: b.body });
    assert.equal(c.out_status, 'criado');
    const rep = await begin(client, u, d, { key: b.key, body: b.body });
    assert.equal(rep.row.out_status, 'repetida');
    assert.equal(rep.row.out_request_id, c.out_request_id, 'repeticao devolve o mesmo pedido');
    // Rascunho ja publicado: chave nova recebe ja_publicado (200) e o replay dessa chave segue 200 (H-031 #44, decisao 256).
    const outra = await begin(client, u, d);
    assert.equal(outra.row.out_status, 'ja_publicado');
    assert.equal(outra.row.out_request_id, c.out_request_id);
    const repOutra = await begin(client, u, d, { key: outra.key, body: outra.body });
    assert.equal(repOutra.row.out_status, 'ja_publicado', 'replay de ja_publicado responde 200, nao 201');
    assert.equal(repOutra.row.out_request_id, c.out_request_id);
  });
  await tx(async () => {
    const { u, d } = await cenario(client);
    const b = await begin(client, u, d);
    assert.equal(await abortar(client, u, b.key, b.body), true);
    const again = await begin(client, u, d, { key: b.key, body: b.body });
    assert.equal(again.row.out_status, 'ok', 'chave liberada pelo abort aceita nova tentativa');
  });
});

test('T-DB09 paridade: request_publish_missing devolve o mesmo que draft_confirm', async () => {
  const casos = [
    { nome: null },
    { address: '   ' },
    { urgency: null },
    { description: null },
    { email: null },
  ];
  for (const caso of casos) {
    await tx(async () => {
      const u = await usuario(client);
      const s = await servico(client);
      const d = await rascunho(client, s, u, { ...caso, confirmado: false, verificado: false });
      const confirm = (await client.query(
        'select out_result, out_missing from private.draft_confirm($1, $2::timestamptz, 0, 7)', [d.hash, iso(T0)],
      )).rows[0];
      const missing = (await client.query(
        `select private.request_publish_missing(r) as m from app.request_draft r where r.id = $1`, [d.id],
      )).rows[0].m;
      if (confirm.out_result === 'campos_faltando') {
        assert.deepEqual(missing, confirm.out_missing);
      } else {
        assert.equal(missing.length, 0);
      }
    });
  }
  await tx(async () => {
    const u = await usuario(client);
    const s = await servico(client, false);
    const d = await rascunho(client, s, u, { confirmado: false });
    const confirm = (await client.query(
      'select out_result, out_missing from private.draft_confirm($1, $2::timestamptz, 0, 7)', [d.hash, iso(T0)],
    )).rows[0];
    const missing = (await client.query(
      `select private.request_publish_missing(r) as m from app.request_draft r where r.id = $1`, [d.id],
    )).rows[0].m;
    assert.equal(confirm.out_result, 'campos_faltando');
    assert.deepEqual(missing, confirm.out_missing);
    assert.deepEqual(missing, ['service_id']);
  });
});

test('T-DB10 duplicidade: mesmo cliente e servico a 60 m avisa; 140 m cria; ack grava duplicate_ack', async () => {
  await tx(async () => {
    const u = await usuario(client);
    const s = await servico(client);
    const d1 = await rascunho(client, s, u);
    const p1 = await ponto(client, d1.id, -46.6, -23.5);
    const b1 = await begin(client, u, d1);
    const c1 = await commit(client, u, d1, p1, { key: b1.key, body: b1.body });
    assert.equal(c1.out_status, 'criado');

    const d2 = await rascunho(client, s, u, { nome: 'Bia', email: u.email });
    const p2 = await ponto(client, d2.id, -46.6, -23.49946); // ~60 m ao norte
    const b2 = await begin(client, u, d2);
    const aviso = await commit(client, u, d2, p2, { key: b2.key, body: b2.body });
    assert.equal(aviso.out_status, 'duplicidade');
    assert.equal(aviso.out_similar_id, c1.out_request_id);
    const n1 = (await client.query('select count(*)::int as n from app.service_request where origin_draft_id = $1', [d2.id])).rows[0].n;
    assert.equal(n1, 0, 'duplicidade nao cria pedido');

    const ack = await commit(client, u, d2, p2, { key: b2.key, body: b2.body, ack: true });
    assert.equal(ack.out_status, 'criado');
    const gravado = (await client.query(
      'select count(*)::int as n from app.duplicate_ack where request_id = $1 and similar_request_id = $2',
      [ack.out_request_id, c1.out_request_id],
    )).rows[0].n;
    assert.equal(gravado, 1);
  });
  await tx(async () => {
    const u = await usuario(client);
    const s = await servico(client);
    const d1 = await rascunho(client, s, u);
    const p1 = await ponto(client, d1.id, -46.6, -23.5);
    const b1 = await begin(client, u, d1);
    await commit(client, u, d1, p1, { key: b1.key, body: b1.body });
    const d2 = await rascunho(client, s, u, { email: u.email });
    const p2 = await ponto(client, d2.id, -46.6, -23.49874); // ~140 m ao norte
    const b2 = await begin(client, u, d2);
    const c2 = await commit(client, u, d2, p2, { key: b2.key, body: b2.body });
    assert.equal(c2.out_status, 'criado', '140 m fora do raio de 100 m');
  });
});

test('T-DB11 ponto de outro assunto ou sem permanencia e recusado no commit e no insert direto', async () => {
  await tx(async () => {
    const { u, d } = await cenario(client);
    const outro = await cenario(client);
    const b = await begin(client, u, d);
    const c = await commit(client, u, d, outro.p, { key: b.key, body: b.body });
    assert.equal(c.out_status, 'ponto_invalido');
    assert.equal(await abortar(client, u, b.key, b.body), true);
  });
  await tx(async () => {
    const { u, d } = await cenario(client);
    const outro = await cenario(client);
    const e = await erroEm(
      `insert into app.service_request (customer_user_id, origin_draft_id, service_id, urgency, description, address_text,
          first_name, geocode_point_id, published_at, acceptance_deadline_at)
       select $1, $2, service_id, urgency, description, address_text, first_name, $3, $4::timestamptz, $4::timestamptz + interval '168 hours'
         from app.request_draft where id = $2`,
      [u.id, d.id, outro.p, iso(T0)],
    );
    assert.match(e?.message ?? '', /pedido_ponto_invalido/);
  });
});

test('T-DB12 limite por cliente: 6a publicacao na hora e recusada; replay nao consome', async () => {
  await tx(async () => {
    const { u, d } = await cenario(client);
    for (let i = 0; i < 5; i += 1) {
      await client.query('select private.rl_hit($1, 60, $2::timestamptz)', [chaveUsuario(u.id), iso(T0)]);
    }
    const b = await begin(client, u, d);
    assert.equal(b.row.out_status, 'limite');
    assert.ok(b.row.out_retry_after > 0);
    const chave = (await client.query(
      `select count(*)::int as n from ops.idempotency_key where principal_id = $1 and key = $2`, [u.id, b.key],
    )).rows[0].n;
    assert.equal(chave, 0, 'recusa por limite libera a chave');
  });
});

test('T-DB15 seguranca: funcoes so para app_system; I-19 com a fixture de aceite', async () => {
  await tx(async () => {
    const execs = (await client.query(
      `select p.proname, has_function_privilege('app_api', p.oid, 'execute') as api,
              has_function_privilege('app_system', p.oid, 'execute') as sys
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname like 'request_publish_%'`,
    )).rows;
    assert.ok(execs.length >= 8);
    for (const r of execs) assert.equal(r.api, false, `${r.proname} sem execute para app_api`);
    const sys = execs.filter((r) => r.sys).map((r) => r.proname).sort();
    assert.deepEqual(sys, ['request_publish_abort', 'request_publish_begin', 'request_publish_commit']);

    await client.query(`create temp table fixture_aceite_h031 (
        id uuid primary key default gen_random_uuid(), request_id uuid not null, professional_id uuid not null)`);
    await client.query(`create trigger fixture_aceite_h031_nao_proprio before insert on fixture_aceite_h031
        for each row execute function private.acceptance_not_own_request('app.service_request')`);
    const { u, d, p } = await cenario(client);
    const b = await begin(client, u, d);
    const c = await commit(client, u, d, p, { key: b.key, body: b.body });
    const e = await erroEm(
      'insert into fixture_aceite_h031 (request_id, professional_id) values ($1, $2)', [c.out_request_id, u.id],
    );
    assert.match(e?.message ?? '', /aceite_proprio_pedido/);
    await client.query('insert into fixture_aceite_h031 (request_id, professional_id) values ($1, $2)', [c.out_request_id, randomUUID()]);
  });
});

test('T-DB17 desfazer recusa com dados e reaplicar volta; draft intacto', async () => {
  await tx(async () => {
    const { u, d, p } = await cenario(client);
    const b = await begin(client, u, d);
    await commit(client, u, d, p, { key: b.key, body: b.body });
    const roll = readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', DOWN), 'utf8')
      .replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
    const e = await erroEm(roll);
    assert.match(e?.message ?? '', /rollback_recusado_com_dados/);
    const draftOk = (await client.query('select status from app.request_draft where id = $1', [d.id])).rows[0];
    assert.equal(draftOk.status, 'publicado');
  });
  await tx(async () => {
    const mig = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIG), 'utf8');
    await client.query(mig);
    await client.query(mig);
    const n = (await client.query("select count(*)::int as n from ops.app_config where key = 'publish.limits'")).rows[0].n;
    assert.equal(n, 1, 'reaplicar e idempotente');
  });
});
