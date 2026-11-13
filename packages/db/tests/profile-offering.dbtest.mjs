// H-036 | Cenarios de banco da oferta do perfil profissional: servicos, base e raio (docs/factory/99-DESENHO-H036.md,
// §3, §4, §7; CA-01 a CA-13; decisoes 109 a 114). Migracoes 20261112160000 (tabelas e funcoes) e 20261112170000
// (catalogo de auditoria) aplicadas no banco de desenvolvimento. Cada teste roda numa transacao e termina com
// rollback: nada persiste no banco compartilhado. Valores sinteticos (@example.test), sem rede e sem Mapbox real.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/profile-offering.dbtest.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const MIG = new URL('../../../supabase/migrations/20261112160000_profile_expand_services_area.sql', import.meta.url);
const MIG_AUDIT = new URL('../../../supabase/migrations/20261112170000_profile_audit_actions.sql', import.meta.url);
// Correcao do before_state da primeira definicao (AU002); reaplica a funcao corrigida apos a 160000 no T-P20.
const MIG_AUDIT_FIX = new URL('../../../supabase/migrations/20261112180000_profile_fix_audit_before_state.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261112160000_profile_expand_services_area.down.sql', import.meta.url);

const client = await connect();
after(async () => {
  await client?.end();
});

const T0 = Date.parse('2099-08-15T12:00:00.000Z');
const HORA = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ROTULO = 'Rua Sintetica, 100 - Centro';
const SP = { lon: -46.6333, lat: -23.5505 };
/** Chaves dos baldes de taxa: HMAC em hex de 64 caracteres, como a API envia (rate_counter.key_hmac). */
const chaveGravacao = (user) => sha(`test-write:${user}`);
const chaveGeo = (user) => sha(`geo:${user}`);

const SQL_AREA_SAVE =
  'select out_status, out_retry_after from private.professional_area_save($1::uuid, $2::uuid, $3::text, $4::integer, $5::timestamptz)';
const SQL_SVC_SAVE =
  'select out_status, out_index, out_retry_after from private.professional_services_save($1::uuid, $2::jsonb, $3::timestamptz, $4::text)';
const SQL_LIST =
  'select out_service_id, out_name, out_regulated, out_active, out_modality from private.professional_services_list($1::uuid)';
const SQL_AREA_GET = 'select * from private.professional_area_get($1::uuid, $2::timestamptz)';
const SQL_AT = 'select out_geocode_point_id, out_radius_m from private.professional_area_at($1::uuid, $2::timestamptz)';
const SQL_PRECHECK =
  'select out_status, out_retry_after, out_calls_cap from private.professional_area_precheck($1::uuid, $2::text, $3::text, $4::boolean, $5::timestamptz)';

/** Transacao de teste: tudo desfeito no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Comando que deve falhar: o savepoint desfaz a falha e a transacao segue. Devolve o erro (ou null). */
async function erroDe(sql, params = []) {
  await client.query('savepoint cenario');
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err;
  } finally {
    await client.query('rollback to savepoint cenario');
  }
}

async function contar(sql, params = []) {
  const r = await client.query(`select count(*)::int as n from (${sql}) q`, params);
  return r.rows[0].n;
}

async function usuario() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `${randomUUID()}@example.test`, randomUUID()],
  );
  return id;
}

/** Perfil profissional com o status dado (insert direto: o gatilho de H-035 so protege UPDATE). */
async function perfil(status = 'aprovada') {
  const id = await usuario();
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [id, status],
  );
  return id;
}

/** Servico do catalogo sintetico: modalidade presencial, online ou ambos (flag PR, ON, HI). */
async function servico(modalidade, { ativo = true, regulado = false } = {}) {
  const g = await client.query('insert into app.service_group (name, position, active) values ($1, $2, true) returning id', [
    `Grupo ${randomUUID()}`,
    1 + Math.floor(Math.random() * 1e6),
  ]);
  const s = await client.query(
    'insert into app.service (group_id, name, modality, regulated, active) values ($1, $2, $3, $4, $5) returning id',
    [g.rows[0].id, `Servico ${randomUUID()}`, modalidade, regulado, ativo],
  );
  return s.rows[0].id;
}

