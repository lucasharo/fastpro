// H-056 (Issue #69) | Testes de banco das funcoes de acesso as fotos do pedido (167-DESENHO-H056.md, §7, fatia 1).
// Cobre S1 a S12 da matriz de acesso, a lista e o alvo de entrega (profissional e dono), os privilegios e a
// reversao (rollback e reaplicacao). Banco de desenvolvimento COMPARTILHADO: uma transacao aberta no before;
// cada teste roda num savepoint desfeito; rollback no after. Dados 100 % sinteticos (prefixo h056-), sem rede.
// Executar sozinho: node --test --test-concurrency=1 packages/db/tests/request-photo-access.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { connect, MIGRATIONS_DIR, REPO_ROOT } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const MS_HORA = 3600 * 1000;
const MARCA = `h056-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const M_POR_GRAU_LAT = 111195;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
const ms = (texto) => Date.parse(texto);
const longe = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });
const MIGRACAO = '20261120500000_media_create_request_photo_view_access';
const MIGRACAO_CONCESSAO = '20261120510000_media_grant_request_photo_access';
const ASSINATURA_ACESSO = 'private.request_photo_access(uuid,uuid,uuid,timestamptz)';

let client;

before(async () => {
  client = await connect();
  await client.query('begin');
});

after(async () => {
  await client.query('rollback');
  await client.end();
});

async function isolado(fn) {
  await client.query('savepoint t');
  try {
    await fn();
  } finally {
    await client.query('rollback to savepoint t');
  }
}

async function usuario(verificado = true) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', $4, $5)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), verificado ? AGORA : null, AGORA],
  );
  return id;
}

/** Profissional aprovado, com e-mail verificado e acesso comercial. acesso: 'vigente' | 'expirado' | 'carencia' | 'nenhum'. */
async function profissional({ acesso = 'vigente', verificacao = 'aprovada', emailVerificado = true } = {}) {
  const id = await usuario(emailVerificado);
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, $2, $3, $4, $4)`,
    [id, verificacao, verificacao === 'aprovada' ? AGORA : null, AGORA],
  );
  if (acesso === 'vigente') {
    await concederAcessoVigente(client, id, AGORA);
  } else if (acesso === 'expirado') {
    await client.query(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
       values ($1, $2, 'trial', $3, $4, 'ativa')`,
      [id, randomUUID(), iso(ms(AGORA) - 30 * MS_HORA * 24), iso(ms(AGORA) - 16 * MS_HORA * 24)],
    );
  } else if (acesso === 'carencia') {
    // Carencia de 72 h vale so para concessao paga (tipo 'paid') que terminou ha 24 h.
    await client.query(
      `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status, source_payment_id)
       values ($1, $2, 'paid', $3, $4, 'ativa', $5)`,
      [id, randomUUID(), iso(ms(AGORA) - 24 * MS_HORA - 30 * MS_HORA * 24), iso(ms(AGORA) - 24 * MS_HORA), randomUUID()],
    );
  }
  return id;
}

async function servico(modalidade = 'online') {
  const grupo = randomUUID();
  const id = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active) values ($1, $2, $3, $4, false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`, modalidade],
  );
  return id;
}

async function declara(prof, svc, modalidade = 'online') {
  await client.query(
    'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, $4)',
    [prof, svc, modalidade, AGORA],
  );
}

async function base(prof, p = SP, raio = 1000) {
  const g = await ponto('professional_base', prof, p);
  await client.query(
    `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
     values ($1, $2, 'Base sintetica', $3, $4, $4)`,
    [prof, g, raio, AGORA],
  );
}

async function rascunho(svc) {
  const id = randomUUID();
  const expira = iso(ms(AGORA) + 7 * MS_HORA * 24);
  const email = `${MARCA}-rascunho-${id.slice(0, 8)}@example.test`;
  await client.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [id, sha(`cookie-${id}`), svc, expira, sha('ip-sintetico'), AGORA, email, sha(email)],
  );
  return id;
}

