// Issue 45 (H-032) | Testes de banco da visibilidade de localizacao, parte M1 (docs/factory/127-DESENHO-H032.md, §9.2).
// Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before, que reaplica a M1 (idempotente). Cada teste roda
// num savepoint desfeito; rollback no after. Dados 100 % sinteticos, sem rede. Sem citar a chave de servico por extenso.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/request-visibility-h032.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const MIG = new URL('../../../supabase/migrations/20261113230000_requests_expand_location_visibility.sql', import.meta.url);
const MIG_CORRECAO = new URL('../../../supabase/migrations/20261113300000_requests_fix_owner_get_no_counter.sql', import.meta.url);

const AGORA = '2099-08-15T12:00:00.000Z';
const PRAZO_FIM = '2099-08-22T12:00:00.000Z';
const ANTES_DO_FIM = '2099-08-22T11:59:59.999999Z';
const MARCA = `h032-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const M_POR_GRAU_LAT = 111195;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const norte = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });
const semControle = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))
    .join('\n');

const SQL_DETALHE = 'select * from private.request_detail_professional($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_DONO = 'select * from private.request_owner_get($1::uuid, $2::uuid)';
const SQL_SCAN =
  'select out_request_id from private.discover_scan($1::uuid, $2::float8, $3::float8, $4::integer, 200, null, null, null, $5::timestamptz)';
const SQL_COMMIT_ENC =
  'select * from private.request_publish_commit_enc($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12)';

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
  // Replay dentro da transacao (revertida no after): 230000 e, em seguida, a correcao 300000 (estado atual do banco).
  await client.query('drop function if exists private.request_owner_get(uuid, uuid)');
  await client.query(semControle(readFileSync(MIG, 'utf8')));
  await client.query(semControle(readFileSync(MIG_CORRECAO, 'utf8')));
});

after(async () => {
  await client.query('rollback');
  await client.end();
  const outra = await connect();
  try {
    const r = await outra.query('select count(*)::int as n from app.app_user where email like $1', [`${MARCA}%`]);
    assert.equal(r.rows[0].n, 0, 'limpeza: usuarios sinteticos sobraram');
  } finally {
    await outra.end();
  }
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

/** Erro esperado: o savepoint protege a transacao e volta o erro ao teste. */
async function erroEm(sql, params = []) {
  await client.query('savepoint e');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('rollback to savepoint e');
    return err;
  }
  await client.query('rollback to savepoint e');
  assert.fail('esperava erro e a consulta devolveu resultado');
}

async function usuario(c, { verificado = true, status = 'ativo' } = {}) {
  const id = randomUUID();
  const email = `${MARCA}-${id.slice(0, 8)}@example.test`;
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, email, randomUUID(), status, verificado ? AGORA : null, AGORA],
  );
  return { id, email };
}

async function profissional(c, verificacao = 'aprovada') {
  const u = await usuario(c);
  await c.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, $2, $3, $3, $3)`,
    [u.id, verificacao, AGORA],
  );
  await concederAcessoVigente(c, u.id, AGORA);
  return u.id;
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

/** Rascunho sintetico de origem (so o necessario para o gatilho de ponto). */
async function rascunho(c, svc, email = `${MARCA}-rascunho-${randomUUID().slice(0, 8)}@example.test`) {
  const id = randomUUID();
  const expira = new Date(Date.parse(AGORA) + 7 * 86400000).toISOString();
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

/** Pedido sintetico publicado (insert direto, como na Issue 36). prazo: deslocamento do fim da admissao. */
async function pedido(c, { svc, p = SP, prazo = '168 hours' }) {
  const cliente = await usuario(c);
  const rascunhoId = await rascunho(c, svc);
  const g = await ponto(c, 'request', rascunhoId, p);
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + $6::interval as dl) d
     returning id`,
    [cliente.id, svc, g, rascunhoId, AGORA, prazo],
  );
  return { id: r.rows[0].id, cliente: cliente.id };
}

const ids = (linhas) => linhas.map((x) => x.out_request_id ?? x.id);

/** Consulta interna (mesma regra da Issue 36) para o profissional, a base e o relogio. */
async function varre(prof, b, raio) {
  const r = await client.query(SQL_SCAN, [prof, b.lon, b.lat, raio, AGORA]);
  return ids(r.rows);
}

async function detalhe(prof, pedidoId, agora = AGORA) {
  return (await client.query(SQL_DETALHE, [prof, pedidoId, agora])).rows;
}

// ---------------------------------------------------------------- Catalogo e privilegios (CA-11, CA-12)

test('T-10 catalogo: detalhe do profissional sem coluna de endereco, nome, contato ou coordenada; prosrc sem exact_point', async () => {
  const cols = await client.query(
    `select pg_get_function_result(p.oid) as tabela from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'request_detail_professional'`,
  );
  const nomes = [...cols.rows[0].tabela.matchAll(/(\w+)\s+(?:uuid|text|numeric|timestamp|with)/g)].map((m) => m[1]);
  assert.equal(nomes.length, 10, 'o detalhe devolve exatamente 10 colunas');
  for (const proibido of [/^out_address/, /exact_point/, /geocode_point/, /first_name/, /email/, /phone/, /customer_user/, /match_/, /lat$/, /lon$/]) {
    assert.ok(!nomes.some((n) => proibido.test(n)), `coluna proibida no detalhe: ${proibido}`);
  }
  const prosrc = await client.query(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('request_detail_professional', 'request_visibility_guard')`,
  );
  for (const linha of prosrc.rows) {
    for (const termo of ['exact_point', 'address_text', 'first_name', 'email', 'phone']) {
      assert.ok(!linha.prosrc.includes(termo), `prosrc menciona ${termo}`);
    }
  }
});