/** Ponto da base: 'ok' = coordenada permanente gravada (#34/#35); 'reservado' = reserva sem resultado. */
async function ponto(user, { estado = 'ok' } = {}) {
  const r = await client.query(
    'select out_acao, out_ref from private.geo_reserve($1::text, $2::uuid, $3::text, $4::timestamptz, $5::integer, $6::integer, $7::integer, $8::integer)',
    ['professional_base', user, sha(randomUUID()), iso(T0), 60, 40, 1000, 2000],
  );
  assert.equal(r.rows[0].out_acao, 'chamar');
  const ref = r.rows[0].out_ref;
  if (estado === 'reservado') return ref;
  const s = await client.query(
    "select private.geo_store_permanent($1::uuid, 'permanent', $2::double precision, $3::double precision, 'endereco', $4::timestamptz) as id",
    [ref, SP.lon, SP.lat, iso(T0)],
  );
  return s.rows[0].id;
}

async function areaSalvar(user, { point = null, label = null, raio = null, agora = T0 } = {}) {
  const r = await client.query(SQL_AREA_SAVE, [user, point, label, raio, iso(agora)]);
  return r.rows[0];
}

/** Itens no formato [servico, modalidade]; a funcao recebe um item por modalidade (decisao 109). */
async function servicosSalvar(user, itens, agora = T0) {
  const payload = JSON.stringify(itens.map(([s, m]) => ({ service_id: s, modality: m })));
  const r = await client.query(SQL_SVC_SAVE, [user, payload, iso(agora), chaveGravacao(user)]);
  return r.rows[0];
}

async function listar(user) {
  return (await client.query(SQL_LIST, [user])).rows;
}

/** Perfil com base e raio ja definidos (raio 10 km), usado pelos cenarios de servico. */
async function comBase(raio = 10) {
  const user = await perfil();
  const p = await ponto(user);
  const r = await areaSalvar(user, { point: p, label: ROTULO, raio });
  assert.equal(r.out_status, 'definida');
  return { user, point: p };
}