async function ponto(tipo, sujeito, p = SP) {
  const r = await client.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ($1, $2, $3, 'ok',
             extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography,
             'permanent', 'endereco', $6)
     returning id`,
    [tipo, sujeito, sha(`end-${randomUUID()}`), p.lon, p.lat, AGORA],
  );
  return r.rows[0].id;
}

/**
 * Pedido sintetico. status: publicado | selecionado | concluido | cancelado. prazoMs: fim da admissao.
 * p: ponto do pedido (presencial precisa estar no raio do profissional).
 */
async function pedido({ status = 'publicado', prazoMs = ms(AGORA) + 168 * MS_HORA, svc, p = SP } = {}) {
  const cliente = await usuario();
  const servicoId = svc ?? (await servico('online'));
  const draft = await rascunho(servicoId);
  const g = await ponto('request', draft, p);
  const r = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5, $6)
     returning id`,
    [cliente, servicoId, g, draft, iso(prazoMs - 168 * MS_HORA), iso(prazoMs)],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await client.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return { id, cliente, svc: servicoId, draft };
}

/** Foto sintetica do pedido. status: ready | pending | rejected; expurgada: marca purge_requested_at. */
async function foto(pedidoRef, { status = 'ready', expurgada = false, pedidoId = pedidoRef.id, draft = pedidoRef.draft } = {}) {
  const pronta = status === 'ready';
  const r = await client.query(
    `insert into app.media_asset (draft_id, client_upload_id, declared_type, declared_bytes, status, confirmed_at,
                                  confirmed_bytes, pending_expires_at, purge_requested_at, request_id, ready_at,
                                  ready_bytes, ready_width, ready_height, reject_code)
     values ($1, $2, 'image/jpeg', 1000, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      draft,
      randomUUID(),
      status,
      pronta ? AGORA : null,
      pronta ? 1000 : null,
      iso(ms(AGORA) + 86400000),
      expurgada ? AGORA : null,
      pedidoId,
      pronta ? AGORA : null,
      pronta ? 900 : null,
      pronta ? 800 : null,
      pronta ? 600 : null,
      status === 'rejected' ? 'imagem_invalida' : null,
    ],
  );
  return r.rows[0].id;
}

/**
 * Aceite sintetico. A insercao segue o gatilho de criacao (nasce ativo, dentro do prazo, pedido publicado, vaga
 * sequencial); retirada e remocao sao transicoes feitas depois, como no fluxo real. Devolve o id do aceite.
 */
async function aceite(pedidoId, prof, status = 'ativo', slot = 1) {
  const r = await client.query(
    `insert into app.acceptance (request_id, professional_id, identity_id, slot_no, status, accepted_at)
     values ($1, $2, $3, $4, 'ativo', $5) returning id`,
    [pedidoId, prof, randomUUID(), slot, AGORA],
  );
  await client.query('update app.service_request set acceptances_count = $2 where id = $1', [pedidoId, slot]);
  if (status === 'retirado') {
    await client.query(
      "update app.acceptance set status = 'retirado', withdrawn_at = $2 where id = $1",
      [r.rows[0].id, AGORA],
    );
  } else if (status === 'removido_por_seguranca') {
    await client.query(
      "update app.acceptance set status = 'removido_por_seguranca', removed_reason = 'risco_fraude' where id = $1",
      [r.rows[0].id],
    );
  }
  return r.rows[0].id;
}

/** Muda o status do pedido depois do aceite (o gatilho de criacao so aceita pedido publicado). */
async function mudarStatus(pedidoId, status) {
  await client.query("update app.service_request set status = $2 where id = $1", [pedidoId, status]);
}

async function acesso(prof, pedidoId, fotoId, agora = AGORA) {
  const r = await client.query('select private.request_photo_access($1, $2, $3, $4) as ok', [pedidoId, prof, fotoId, agora]);
  return r.rows[0].ok;
}

/** Profissional elegivel para um pedido online (servico declarado, acesso vigente). */
async function elegivelPara(pedidoRef, acessoTipo = 'vigente') {
  const prof = await profissional({ acesso: acessoTipo });
  await declara(prof, pedidoRef.svc, 'online');
  return prof;
}

// ---------- S1 a S12: matriz de acesso ----------

test('S1 | elegivel, pedido publicado, dentro do prazo, servico e raio compativeis: autorizado (pedido e foto pronta)', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await elegivelPara(ped);
    const f = await foto(ped);
    assert.equal(await acesso(prof, ped.id, null), true);
    assert.equal(await acesso(prof, ped.id, f), true);
  }));

test('S2 | verificacao pendente, e-mail nao verificado: negado', () =>
  isolado(async () => {
    const ped = await pedido();
    const pendente = await profissional({ verificacao: 'pendente' });
    await declara(pendente, ped.svc, 'online');
    const semEmail = await profissional({ emailVerificado: false });
    await declara(semEmail, ped.svc, 'online');
    const f = await foto(ped);
    assert.equal(await acesso(pendente, ped.id, f), false);
    assert.equal(await acesso(semEmail, ped.id, f), false);
  }));

test('S3 | acesso comercial vencido apos a carencia (pre-aceite): negado', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await profissional({ acesso: 'expirado' });
    await declara(prof, ped.svc, 'online');
    const f = await foto(ped);
    assert.equal(await acesso(prof, ped.id, f), false);
  }));

test('S4 | em carencia (72 h) pre-aceite: autorizado', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await profissional({ acesso: 'carencia' });
    await declara(prof, ped.svc, 'online');
    const f = await foto(ped);
    assert.equal(await acesso(prof, ped.id, f), true);
  }));

test('S5 | fora do raio ou servico nao atendido: negado', () =>
  isolado(async () => {
    const svcPresencial = await servico('presencial');
    const longePed = await pedido({ svc: svcPresencial, p: longe(SP, 50) });
    const pres = await profissional();
    await base(pres, SP, 5000);
    await declara(pres, svcPresencial, 'presencial');
    const fLonge = await foto(longePed);
    assert.equal(await acesso(pres, longePed.id, fLonge), false, 'fora do raio');

    const outro = await pedido();
    const naoAtende = await profissional();
    await base(naoAtende, SP, 50000);
    const fOutro = await foto(outro);
    assert.equal(await acesso(naoAtende, outro.id, fOutro), false, 'servico nao declarado');
  }));

test('S6 | nao participante com prazo encerrado (p_now >= acceptance_deadline_at): negado', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await elegivelPara(ped);
    const f = await foto(ped);
    const fimDoPrazo = iso(ms(AGORA) + 168 * MS_HORA);
    assert.equal(await acesso(prof, ped.id, f, fimDoPrazo), false);
  }));

test('S7 | participante ativo, prazo vencido, pedido selecionado: autorizado (foto pronta)', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await profissional();
    await aceite(ped.id, prof, 'ativo');
    await mudarStatus(ped.id, 'selecionado');
    const f = await foto(ped);
    const depoisDoPrazo = iso(ms(AGORA) + 200 * MS_HORA);
    assert.equal(await acesso(prof, ped.id, f, depoisDoPrazo), true);
  }));

test('S8 | participante retirado ou removido por seguranca: negado (mesmo com pedido publicado e prazo aberto)', () =>
  isolado(async () => {
    const ped = await pedido();
    const retirado = await profissional();
    await declara(retirado, ped.svc, 'online');
    await aceite(ped.id, retirado, 'retirado', 1);
    const removido = await profissional();
    await declara(removido, ped.svc, 'online');
    await aceite(ped.id, removido, 'removido_por_seguranca', 2);
    const f = await foto(ped);
    assert.equal(await acesso(retirado, ped.id, f), false, 'retirado');
    assert.equal(await acesso(removido, ped.id, f), false, 'removido');
  }));

test('S9 | participante ativo com acesso comercial vencido: autorizado (guarda participacao)', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await profissional({ acesso: 'expirado' });
    await aceite(ped.id, prof, 'ativo');
    await mudarStatus(ped.id, 'selecionado');
    const f = await foto(ped);
    assert.equal(await acesso(prof, ped.id, f), true);
  }));

test('S10 | foto de outro pedido, pending, rejected ou marcada para expurgo: negado', () =>
  isolado(async () => {
    const ped = await pedido();
    const outro = await pedido();
    const prof = await elegivelPara(ped);
    const deOutro = await foto(outro);
    const pendente = await foto(ped, { status: 'pending' });
    const recusada = await foto(ped, { status: 'rejected' });
    const expurgada = await foto(ped, { expurgada: true });
    assert.equal(await acesso(prof, ped.id, deOutro), false, 'outro pedido');
    assert.equal(await acesso(prof, ped.id, pendente), false, 'pending');
    assert.equal(await acesso(prof, ped.id, recusada), false, 'rejected');
    assert.equal(await acesso(prof, ped.id, expurgada), false, 'purge_requested_at');
  }));

test('S11 | pedido concluido ou cancelado: negado ao profissional; dono ve a foto nao expurgada', () =>
  isolado(async () => {
    for (const status of ['concluido', 'cancelado']) {
      const ped = await pedido({ status });
      const prof = await elegivelPara(ped);
      const f = await foto(ped);
      assert.equal(await acesso(prof, ped.id, f), false, `profissional sem aceite, ${status}`);
      const dono = await client.query('select * from private.request_photo_owner_target($1, $2, $3)', [
        ped.cliente,
        ped.id,
        f,
      ]);
      assert.equal(dono.rows.length, 1, `dono ve a foto em ${status}`);
    }
    const cancelado = await pedido();
    const participante = await profissional();
    await aceite(cancelado.id, participante, 'ativo');
    await mudarStatus(cancelado.id, 'cancelado');
    const fc = await foto(cancelado);
    assert.equal(await acesso(participante, cancelado.id, fc), false, 'participante, pedido cancelado');
  }));

test('S12 | UUID nulo ou inexistente: negado sem excecao, em todas as funcoes', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await elegivelPara(ped);
    const f = await foto(ped);
    const inexistente = randomUUID();
    assert.equal(await acesso(null, ped.id, f), false);
    assert.equal(await acesso(prof, null, f), false);
    assert.equal(await acesso(prof, inexistente, f), false);
    assert.equal(await acesso(prof, ped.id, inexistente), false);
    const r = await client.query('select * from private.request_photo_list($1, $2, $3)', [null, null, null]);
    assert.equal(r.rows.length, 0);
    const t = await client.query('select * from private.request_photo_target($1, $2, $3, $4)', [prof, inexistente, f, AGORA]);
    assert.equal(t.rows.length, 0);
    const o = await client.query('select * from private.request_photo_owner_list($1, $2)', [null, ped.id]);
    assert.equal(o.rows.length, 0);
  }));

// ---------- lista e alvo de entrega ----------

test('lista do profissional: sem foto pronta devolve uma linha nula; com fotos devolve posicoes 1..n em ordem', () =>
  isolado(async () => {
    const ped = await pedido();
    const prof = await elegivelPara(ped);
    const vazia = await client.query('select * from private.request_photo_list($1, $2, $3)', [prof, ped.id, AGORA]);
    assert.equal(vazia.rows.length, 1);
    assert.equal(vazia.rows[0].out_id, null);

    const f1 = await foto(ped);
    const f2 = await foto(ped);
    await foto(ped, { status: 'pending' });
    const lista = await client.query('select * from private.request_photo_list($1, $2, $3)', [prof, ped.id, AGORA]);
    assert.equal(lista.rows.length, 2);
    assert.deepEqual(lista.rows.map((x) => x.out_pos), [1, 2]);
    assert.deepEqual(new Set(lista.rows.map((x) => x.out_id)), new Set([f1, f2]));
    assert.equal(lista.rows[0].out_width, 800);
    assert.equal(lista.rows[0].out_height, 600);
  }));

test('lista e alvo: pedido negado devolve zero linhas; alvo da foto pronta traz bytes e dimensoes declaradas', () =>
  isolado(async () => {
    const ped = await pedido();
    const estranho = await profissional();
    const f = await foto(ped);
    const negada = await client.query('select * from private.request_photo_list($1, $2, $3)', [estranho, ped.id, AGORA]);
    assert.equal(negada.rows.length, 0);
    const prof = await elegivelPara(ped);
    const alvo = await client.query('select * from private.request_photo_target($1, $2, $3, $4)', [prof, ped.id, f, AGORA]);
    assert.equal(alvo.rows.length, 1);
    assert.deepEqual(alvo.rows[0], { out_bytes: 900, out_width: 800, out_height: 600 });
  }));

// ---------- dono ----------

test('dono: lista e alvo sem guarda comercial; outro usuario nao ve; foto pendente nao aparece', () =>
  isolado(async () => {
    const ped = await pedido({ status: 'concluido' });
    const f = await foto(ped);
    await foto(ped, { status: 'pending' });
    const lista = await client.query('select * from private.request_photo_owner_list($1, $2)', [ped.cliente, ped.id]);
    assert.equal(lista.rows.length, 1);
    assert.equal(lista.rows[0].out_id, f);
    const alvo = await client.query('select * from private.request_photo_owner_target($1, $2, $3)', [ped.cliente, ped.id, f]);
    assert.deepEqual(alvo.rows[0], { out_bytes: 900, out_width: 800, out_height: 600 });
    const outro = await usuario();
    const negado = await client.query('select * from private.request_photo_owner_target($1, $2, $3)', [outro, ped.id, f]);
    assert.equal(negado.rows.length, 0);
    const listaNegada = await client.query('select * from private.request_photo_owner_list($1, $2)', [outro, ped.id]);
    assert.equal(listaNegada.rows.length, 0);
  }));

// ---------- privilegios ----------

test('privilegios: so app_system executa as funcoes; PUBLIC, anon, authenticated, service_role e papeis de API nao', async () => {
  const funcoes = [
    'private.request_photo_pedido_acesso(uuid,uuid,timestamptz)',
    'private.request_photo_access(uuid,uuid,uuid,timestamptz)',
    'private.request_photo_rows(uuid)',
    'private.request_photo_list(uuid,uuid,timestamptz)',
    'private.request_photo_target(uuid,uuid,uuid,timestamptz)',
    'private.request_photo_owner_list(uuid,uuid)',
    'private.request_photo_owner_target(uuid,uuid,uuid)',
  ];
  for (const fn of funcoes) {
    const publico = await client.query(
      `select exists (
         select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = to_regprocedure($1) and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`,
      [fn],
    );
    assert.equal(publico.rows[0].ok, false, `PUBLIC sem EXECUTE em ${fn}`);
    for (const papel of ['anon', 'authenticated', 'service_role', 'app_api', 'app_backup_reader']) {
      const r = await client.query('select has_function_privilege($1, to_regprocedure($2), $3) as ok', [papel, fn, 'EXECUTE']);
      assert.equal(r.rows[0].ok, false, `${papel} sem EXECUTE em ${fn}`);
    }
  }
  for (const fn of [ASSINATURA_ACESSO, 'private.request_photo_list(uuid,uuid,timestamptz)']) {
    const r = await client.query("select has_function_privilege('app_system', to_regprocedure($1), 'EXECUTE') as ok", [fn]);
    assert.equal(r.rows[0].ok, true, `app_system com EXECUTE em ${fn}`);
  }
});

// ---------- reversao ----------

test('reversao: o rollback remove as funcoes sem tocar tabelas, e a migracao reaplicada as recria', () =>
  isolado(async () => {
    const existe = async () =>
      (await client.query("select to_regprocedure('private.request_photo_access(uuid,uuid,uuid,timestamptz)') is not null as ok")).rows[0].ok;
    assert.equal(await existe(), true);
    const tabelasAntes = (await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'app'")).rows[0].n;
    const lerRollback = (nome) => readFileSync(join(REPO_ROOT, 'supabase', 'rollbacks', `${nome}.down.sql`), 'utf8');
    const lerMigracao = (nome) => readFileSync(join(MIGRATIONS_DIR, `${nome}.sql`), 'utf8');
    await client.query(lerRollback(MIGRACAO_CONCESSAO));
    await client.query(lerRollback(MIGRACAO));
    assert.equal(await existe(), false, 'rollback removeu a funcao');
    await client.query(lerMigracao(MIGRACAO));
    await client.query(lerMigracao(MIGRACAO_CONCESSAO));
    assert.equal(await existe(), true, 'reaplicacao recriou a funcao');
    const tabelasDepois = (await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'app'")).rows[0].n;
    assert.equal(tabelasDepois, tabelasAntes, 'nenhuma tabela criada ou removida');
  }));