test('T-11 privilegios: funcoes novas so para app_system; sem grant em tabela para papeis de API', async () => {
  const funcoes = [
    'private.request_publish_commit_enc(uuid, uuid, text, text, text, integer, uuid, boolean, timestamptz, uuid, bytea, text)',
    'private.request_owner_get(uuid, uuid)',
    'private.request_detail_professional(uuid, uuid, timestamptz)',
  ];
  for (const f of funcoes) {
    const r = await client.query(
      `select has_function_privilege('app_system', $1, 'execute') as sistema,
              has_function_privilege('app_api', $1, 'execute') as api,
              has_function_privilege('anon', $1, 'execute') as anonimo`,
      [f],
    );
    assert.equal(r.rows[0].sistema, true, `app_system executa ${f}`);
    assert.equal(r.rows[0].api, false, `app_api nao executa ${f}`);
    assert.equal(r.rows[0].anonimo, false, `anon nao executa ${f}`);
  }
  const tabela = await client.query(
    `select has_table_privilege('app_api', 'app.service_request', 'select') as api,
            has_table_privilege('app_system', 'app.service_request', 'select') as sistema`,
  );
  assert.equal(tabela.rows[0].api, false);
  assert.equal(tabela.rows[0].sistema, false);
});

// ---------------------------------------------------------------- Publicacao cifrada (CA-12, CA-13)

test('T-14 publicacao cifrada: sem texto em claro, id = p_request_id, rotulo gravado; entrada invalida nao cria nada', async () => {
  await isolado(async () => {
    const u = await usuario(client);
    const svc = await servico(client);
    const d = { id: await rascunho(client, svc, u.email), hash: null };
    d.hash = (await client.query('select browser_nonce_hash from app.request_draft where id = $1', [d.id])).rows[0]
      .browser_nonce_hash;
    const pt = await ponto(client, 'request', d.id, SP);
    const chave = `idem-${randomUUID().slice(0, 12)}`;
    const corpo = sha(`corpo-${d.id}`);
    const inicio = await client.query(
      'select * from private.request_publish_begin($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)',
      [u.id, d.id, d.hash, chave, corpo, 0, sha('rate-u'), sha('rate-ip'), new Date().toISOString()],
    );
    assert.equal(inicio.rows[0].out_status, 'ok', 'begin precisa devolver ok');
    const reqId = randomUUID();
    const enc = Buffer.concat([Buffer.from([1]), Buffer.alloc(28, 7), Buffer.from('cifrado-sintetico-h032')]);
    const agora = new Date().toISOString();
    const saida = await client.query(SQL_COMMIT_ENC, [u.id, d.id, d.hash, chave, corpo, 0, pt, false, agora, reqId, enc, 'Sao Paulo - SP']);
    assert.equal(saida.rows[0].out_status, 'criado');
    const gravado = await client.query(
      'select id, address_text, address_text_enc, public_label from app.service_request where id = $1',
      [reqId],
    );
    assert.equal(gravado.rows[0].id, reqId, 'id do pedido e o gerado pela API');
    assert.equal(gravado.rows[0].address_text, null, 'nenhum texto em claro');
    assert.ok(Buffer.compare(gravado.rows[0].address_text_enc, enc) === 0, 'cifra gravada como recebida');
    assert.equal(gravado.rows[0].public_label, 'Sao Paulo - SP');

    const invalida = await erroEm(SQL_COMMIT_ENC, [u.id, d.id, d.hash, chave, corpo, 0, pt, false, agora, randomUUID(),
      Buffer.concat([Buffer.from([2]), Buffer.alloc(40, 1)]), null]);
    assert.equal(invalida.message, 'endereco_cifrado_invalido', 'versao 2 recusada');
    const mesmoId = await erroEm(SQL_COMMIT_ENC, [u.id, d.id, d.hash, chave, corpo, 0, pt, false, agora, d.id, enc, null]);
    assert.equal(mesmoId.message, 'publicacao_entrada_invalida', 'p_request_id igual ao rascunho recusado');
    const rotulo = await erroEm(SQL_COMMIT_ENC, [u.id, d.id, d.hash, chave, corpo, 0, pt, false, agora, randomUUID(), enc, 'Cidade 01310']);
    assert.equal(rotulo.message, 'rotulo_publico_invalido', 'rotulo com digito recusado');
  });
});