async function linhaPerfil(user) {
  const r = await client.query('select verification_status, updated_at from app.professional_profile where user_id = $1', [user]);
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------------------------
// CA-01 e CA-03: declaracao de servicos por modalidade
// ---------------------------------------------------------------------------------------------------------------

test('T-P01 CA-01: declara presencial, online e ambos; "ambos" vira duas linhas; so o dono ve', async () => {
  await tx(async () => {
    const { user } = await comBase();
    const hi = await servico('ambos');

    assert.equal((await servicosSalvar(user, [[hi, 'presencial']])).out_status, 'saved');
    assert.equal((await listar(user)).length, 1);

    assert.equal((await servicosSalvar(user, [[hi, 'presencial'], [hi, 'online']])).out_status, 'saved');
    const linhas = await listar(user);
    assert.equal(linhas.length, 2, 'ambos ocupa duas linhas (decisao 109)');
    assert.deepEqual(linhas.map((l) => l.out_modality).sort(), ['online', 'presencial']);

    const outro = await perfil();
    assert.equal((await listar(outro)).length, 0, 'outro profissional nao ve a declaracao');
  });

  await tx(async () => {
    const sozinho = await perfil();
    const on = await servico('online');
    assert.equal((await servicosSalvar(sozinho, [[on, 'online']])).out_status, 'saved', 'online sem base e aceito');
    assert.equal((await listar(sozinho))[0].out_modality, 'online');
  });
});

test('T-P02 CA-02: modalidade incompativel, inativo e inexistente sao recusados sem gravar; INSERT direto tambem', async () => {
  await tx(async () => {
    const { user } = await comBase();
    const pr = await servico('presencial');
    const on = await servico('online');
    const inativo = await servico('ambos', { ativo: false });
    const hi = await servico('ambos');

    const antes = await contar('select 1 from app.professional_service where professional_id = $1', [user]);
    assert.equal((await servicosSalvar(user, [[pr, 'online']])).out_status, 'modalidade_incompativel');
    assert.equal((await servicosSalvar(user, [[on, 'presencial']])).out_status, 'modalidade_incompativel');
    assert.equal((await servicosSalvar(user, [[inativo, 'online']])).out_status, 'servico_indisponivel');
    assert.equal((await servicosSalvar(user, [[randomUUID(), 'online']])).out_status, 'servico_indisponivel');
    assert.equal(await contar('select 1 from app.professional_service where professional_id = $1', [user]), antes, 'nada gravado');

    assert.equal((await servicosSalvar(user, [[hi, 'presencial'], [hi, 'online']])).out_status, 'saved', 'HI aceita as duas');

    const errIncompativel = await erroDe(
      'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, now())',
      [user, pr, 'online'],
    );
    assert.match(errIncompativel?.message ?? '', /servico_modalidade_incompativel/);
    const errInativo = await erroDe(
      'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, now())',
      [user, inativo, 'online'],
    );
    assert.match(errInativo?.message ?? '', /servico_indisponivel/);
  });
});

test('T-P03 CA-03: remover, trocar modalidade, reenvio identico (unchanged, sem auditoria) e servico desativado', async () => {
  await tx(async () => {
    const { user } = await comBase();
    const a = await servico('ambos');
    const b = await servico('ambos');

    assert.equal((await servicosSalvar(user, [[a, 'presencial'], [b, 'online']])).out_status, 'saved');
    // Troca: A presencial sai e A online entra; B online sai.
    assert.equal((await servicosSalvar(user, [[a, 'online']], T0 + HORA)).out_status, 'saved');
    assert.deepEqual((await listar(user)).map((l) => [l.out_service_id, l.out_modality]), [[a, 'online']]);

    // Trocar para ambos acrescenta a outra linha.
    assert.equal((await servicosSalvar(user, [[a, 'online'], [a, 'presencial']], T0 + 2 * HORA)).out_status, 'saved');
    assert.equal((await listar(user)).length, 2);

    // Reenvio identico: unchanged, declared_at preservado e nenhuma auditoria nova.
    const auditoriaAntes = await contar(
      "select 1 from audit.audit_event where object_id = $1 and action = 'profile.services.changed'",
      [user],
    );
    assert.equal((await servicosSalvar(user, [[a, 'online'], [a, 'presencial']], T0 + 3 * HORA)).out_status, 'unchanged');
    const auditoriaDepois = await contar(
      "select 1 from audit.audit_event where object_id = $1 and action = 'profile.services.changed'",
      [user],
    );
    assert.equal(auditoriaDepois, auditoriaAntes, 'reenvio identico nao audita');
    const declaradoAgora = (await client.query(
      'select declared_at from app.professional_service where professional_id = $1 and service_id = $2 and modality = $3',
      [user, a, 'online'],
    )).rows[0].declared_at;
    assert.equal(declaradoAgora.getTime(), new Date(iso(T0 + HORA)).getTime(), 'declared_at da linha mantida');

    // Servico desativado depois: reenvio igual continua aceito; inclusao nova de servico inativo nao.
    await client.query('update app.service set active = false where id = $1', [a]);
    assert.equal((await servicosSalvar(user, [[a, 'online'], [a, 'presencial']], T0 + 4 * HORA)).out_status, 'unchanged');
    const c = await servico('ambos', { ativo: false });
    assert.equal((await servicosSalvar(user, [[a, 'online'], [a, 'presencial'], [c, 'online']], T0 + 5 * HORA)).out_status, 'servico_indisponivel');

    // Remover tudo e aceito e some do perfil.
    assert.equal((await servicosSalvar(user, [], T0 + 6 * HORA)).out_status, 'saved');
    assert.equal((await listar(user)).length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-04 e CA-07: base e raio
// ---------------------------------------------------------------------------------------------------------------

test('T-P04 CA-04: presencial exige base vigente; so online aceita sem base; base em uso nao se apaga', async () => {
  await tx(async () => {
    const user = await perfil();
    const hi = await servico('ambos');
    const on = await servico('online');

    const sem = await servicosSalvar(user, [[hi, 'presencial']]);
    assert.equal(sem.out_status, 'base_obrigatoria');
    assert.equal(sem.out_index, 0);
    assert.equal((await listar(user)).length, 0);

    const errDireto = await erroDe(
      'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, now())',
      [user, hi, 'presencial'],
    );
    assert.match(errDireto?.message ?? '', /servico_presencial_sem_base/);

    assert.equal((await servicosSalvar(user, [[on, 'online']])).out_status, 'saved');

    const p = await ponto(user);
    assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: 20 })).out_status, 'definida');
    assert.equal((await servicosSalvar(user, [[on, 'online'], [hi, 'presencial']])).out_status, 'saved');

    const emUso = await erroDe('delete from app.professional_area where professional_id = $1', [user]);
    assert.match(emUso?.message ?? '', /area_em_uso/);
  });
});

test('T-P04b CA-04: primeira definicao sem raio ou sem rotulo recusa com dados_incompletos', async () => {
  await tx(async () => {
    const user = await perfil();
    const p = await ponto(user);
    assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: null })).out_status, 'dados_incompletos');
    assert.equal((await areaSalvar(user, { point: p, label: null, raio: 10 })).out_status, 'dados_incompletos');
    assert.equal(await contar('select 1 from app.professional_area where professional_id = $1', [user]), 0);
  });
});

