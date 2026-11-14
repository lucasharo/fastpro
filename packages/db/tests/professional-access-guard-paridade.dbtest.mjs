// Issue 55 (H-042), parte A | Paridade da guarda com a #45 e a #36, e medicao de custo (docs/factory/142-DESENHO-H042.md, §9: T-07, T-08, T-13, T-14).
// Cada teste roda numa transacao e desfaz tudo (rollback). Dados sinteticos (@example.test). Sem rede, sem servico externo.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/professional-access-guard-paridade.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { concederAcessoVigente } from './fixtures/professional-access.mjs';

const AGORA = '2099-08-15T12:00:00.000Z';
const T = Date.parse(AGORA);
const DIA = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const MARCA = `h042p-${randomUUID().slice(0, 8)}`;
const SP = { lon: -46.6333, lat: -23.5505 };
const MANAUS = { lon: -60.02, lat: -3.12 };
const RAIO = 20000;
const M_POR_GRAU_LAT = 111195;
const norte = (p, km) => ({ lon: p.lon, lat: p.lat + (km * 1000) / M_POR_GRAU_LAT });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const SQL_ENTRADA =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_requests($1::uuid, $2::integer, $3::smallint, $4::integer, $5::uuid, $6::timestamptz)';
const SQL_SCAN =
  'select out_request_id, out_cursor_group, out_cursor_key from private.discover_scan($1::uuid, $2::float8, $3::float8, $4::integer, $5::integer, $6::smallint, $7::integer, $8::uuid, $9::timestamptz)';
const SQL_DETALHE = 'select * from private.request_detail_professional($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_FACHADA = 'select private.request_visibility_guard($1::uuid, $2::timestamptz) as ok';
const SQL_GUARDA = 'select private.professional_access_guard($1::uuid, $2::text, $3::timestamptz) as ok';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/**
 * Roda fn numa transacao sempre desfeita. Deadlock (40P01) com outra sessao do banco de desenvolvimento compartilhado
 * aborta a transacao: ela e refeita do zero (ate 3 tentativas). Qualquer outro erro sobe sem repeticao.
 */
async function emTransacao(fn) {
  for (let tentativa = 1; ; tentativa += 1) {
    await client.query('begin');
    let resultado;
    try {
      resultado = await fn();
    } catch (err) {
      await client.query('rollback');
      if (err?.code === '40P01' && tentativa < 3) continue;
      throw err;
    }
    await client.query('rollback');
    return resultado;
  }
}

// ---------------------------------------------------------------- Fixtures sinteticas (uma transacao por teste)

async function usuario(status = 'ativo', email = true) {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), status, email ? AGORA : null, AGORA],
  );
  return id;
}

async function criarAcesso(id, spec) {
  if (spec === 'trial') return concederAcessoVigente(client, id, AGORA);
  if (!spec) return undefined;
  await client.query(
    `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, source_payment_id, status)
     values ($1, $2, $3, $4, $5, $6, 'ativa')`,
    [id, randomUUID(), spec.tipo, iso(spec.inicio), iso(spec.fim), spec.tipo === 'paid' ? randomUUID() : null],
  );
  return undefined;
}

async function profissional({ verificacao = 'aprovada', status = 'ativo', email = true, acesso = 'trial' } = {}) {
  const id = await usuario(status, email);
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, $2, $3, $3, $3)`,
    [id, verificacao, AGORA],
  );
  await criarAcesso(id, acesso);
  return id;
}

async function ponto(tipo, sujeito, p) {
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

async function base(prof, p = SP, raio = RAIO) {
  const g = await ponto('professional_base', prof, p);
  await client.query(
    `insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
     values ($1, $2, 'Base sintetica', $3, $4, $4)`,
    [prof, g, raio, AGORA],
  );
}

async function servico(modalidade = 'presencial', regulado = false) {
  const grupo = randomUUID();
  const id = randomUUID();
  await client.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, $4, $5, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`, modalidade, regulado],
  );
  return id;
}

async function declara(prof, svc, modalidade) {
  await client.query(
    'insert into app.professional_service (professional_id, service_id, modality, declared_at) values ($1, $2, $3, $4)',
    [prof, svc, modalidade, AGORA],
  );
}