test('T-14b gatilhos: cifra e rotulo imutaveis; address_text so vira nulo junto da cifra', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const u = await usuario(client);
    const d = await rascunho(client, svc);
    const g = await ponto(client, 'request', d, SP);
    const enc = Buffer.concat([Buffer.from([1]), Buffer.alloc(40, 3)]);
    const r = await client.query(
      `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text,
         first_name, geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at, address_text_enc, public_label)
       values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5,
         ($5::timestamptz + interval '168 hours'), null, null) returning id`,
      [u.id, svc, g, d, AGORA],
    );
    const id = r.rows[0].id;
    await client.query('update app.service_request set address_text_enc = $2 where id = $1', [id, enc]);
    const trocaCifra = await erroEm('update app.service_request set address_text_enc = $2 where id = $1', [id, Buffer.concat([Buffer.from([1]), Buffer.alloc(40, 9)])]);
    assert.equal(trocaCifra.message, 'pedido_campo_imutavel');
    const ajuste = await erroEm('update app.service_request set address_text = $2 where id = $1', [id, 'Outra rua 2']);
    assert.equal(ajuste.message, 'pedido_campo_imutavel', 'texto nao volta a existir');
    await client.query('update app.service_request set address_text = null where id = $1', [id]);
    const sumiu = (await client.query('select address_text, address_text_enc from app.service_request where id = $1', [id])).rows[0];
    assert.equal(sumiu.address_text, null);
    assert.ok(sumiu.address_text_enc !== null);
    const semCifraNemTexto = await erroEm(
      'update app.service_request set address_text = null, address_text_enc = null where id = $1', [id]);
    assert.equal(semCifraNemTexto.code, '23514', 'pedido sem nenhum endereco e recusado');
  });
});

// ---------------------------------------------------------------- Leitura do dono (CA-05, CA-06)

test('T-05/T-06 dono: le o pedido; outro cliente recebe zero linhas', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const p = await pedido(client, { svc });
    const dono = (await client.query(SQL_DONO, [p.cliente, p.id])).rows;
    assert.equal(dono.length, 1);
    assert.equal(dono[0].out_address_text, 'Rua sintetica 1', 'linha legada ainda traz o texto (sai na M2)');
    const outro = (await client.query(SQL_DONO, [randomUUID(), p.id])).rows;
    assert.equal(outro.length, 0, 'pedido de outro cliente nao aparece');
  });
});

// ---------------------------------------------------------------- Detalhe do profissional (CA-02, CA-07, CA-08, CA-16)

test('T-07 guarda: verificacao nao aprovada, conta inativa e servico nao atendido devolvem zero linhas', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const p = await pedido(client, { svc });
    const pendente = await profissional(client, 'pendente');
    await base(client, pendente);
    await declara(client, pendente, svc, 'presencial');
    assert.equal((await detalhe(pendente, p.id)).length, 0, 'verificacao pendente');

    const inativo = await profissional(client, 'aprovada');
    await client.query("update app.app_user set status = 'bloqueado' where id = $1", [inativo]);
    await base(client, inativo);
    await declara(client, inativo, svc, 'presencial');
    assert.equal((await detalhe(inativo, p.id)).length, 0, 'conta inativa');

    const sem = await profissional(client, 'aprovada');
    await base(client, sem);
    const outroSvc = await servico(client);
    await declara(client, sem, outroSvc, 'presencial');
    assert.equal((await detalhe(sem, p.id)).length, 0, 'servico nao atendido');
  });
});