test('T-P05 CA-07: raio fora de 5..100 km recusado pela funcao e pelo banco; bordas aceitas e gravadas em metros', async () => {
  await tx(async () => {
    const user = await perfil();
    const p = await ponto(user);
    for (const raio of [4, 101, 0, -3]) {
      assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio })).out_status, 'raio_invalido', `raio ${raio}`);
    }
    assert.equal(await contar('select 1 from app.professional_area where professional_id = $1', [user]), 0);

    assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: 5 })).out_status, 'definida');
    assert.equal((await client.query('select radius_m from app.professional_area where professional_id = $1', [user])).rows[0].radius_m, 5000);
    assert.equal((await areaSalvar(user, { raio: 100, agora: T0 + HORA })).out_status, 'alterada');
    assert.equal((await client.query('select radius_m from app.professional_area where professional_id = $1', [user])).rows[0].radius_m, 100000);

    const outro = await perfil();
    const p2 = await ponto(outro);
    const base = { user: outro, p: p2 };
    for (const radius of [4999, 100001]) {
      const err = await erroDe(
        'insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at) values ($1, $2, $3, $4, now(), now())',
        [base.user, base.p, ROTULO, radius],
      );
      assert.ok(err, `INSERT direto com ${radius} m deve falhar`);
      assert.equal(err.code, '23514');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-05 e CA-06: a base so existe com coordenada permanente da propria base
// ---------------------------------------------------------------------------------------------------------------

test('T-P08 CA-05/CA-06: ponto de outro profissional ou nao permanente e recusado; base anterior permanece', async () => {
  await tx(async () => {
    const { user, point } = await comBase(10);
    const outro = await perfil();
    const doOutro = await ponto(outro);
    const reservado = await ponto(user, { estado: 'reservado' });

    assert.equal((await areaSalvar(user, { point: doOutro, label: ROTULO, raio: 12, agora: T0 + HORA })).out_status, 'ponto_invalido');
    assert.equal((await areaSalvar(user, { point: reservado, label: ROTULO, raio: 12, agora: T0 + HORA })).out_status, 'ponto_invalido');

    const errOutro = await erroDe(
      'update app.professional_area set geocode_point_id = $2 where professional_id = $1',
      [user, doOutro],
    );
    assert.match(errOutro?.message ?? '', /area_ponto_invalido/);
    const errReservado = await erroDe(
      'update app.professional_area set geocode_point_id = $2 where professional_id = $1',
      [user, reservado],
    );
    assert.match(errReservado?.message ?? '', /area_ponto_invalido/);

    const atual = (await client.query('select geocode_point_id, radius_m from app.professional_area where professional_id = $1', [user])).rows[0];
    assert.equal(atual.geocode_point_id, point, 'base anterior mantida');
    assert.equal(atual.radius_m, 10000, 'raio anterior mantido');
    assert.equal(await contar('select 1 from app.professional_area_history where professional_id = $1', [user]), 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-08: limite de mudanca, parametro e historico
// ---------------------------------------------------------------------------------------------------------------

test('T-P09 CA-08: limite de 3 mudancas em 24 h; 4a recusa com retry_after; janela; unchanged nao conta', async () => {
  await tx(async () => {
    const { user, point } = await comBase(10);
    assert.equal((await areaSalvar(user, { raio: 11, agora: T0 + HORA })).out_status, 'alterada');
    assert.equal((await areaSalvar(user, { raio: 12, agora: T0 + 2 * HORA })).out_status, 'alterada');
    assert.equal((await areaSalvar(user, { raio: 13, agora: T0 + 3 * HORA })).out_status, 'alterada');

    // unchanged nao conta no limite
    assert.equal((await areaSalvar(user, { raio: 13, agora: T0 + 3 * HORA + 1000 })).out_status, 'unchanged');

    const quarta = await areaSalvar(user, { raio: 14, agora: T0 + 4 * HORA });
    assert.equal(quarta.out_status, 'limite_mudanca');
    // A mais antiga da janela e T0+1h; libera em T0+25h. Faltam 21 h = 75600 s a partir de T0+4h.
    assert.equal(quarta.out_retry_after, 75600);
    assert.equal((await client.query('select radius_m from app.professional_area where professional_id = $1', [user])).rows[0].radius_m, 13000, 'nada muda');

    const area = (await client.query(SQL_AREA_GET, [user, iso(T0 + 4 * HORA)])).rows[0];
    assert.equal(area.out_changes_remaining, 0);
    assert.equal(new Date(area.out_next_change_at).getTime(), T0 + 25 * HORA);

    // Depois de 24 h da primeira mudanca a janela libera uma vaga.
    assert.equal((await areaSalvar(user, { raio: 14, agora: T0 + 25 * HORA })).out_status, 'alterada');
    assert.ok(point);
  });
});

test('T-P09b CA-08: base e raio no mesmo pedido contam como uma mudanca so', async () => {
  await tx(async () => {
    const { user } = await comBase(10);
    const outra = await ponto(user);
    assert.equal((await areaSalvar(user, { point: outra, label: 'Outra Rua Sintetica, 200', raio: 15, agora: T0 + HORA })).out_status, 'alterada');
    const restantes = (await client.query(SQL_AREA_GET, [user, iso(T0 + HORA)])).rows[0].out_changes_remaining;
    assert.equal(restantes, 2);
  });
});

test('T-P10 CA-08: profile.offering_limits muda o limite sem deploy; valor invalido cai no padrao do campo', async () => {
  await tx(async () => {
    await client.query("update ops.app_config set value = jsonb_set(value, '{change_max}', '1'::jsonb) where key = 'profile.offering_limits'");
    const { user } = await comBase(10);
    assert.equal((await areaSalvar(user, { raio: 11, agora: T0 + HORA })).out_status, 'alterada');
    assert.equal((await areaSalvar(user, { raio: 12, agora: T0 + 2 * HORA })).out_status, 'limite_mudanca');
  });

  await tx(async () => {
    const invalidos = [
      '{"change_max":"abc"}',
      '{"change_max":0}',
      '{"change_max":-1}',
      '{"change_max":1000}',
      '{"change_max":2.5}',
      '{}',
    ];
    for (const valor of invalidos) {
      await client.query("update ops.app_config set value = $1::jsonb where key = 'profile.offering_limits'", [valor]);
      const r = await client.query('select private.professional_offering_limits() ->> $1 as v', ['change_max']);
      assert.equal(r.rows[0].v, '3', `valor ${valor} deve cair no padrao 3`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-09 e historico "vigente desde" (decisao 110)
// ---------------------------------------------------------------------------------------------------------------

test('T-P11 CA-09: historico com vigente desde; uma linha aberta; professional_area_at responde por instante', async () => {
  await tx(async () => {
    const { user, point } = await comBase(10);
    const outra = await ponto(user);
    assert.equal((await areaSalvar(user, { point: outra, label: 'Outra Rua Sintetica, 200', raio: 11, agora: T0 + HORA })).out_status, 'alterada');

    const hist = (await client.query(
      'select geocode_point_id, radius_m, valid_from, valid_to, change_kind from app.professional_area_history where professional_id = $1 order by valid_from',
      [user],
    )).rows;
    assert.equal(hist.length, 2);
    assert.equal(hist[0].change_kind, 'definida');
    assert.equal(hist[1].change_kind, 'alterada');
    assert.equal(hist[0].valid_to.getTime(), hist[1].valid_from.getTime(), 'sem lacuna nem sobreposicao');
    assert.equal(hist[1].valid_to, null);
    assert.equal(await contar('select 1 from app.professional_area_history where professional_id = $1 and valid_to is null', [user]), 1);

    const abertaDupla = await erroDe(
      'insert into app.professional_area_history (professional_id, geocode_point_id, radius_m, valid_from, valid_to, change_kind) values ($1, $2, 5000, now(), null, $3)',
      [user, point, 'alterada'],
    );
    assert.equal(abertaDupla?.code, '23505', 'so uma linha aberta por profissional');

    const antes = (await client.query(SQL_AT, [user, iso(T0 - HORA)])).rows;
    assert.equal(antes.length, 0, 'sem base antes da primeira definicao');
    const meio = (await client.query(SQL_AT, [user, iso(T0 + HORA / 2)])).rows[0];
    assert.equal(meio.out_geocode_point_id, point);
    assert.equal(meio.out_radius_m, 10000);
    const depois = (await client.query(SQL_AT, [user, iso(T0 + 2 * HORA)])).rows[0];
    assert.equal(depois.out_geocode_point_id, outra);
    assert.equal(depois.out_radius_m, 11000);
  });
});

test('T-P11b CA-09: historico e imutavel (UPDATE e DELETE recusados); linha aberta espelha professional_area', async () => {
  await tx(async () => {
    const { user } = await comBase(10);
    const up = await erroDe('update app.professional_area_history set radius_m = 6000 where professional_id = $1', [user]);
    assert.match(up?.message ?? '', /historico_imutavel/);
    const del = await erroDe('delete from app.professional_area_history where professional_id = $1', [user]);
    assert.match(del?.message ?? '', /historico_imutavel/);

    const espelho = (await client.query(
      `select a.radius_m as area_raio, h.radius_m as hist_raio, a.geocode_point_id = h.geocode_point_id as mesmo_ponto
         from app.professional_area a join app.professional_area_history h on h.professional_id = a.professional_id and h.valid_to is null
        where a.professional_id = $1`,
      [user],
    )).rows[0];
    assert.equal(espelho.area_raio, espelho.hist_raio);
    assert.equal(espelho.mesmo_ponto, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-10: auditoria sem localizacao (T-P13)
// ---------------------------------------------------------------------------------------------------------------

test('T-P13 CA-10: auditoria da base e dos servicos sem coordenada, rotulo nem identificador de servico', async () => {
  await tx(async () => {
    const { user, point } = await comBase(10);
    const on = await servico('online');
    assert.equal((await servicosSalvar(user, [[on, 'online']])).out_status, 'saved');
    assert.equal((await areaSalvar(user, { raio: 12, agora: T0 + HORA })).out_status, 'alterada');

    const linhas = (await client.query(
      "select actor_ref, actor_role, action, object_type, object_id, after_state from audit.audit_event where object_id = $1 order by seq",
      [user],
    )).rows;
    const areas = linhas.filter((l) => l.action === 'profile.area.changed');
    const servicos = linhas.filter((l) => l.action === 'profile.services.changed');
    assert.equal(areas.length, 2, 'definida e alterada geram uma linha cada');
    assert.equal(servicos.length, 1);
    assert.equal(areas[0].actor_ref, `professional:${user}`);
    assert.equal(areas[0].actor_role, 'professional');
    assert.equal(areas[0].object_type, 'professional_area');
    assert.deepEqual(Object.keys(areas[1].after_state).sort(), ['base_changed', 'change_kind', 'radius_m']);
    assert.equal(areas[1].after_state.base_changed, false);
    assert.deepEqual(Object.keys(servicos[0].after_state).sort(), ['online', 'presencial', 'total']);

    const texto = JSON.stringify(linhas);
    assert.ok(!texto.includes(ROTULO), 'sem rotulo do endereco');
    assert.ok(!texto.includes(String(SP.lat)) && !texto.includes(String(SP.lon)), 'sem coordenada');
    assert.ok(!texto.includes(point), 'sem identificador do ponto');
    assert.ok(!texto.includes(on), 'sem identificador do servico');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CA-11: privilegios e postura (T-P14)
// ---------------------------------------------------------------------------------------------------------------

test('T-P14 CA-11: tabelas sem DML nem SELECT para papeis; execute so de app_system; RLS forcada; sem coluna de coordenada', async () => {
  const tabelas = ['app.professional_service', 'app.professional_area', 'app.professional_area_history'];
  const papeis = ['anon', 'authenticated', 'service_role', 'app_api', 'app_system', 'app_backup_reader'];
  for (const t of tabelas) {
    for (const p of papeis) {
      for (const acao of ['select', 'insert', 'update', 'delete']) {
        const r = await client.query('select has_table_privilege($1, $2, $3) as ok', [p, t, acao]);
        assert.equal(r.rows[0].ok, false, `${p} nao pode ${acao} em ${t}`);
      }
    }
    const publico = await client.query(
      'select count(*)::int as n from aclexplode((select relacl from pg_class where oid = $1::regclass)) where grantee = 0',
      [t],
    );
    assert.equal(publico.rows[0].n, 0, `PUBLIC sem privilegio em ${t}`);
    const rls = (await client.query(
      'select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass',
      [t],
    )).rows[0];
    assert.equal(rls.relrowsecurity, true);
    assert.equal(rls.relforcerowsecurity, true);
  }

  const funcoes = [
    'private.professional_area_save(uuid,uuid,text,integer,timestamptz)',
    'private.professional_services_save(uuid,jsonb,timestamptz,text)',
    'private.professional_area_precheck(uuid,text,text,boolean,timestamptz)',
    'private.professional_area_get(uuid,timestamptz)',
    'private.professional_services_list(uuid)',
    'private.professional_area_at(uuid,timestamptz)',
    'private.professional_offering_purge(uuid)',
  ];
  for (const f of funcoes) {
    assert.equal((await client.query('select has_function_privilege($1, $2, $3) as ok', ['app_system', f, 'execute'])).rows[0].ok, true, `app_system executa ${f}`);
    for (const p of ['anon', 'authenticated', 'service_role', 'app_api']) {
      assert.equal((await client.query('select has_function_privilege($1, $2, $3) as ok', [p, f, 'execute'])).rows[0].ok, false, `${p} nao executa ${f}`);
    }
  }

  const colunas = (await client.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'app' and table_name in ('professional_service','professional_area','professional_area_history')`,
  )).rows;
  const proibidas = colunas.filter((c) => /^(lat|lon|latitude|longitude|point|geom|exact_point|match_.*|cell)$/.test(c.column_name));
  assert.deepEqual(proibidas, [], 'nenhuma coluna de coordenada ou de celula fora de geocode_point');
});

// ---------------------------------------------------------------------------------------------------------------
// CA-13: status (T-P17)
// ---------------------------------------------------------------------------------------------------------------

test('T-P17 CA-13: status nao suspenso salva servicos e base sem alterar o perfil; suspensa recusa tudo', async () => {
  for (const status of ['pendente', 'em_revisao', 'aprovada', 'retida_duplicidade', 'recusada']) {
    await tx(async () => {
      const user = await perfil(status);
      const antes = await linhaPerfil(user);
      const p = await ponto(user);
      assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: 10 })).out_status, 'definida', status);
      const on = await servico('online');
      assert.equal((await servicosSalvar(user, [[on, 'online']])).out_status, 'saved', status);
      const depois = await linhaPerfil(user);
      assert.equal(depois.verification_status, status);
      assert.equal(depois.updated_at.getTime(), antes.updated_at.getTime(), `perfil ${status} intacto (updated_at)`);
    });
  }

  await tx(async () => {
    const user = await perfil('suspensa');
    const p = await ponto(user);
    assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: 10 })).out_status, 'suspenso');
    const on = await servico('online');
    assert.equal((await servicosSalvar(user, [[on, 'online']])).out_status, 'suspenso');
    assert.equal(await contar('select 1 from app.professional_area where professional_id = $1', [user]), 0);
    assert.equal(await contar('select 1 from app.professional_service where professional_id = $1', [user]), 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// §4.5: limites gerais e de tentativas
// ---------------------------------------------------------------------------------------------------------------

test('T-P18 §4.5: 31a escrita na hora recusa; 11a tentativa de geocodificacao recusa antes da chamada paga', async () => {
  await tx(async () => {
    const user = await perfil();
    for (let i = 0; i < 30; i += 1) {
      const r = await client.query(SQL_SVC_SAVE, [user, '[]', iso(T0), chaveGravacao(user)]);
      assert.equal(r.rows[0].out_status, 'unchanged', `escrita ${i + 1} aceita`);
    }
    const trintaPrimeira = await client.query(SQL_SVC_SAVE, [user, '[]', iso(T0), chaveGravacao(user)]);
    assert.equal(trintaPrimeira.rows[0].out_status, 'limite_escrita');
  });

  await tx(async () => {
    const { user } = await comBase(10);
    for (let i = 0; i < 10; i += 1) {
      const r = await client.query(SQL_PRECHECK, [user, chaveGravacao(user), chaveGeo(user), true, iso(T0)]);
      assert.equal(r.rows[0].out_status, 'ok', `tentativa ${i + 1} aceita`);
      assert.equal(r.rows[0].out_calls_cap, 40, 'teto vitalicio padrao por profissional');
    }
    const onze = await client.query(SQL_PRECHECK, [user, chaveGravacao(user), chaveGeo(user), true, iso(T0)]);
    assert.equal(onze.rows[0].out_status, 'limite_tentativas');
  });

  await tx(async () => {
    const { user } = await comBase(10);
    const sem = await client.query(SQL_PRECHECK, [user, chaveGravacao(user), chaveGeo(user), false, iso(T0)]);
    assert.equal(sem.rows[0].out_status, 'ok', 'sem geocodificacao nao consome a cota de tentativas');
    await client.query("update ops.app_config set value = jsonb_set(value, '{change_max}', '1'::jsonb) where key = 'profile.offering_limits'");
    assert.equal((await areaSalvar(user, { raio: 11, agora: T0 + HORA })).out_status, 'alterada');
    const pre = await client.query(SQL_PRECHECK, [user, chaveGravacao(user), chaveGeo(user), true, iso(T0 + 2 * HORA)]);
    assert.equal(pre.rows[0].out_status, 'limite_mudanca', 'precheck recusa antes de qualquer chamada paga');
  });

  await tx(async () => {
    const user = await perfil('suspensa');
    const r = await client.query(SQL_PRECHECK, [user, chaveGravacao(user), chaveGeo(user), true, iso(T0)]);
    assert.equal(r.rows[0].out_status, 'suspenso');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Migracao e reversibilidade (T-P20)
// ---------------------------------------------------------------------------------------------------------------

test('T-P20 migracao aplicada duas vezes e rollback: recusa com dados e remove sem dados; catalogo intacto', async () => {
  const sqlMig = readFileSync(MIG, 'utf8');
  const sqlAudit = readFileSync(MIG_AUDIT, 'utf8');
  const sqlAuditFix = readFileSync(MIG_AUDIT_FIX, 'utf8');
  const sqlDown = readFileSync(DOWN, 'utf8').replace(/^\s*begin\s*;\s*$/gim, '').replace(/^\s*commit\s*;\s*$/gim, '');

  await tx(async () => {
    await client.query(sqlMig);
    await client.query(sqlMig);
    await client.query(sqlAudit);
    await client.query(sqlAuditFix);
    assert.equal((await client.query("select to_regclass('app.professional_service') as t")).rows[0].t !== null, true);

    const user = await perfil();
    const p = await ponto(user);
    assert.equal((await areaSalvar(user, { point: p, label: ROTULO, raio: 10 })).out_status, 'definida');

    const comDados = await erroDe(sqlDown);
    assert.match(comDados?.message ?? '', /rollback_recusado_com_dados/);
  });

  await tx(async () => {
    await client.query(sqlDown);
    assert.equal((await client.query("select to_regclass('app.professional_area') as t")).rows[0].t, null, 'tabela removida');
    assert.equal((await client.query("select to_regclass('app.geocode_point') as t")).rows[0].t !== null, true, 'geocode_point intacta');
    assert.equal((await client.query("select to_regclass('audit.audit_event') as t")).rows[0].t !== null, true, 'auditoria intacta');
    await client.query(sqlMig);
    assert.equal((await client.query("select to_regclass('app.professional_area') as t")).rows[0].t !== null, true, 'reaplicada');
  });
});