/** Rascunho sintetico de origem (o gatilho de insercao exige ponto do mesmo rascunho). */
async function rascunho(svc) {
  const id = randomUUID();
  const expira = iso(T + 7 * DIA);
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

/** Pedido publicado (prazo padrao: 168 h de admissao a partir de AGORA). Prazo negativo = pedido fechado. */
async function pedido({ svc, p = SP, status = 'publicado', prazo = '168 hours' }) {
  const cliente = await usuario();
  const rasc = await rascunho(svc);
  const g = await ponto('request', rasc, p);
  const r = await client.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     select $1::uuid, $2::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3::uuid, $4::uuid,
            d.dl - interval '168 hours', d.dl
       from (select $5::timestamptz + $6::interval as dl) d
     returning id`,
    [cliente, svc, g, rasc, AGORA, prazo],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await client.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return id;
}

// ---------------------------------------------------------------- Consultas

async function entrada(prof, limite = 50) {
  return client.query(SQL_ENTRADA, [prof, limite, null, null, null, AGORA]);
}

async function paginar(sql, argumentos) {
  const tudo = [];
  let apos = null;
  for (let i = 0; i < 200; i += 1) {
    const r = await client.query(sql, argumentos(apos));
    if (r.rows.length === 0) return tudo;
    tudo.push(...r.rows.map((x) => [x.out_request_id, x.out_cursor_group, x.out_cursor_key]));
    const u = r.rows.at(-1);
    apos = { group: u.out_cursor_group, key: u.out_cursor_key, id: u.out_request_id };
  }
  assert.fail('paginacao nao terminou em 200 paginas');
}

const paginasEntrada = (prof, limite) =>
  paginar(SQL_ENTRADA, (apos) => [prof, limite, apos?.group ?? null, apos?.key ?? null, apos?.id ?? null, AGORA]);

/** Origem que a entrada usa: o ponto de base na grade de casamento (match_lon/match_lat). Sem ela a chave de cursor difere. */
async function origemDaBase(prof) {
  const r = await client.query(
    `select g.match_lon as lon, g.match_lat as lat
       from app.professional_area pa
       join app.geocode_point g on g.id = pa.geocode_point_id
      where pa.professional_id = $1
        and g.subject_kind = 'professional_base'
        and g.state = 'ok'
        and g.match_grid_version = 1`,
    [prof],
  );
  assert.equal(r.rows.length, 1, 'base de casamento do profissional');
  return r.rows[0];
}

const paginasVarredura = async (prof, limite) => {
  const origem = await origemDaBase(prof);
  return paginar(SQL_SCAN, (apos) => [
    prof,
    origem.lon,
    origem.lat,
    RAIO,
    limite,
    apos?.group ?? null,
    apos?.key ?? null,
    apos?.id ?? null,
    AGORA,
  ]);
};

// ---------------------------------------------------------------- Paridade e sem vazamento (T-07, T-08, T-13, T-14)

test('T-07 descoberta sem vazamento: negado com pedidos que casariam devolve o mesmo que elegivel sem pedido no raio', async () => {
  await emTransacao(async () => {
    const svc = await servico('presencial');
    for (let i = 1; i <= 3; i += 1) await pedido({ svc, p: norte(SP, i) });
    const controle = await profissional();
    await base(controle, SP);
    await declara(controle, svc, 'presencial');
    const semPedido = await profissional();
    await base(semPedido, MANAUS);
    await declara(semPedido, svc, 'presencial');
    const referencia = await entrada(semPedido);
    assert.equal(referencia.rows.length, 0, 'referencia: elegivel sem pedido no raio');
    const casa = await entrada(controle);
    assert.equal(casa.rows.length, 3, 'controle: os pedidos casam para elegivel');
    const negados = [{ verificacao: 'suspensa' }, { acesso: null }, { email: false }];
    for (const spec of negados) {
      const id = await profissional(spec);
      await base(id, SP);
      await declara(id, svc, 'presencial');
      const r = await entrada(id);
      assert.equal(r.rows.length, 0, `negado ${JSON.stringify(spec)} sem linhas`);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        referencia.fields.map((f) => f.name),
        'mesma estrutura',
      );
    }
  });
});

test('T-08 detalhe uniforme: negado com pedido que casaria recebe o mesmo que pedido inexistente', async () => {
  await emTransacao(async () => {
    const svc = await servico('presencial');
    const pid = await pedido({ svc, p: norte(SP, 1) });
    const elegivel = await profissional();
    await base(elegivel, SP);
    await declara(elegivel, svc, 'presencial');
    const negado = await profissional({ verificacao: 'suspensa' });
    await base(negado, SP);
    await declara(negado, svc, 'presencial');
    const controle = await client.query(SQL_DETALHE, [elegivel, pid, AGORA]);
    assert.equal(controle.rows.length, 1, 'controle: elegivel ve o pedido');
    const negadoNoPedido = await client.query(SQL_DETALHE, [negado, pid, AGORA]);
    const negadoInexistente = await client.query(SQL_DETALHE, [negado, randomUUID(), AGORA]);
    assert.equal(negadoNoPedido.rows.length, 0);
    assert.equal(negadoInexistente.rows.length, 0);
    assert.deepEqual(negadoNoPedido.rows, negadoInexistente.rows);
    assert.deepEqual(
      negadoNoPedido.fields.map((f) => f.name),
      negadoInexistente.fields.map((f) => f.name),
    );
  });
});

test('T-13 paridade com a #45: fachada igual a guarda na matriz completa (6 verificacoes x conta x e-mail x 7 acessos)', async () => {
  await emTransacao(async () => {
    const verificacoes = ['pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'suspensa', 'aprovada'];
    // Modelo independente do SQL: so o acesso vigente no instante AGORA (fim exclusivo) e permitido.
    const acessos = [
      ['sem_acesso', null, false],
      ['trial_ativo', 'trial', true],
      ['trial_expirado', { tipo: 'trial', inicio: T - 20 * DIA, fim: T - 6 * DIA }, false],
      ['trial_fronteira_aberta', { tipo: 'trial', inicio: T + 1 - 14 * DIA, fim: T + 1 }, true],
      ['trial_fronteira_fechada', { tipo: 'trial', inicio: T - 14 * DIA, fim: T }, false],
      ['paga_ativa', { tipo: 'paid', inicio: T - DIA, fim: T + 29 * DIA }, true],
      ['paga_expirada', { tipo: 'paid', inicio: T - 40 * DIA, fim: T - 10 * DIA }, false],
    ];
    let combinacoes = 0;
    for (const v of verificacoes) {
      for (const status of ['ativo', 'bloqueado']) {
        for (const email of [true, false]) {
          for (const [nome, spec, permite] of acessos) {
            const id = await profissional({ verificacao: v, status, email, acesso: spec });
            const esperado = v === 'aprovada' && status === 'ativo' && email && permite;
            const fachada = (await client.query(SQL_FACHADA, [id, AGORA])).rows[0].ok;
            const guarda = (await client.query(SQL_GUARDA, [id, 'descoberta_aceite', AGORA])).rows[0].ok;
            const rotulo = `${v} ${status} email=${email} ${nome}`;
            assert.equal(fachada, guarda, `fachada = guarda: ${rotulo}`);
            assert.equal(guarda, esperado, `modelo: ${rotulo}`);
            combinacoes += 1;
          }
        }
      }
    }
    assert.equal(combinacoes, 6 * 2 * 2 * 7);
  });
});

test('T-13 paridade com a #36: 30 pedidos, request_detail e discover_requests veem o mesmo conjunto; negado ve nada', async () => {
  await emTransacao(async () => {
    const pres = await servico('presencial');
    const onl = await servico('online');
    const reg = await servico('online', true);
    const naoDeclarado = await servico('presencial');
    const prof = await profissional();
    await base(prof, SP, RAIO);
    await declara(prof, pres, 'presencial');
    await declara(prof, onl, 'online');
    await declara(prof, reg, 'online');
    const visiveis = [];
    for (let i = 1; i <= 10; i += 1) visiveis.push(await pedido({ svc: pres, p: norte(SP, i) }));
    for (let i = 1; i <= 5; i += 1) visiveis.push(await pedido({ svc: onl, p: i % 2 ? MANAUS : SP }));
    const fora = [];
    for (let i = 1; i <= 5; i += 1) fora.push(await pedido({ svc: pres, p: norte(SP, 30 + i) }));
    for (let i = 1; i <= 3; i += 1) fora.push(await pedido({ svc: reg, p: SP }));
    for (let i = 1; i <= 3; i += 1) fora.push(await pedido({ svc: pres, p: SP, prazo: '-1 hours' }));
    for (let i = 1; i <= 2; i += 1) fora.push(await pedido({ svc: pres, p: SP, status: 'selecionado' }));
    for (let i = 1; i <= 2; i += 1) fora.push(await pedido({ svc: naoDeclarado, p: SP }));
    const todos = [...visiveis, ...fora];
    assert.equal(todos.length, 30);

    const doBanco = new Set((await paginasEntrada(prof, 7)).map((x) => x[0]));
    const comDetalhe = new Set();
    for (const id of todos) {
      if ((await client.query(SQL_DETALHE, [prof, id, AGORA])).rows.length > 0) comDetalhe.add(id);
    }
    assert.deepEqual(comDetalhe, doBanco, 'mesmo conjunto');
    assert.deepEqual(doBanco, new Set(visiveis), 'conjunto esperado: 15 visiveis');

    const negado = await profissional({ verificacao: 'suspensa' });
    await base(negado, SP, RAIO);
    await declara(negado, pres, 'presencial');
    await declara(negado, onl, 'online');
    assert.equal((await entrada(negado)).rows.length, 0, 'negado: lista vazia');
    for (const id of todos) {
      assert.equal((await client.query(SQL_DETALHE, [negado, id, AGORA])).rows.length, 0, 'negado: detalhe vazio');
    }
  });
});

test('T-14 paridade com a #36 em paginas: discover_requests igual a discover_scan; negado devolve zero linhas', async () => {
  await emTransacao(async () => {
    const svc = await servico('presencial');
    for (let i = 1; i <= 24; i += 1) await pedido({ svc, p: norte(SP, i) });
    const prof = await profissional();
    await base(prof, SP, RAIO);
    await declara(prof, svc, 'presencial');
    const varredura = await paginasVarredura(prof, 4);
    assert.ok(varredura.length > 0, 'a varredura devolve pedidos');
    for (const limite of [1, 4, 7, 50]) {
      const entradaPaginas = await paginasEntrada(prof, limite);
      const varreduraPaginas = await paginasVarredura(prof, limite);
      assert.deepEqual(entradaPaginas, varreduraPaginas, `paginas de ${limite}: mesmos ids, ordem e cursores`);
    }
    const negado = await profissional({ verificacao: 'suspensa' });
    await base(negado, SP, RAIO);
    await declara(negado, svc, 'presencial');
    assert.equal((await entrada(negado, 50)).rows.length, 0, 'guarda negada: zero linhas');
    assert.deepEqual(await paginasVarredura(negado, 4), varredura, 'discover_scan nao muda: a guarda e a unica diferenca');
  });
});

// ---------------------------------------------------------------- Custo (T-custo, sem exigir tempo; plano registrado como diagnostico)

test('medicao de custo: 1.000 pedidos em transacao desfeita; a entrada devolve a pagina pedida', async (t) => {
  await emTransacao(async () => {
    const svc = await servico('presencial');
    const prof = await profissional();
    await base(prof, SP, RAIO);
    await declara(prof, svc, 'presencial');
    const lote = `${MARCA}-lote`;
    const ponto1000 = `'${AGORA}'::timestamptz`;
    // Carga em um unico bloco (uma ida ao banco): 1.000 clientes, 1.000 rascunhos e 1.000 pedidos publicados em SP.
    await client.query(`
      do $$
      declare
        i integer;
        cli uuid;
        rasc uuid;
        g uuid;
      begin
        for i in 1..1000 loop
          cli := gen_random_uuid();
          rasc := gen_random_uuid();
          insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
            values (cli, '${lote}-' || i || '@example.test', gen_random_uuid(), 'ativo', ${ponto1000}, ${ponto1000});
          insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                         expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                         email_verified_at, confirmed_at)
            values (rasc, md5(rasc::text) || md5('n' || rasc::text), '${svc}'::uuid, 'Rua sintetica 1', 'imediato',
                    'Descricao sintetica', 'aberto', ${ponto1000} + interval '7 days', md5('ip') || md5('ip2'),
                    ${ponto1000}, ${ponto1000}, 'Ana', '${lote}-d-' || i || '@example.test',
                    md5('e' || i) || md5('f' || i), ${ponto1000}, ${ponto1000});
          insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
            values ('request', rasc, md5('g' || i) || md5('h' || i), 'ok',
                    extensions.st_setsrid(extensions.st_makepoint(${SP.lon}, ${SP.lat}), 4326)::extensions.geography,
                    'permanent', 'endereco', ${ponto1000})
            returning id into g;
          insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                           geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
            values (cli, '${svc}'::uuid, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', g, rasc,
                    ${ponto1000}, ${ponto1000} + interval '168 hours');
        end loop;
      end
      $$;
    `);
    const plano = await client.query(
      `explain (analyze, costs off, summary on)
         select out_request_id from private.discover_requests($1::uuid, 50, null, null, null, ${ponto1000})`,
      [prof],
    );
    const linhas = plano.rows.map((r) => r['QUERY PLAN']);
    t.diagnostic(`plano (1.000 pedidos, pagina de 50):\n${linhas.join('\n')}`);
    const pagina = await client.query(
      'select count(*)::int as n from private.discover_requests($1::uuid, 50, null, null, null, $2::timestamptz)',
      [prof, AGORA],
    );
    assert.equal(pagina.rows[0].n, 50, 'a pagina devolve o limite pedido');
  });
});