test('T-08 fronteira: 1 us antes do fim devolve; no fim e depois, zero linhas', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const p = await pedido(client, { svc });
    const prof = await profissional(client);
    await base(client, prof);
    await declara(client, prof, svc, 'presencial');
    assert.equal((await detalhe(prof, p.id, ANTES_DO_FIM)).length, 1, 'um microssegundo antes do fim');
    assert.equal((await detalhe(prof, p.id, PRAZO_FIM)).length, 0, 'no instante do fim');
    assert.equal((await detalhe(prof, p.id, '2099-08-23T00:00:00.000Z')).length, 0, 'depois do fim');
  });
});

test('T-02/T-18 detalhe presencial: formato, distancia para cima em 0,5 km e nenhuma coordenada', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const prof = await profissional(client);
    await base(client, prof, SP, 20000);
    await declara(client, prof, svc, 'presencial');
    // Distancias fora de fronteira de 0,5 km (o centro da celula e aproximado): 0,8 km -> 1,0 e 17,6 km -> 18,0.
    const perto = await pedido(client, { svc, p: norte(SP, 0.8) });
    const dezoito = await pedido(client, { svc, p: norte(SP, 17.6) });
    const fora = await pedido(client, { svc, p: norte(SP, 25) });
    const linha1 = (await detalhe(prof, perto.id))[0];
    assert.ok(linha1, 'pedido a 0,8 km aparece');
    assert.equal(Number(linha1.out_distance_km), 1, '0,8 km arredonda para cima em 0,5 km (1,0)');
    assert.equal(linha1.out_modality, 'presencial');
    assert.equal(Object.keys(linha1).length, 10);
    assert.equal(Number((await detalhe(prof, dezoito.id))[0].out_distance_km), 18);
    assert.equal((await detalhe(prof, fora.id)).length, 0, 'fora do raio de 20 km');
    const corpo = JSON.stringify(linha1);
    assert.ok(!/-?\d{1,3}\.\d{4,}/.test(corpo), 'sem par numerico de coordenada');
  });
});

test('T-20 paridade: detalhe e discover_scan dao o mesmo conjunto de pedidos (presencial, online, fechado, fora do raio)', async () => {
  await isolado(async () => {
    const prof = await profissional(client);
    const svcP = await servico(client, { modalidade: 'presencial' });
    const svcO = await servico(client, { modalidade: 'online', regulado: false });
    const svcR = await servico(client, { modalidade: 'online', regulado: true });
    await base(client, prof, SP, 20000);
    await declara(client, prof, svcP, 'presencial');
    await declara(client, prof, svcO, 'online');
    await declara(client, prof, svcR, 'online');
    const pedidos = [];
    for (const km of [0, 1, 5, 18, 25, 60]) pedidos.push(await pedido(client, { svc: svcP, p: norte(SP, km) }));
    for (const km of [300, 1200]) pedidos.push(await pedido(client, { svc: svcO, p: norte(SP, km) }));
    pedidos.push(await pedido(client, { svc: svcR, p: norte(SP, 300) }));
    pedidos.push(await pedido(client, { svc: svcP, p: norte(SP, 2), prazo: '-1 hours' }));
    const deScan = new Set(await varre(prof, SP, 20000));
    for (const p of pedidos) {
      const porDetalhe = (await detalhe(prof, p.id)).length === 1;
      assert.equal(porDetalhe, deScan.has(p.id), `pedido ${p.id} divergente entre detalhe e discover_scan`);
    }
    assert.ok(deScan.size >= 6, 'o cenario tem casamentos reais');
  });
});

test('T-21 guarda: profissional aprovado com conta ativa passa na guarda e no detalhe', async () => {
  await isolado(async () => {
    const svc = await servico(client);
    const p = await pedido(client, { svc });
    const prof = await profissional(client);
    await base(client, prof);
    await declara(client, prof, svc, 'presencial');
    const guarda = (await client.query('select private.request_visibility_guard($1, $2::timestamptz) as ok', [prof, AGORA])).rows[0].ok;
    assert.equal(guarda, true);
    assert.equal((await detalhe(prof, p.id)).length, 1);
  });
});
