// H-036 | Adaptador Pg da GeoPointStorePort contra Postgres real (docs/factory/99-DESENHO-H036.md, §5 passos 3 a 7,
// §7; T-P06 e T-P07; CA-05, CA-06). Usa o adaptador compilado (dist); a sequencia de ensurePermanentPoint e espelhada
// aqui porque packages/* nao importa apps/* (check:boundaries). Pendencia: o teste com a funcao real fica em apps/api.
// Provedor SIMULADO com contador de chamadas: nenhuma chamada real ao Mapbox (decisao 116). Sem rede.
// Transacoes: os casos sem erro SQL rodam em begin/rollback (nada persiste). O caso de ponto recusado pelo banco
// precisa de autocommit (um erro SQL aborta a transacao e a liberacao da reserva falharia); ele cria uma fixture
// commitada e a remove no fim (purge + apagar perfil e usuario), com marcador h036-.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/professional-offering-pg.dbtest.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from '../scripts/lib/env.mjs';
import { PgGeoPointStore, GEO_STORE_FALHOU } from '../dist/geo-point-store.js';

/**
 * Espelho da sequencia de ensurePermanentPoint (apps/api/src/geo/permanent-geocode-service.ts, §3.1 a §3.4).
 * A funcao real NAO e importada aqui: packages/* nao pode importar apps/* (scripts/check-module-boundaries.mjs).
 * A sequencia e a mesma (reserva atomica no banco, uma chamada, liberacao no erro, sem coordenada parcial);
 * a ordem de decisao em memoria e coberta por apps/api/tests/geo-permanent-service.test.ts.
 */
async function ensurePermanentPoint({ subject, addressText, callsCap }, deps) {
  const reserva = await deps.store.reserve({
    subject,
    hash: deps.hashAddress(addressText.toLowerCase()),
    nowMs: deps.clock(),
    leaseMs: 60000,
    callsCap,
    caps: deps.caps,
  });
  switch (reserva.acao) {
    case 'reutilizar':
      return { status: 'ok', pointId: reserva.pointId };
    case 'chamar': {
      const lookup = await deps.provider.geocode(addressText);
      if (lookup.status === 'falha') {
        await deps.store.release(reserva.ref);
        return { status: 'indisponivel' };
      }
      if (lookup.status === 'sem_resultado') {
        await deps.store.markNoResult(reserva.ref);
        return { status: 'endereco_nao_encontrado' };
      }
      const pointId = await deps.store.storePermanent(reserva.ref, lookup.point, deps.clock());
      return { status: 'ok', pointId };
    }
    case 'em_andamento':
      return { status: 'em_andamento' };
    case 'teto':
      return { status: 'teto' };
    case 'sem_resultado':
      return { status: 'endereco_nao_encontrado' };
    case 'breaker':
      return { status: 'aguardando_geocodificacao' };
    default:
      throw new Error('geo_acao_desconhecida');
  }
}

const client = await connect();
after(async () => {
  await client?.end();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
/** HMAC simulado do texto normalizado (a API usa HMAC com segredo; aqui o efeito e o mesmo: chave por endereco). */
const hashAddress = (key) => sha(`h036-${key}`);
// Limites altos: o teste nao deve cair no breaker por causa da cota real do mes no DEV.
const CAPS = { soft: 1000000, hard: 2000000 };
const SP = { lon: -46.6333, lat: -23.5505, precision: 'endereco' };
const ENDERECO = 'Rua Sintetica h036, 100 - Centro';
const ROTULO = 'Rua Sintetica h036, 100 - Centro';
const SQL_AREA_SAVE =
  'select out_status, out_retry_after from private.professional_area_save($1::uuid, $2::uuid, $3::text, $4::integer, $5::timestamptz)';

/**
 * Provedor simulado com contador. `modo` descreve o desfecho de cada chamada: ponto, sem_resultado ou falha.
 * Nunca lanca (contrato de GeocodingPermanentPort). Nao guarda o texto consultado.
 */
function provedor(modo) {
  const p = {
    chamadas: 0,
    modo,
    async geocode() {
      p.chamadas += 1;
      return p.modo;
    },
  };
  return p;
}

function store(subjectKind = 'professional_base') {
  return new PgGeoPointStore({ client, subjectKind, clock: () => Date.now() });
}

function montarDeps(provider, { caps = CAPS, store: s = store() } = {}) {
  return { store: s, provider, hashAddress, caps, clock: () => Date.now() };
}

/** Transacao de teste: tudo desfeito no fim. */
async function tx(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

async function usuarioCommit() {
  const id = randomUUID();
  await client.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, 'ativo', now(), now())`,
    [id, `h036-${randomUUID()}@example.test`, randomUUID()],
  );
  await client.query(
    `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
     values ($1, 'aprovada', now(), now())`,
    [id],
  );
  return id;
}

/** Remove a fixture commitada: o purge apaga base, area, historico, servicos e linhas professional_base. */
async function limparCommit(user) {
  await client.query('select private.professional_offering_purge($1::uuid)', [user]);
  await client.query('delete from app.professional_profile where user_id = $1', [user]);
  await client.query('delete from app.app_user where id = $1', [user]);
}

async function cota() {
  const r = await client.query(
    "select coalesce(sum(used), 0)::int as n from ops.external_quota where service = 'mapbox_permanent' and period = 'mes'",
  );
  return r.rows[0].n;
}

async function contar(sql, params) {
  const r = await client.query(`select count(*)::int as n from (${sql}) q`, params);
  return r.rows[0].n;
}

const PONTOS_DO_ASSUNTO = `select id, state, geocode_mode, exact_point is not null as tem_ponto
  from app.geocode_point where subject_kind = 'professional_base' and subject_id = $1`;

async function retrato(user) {
  return {
    pontosComCoordenada: await contar(`${PONTOS_DO_ASSUNTO} and exact_point is not null`, [user]),
    reservados: await contar(`${PONTOS_DO_ASSUNTO} and state = 'reservado'`, [user]),
    areas: await contar('select 1 from app.professional_area where professional_id = $1', [user]),
    historico: await contar('select 1 from app.professional_area_history where professional_id = $1', [user]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// T-P06 | CA-05: uma chamada por base nova, coordenada so no ponto, rotulo na area, reuso sem custo
// ---------------------------------------------------------------------------------------------------------------

test('T-P06 CA-05: base nova = 1 chamada simulada, cota +1, coordenada so em geocode_point, reuso sem chamada', async () => {
  await tx(async () => {
    const user = await (async () => {
      const id = randomUUID();
      await client.query(
        `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
         values ($1, $2, $3, 'ativo', now(), now())`,
        [id, `h036-${randomUUID()}@example.test`, randomUUID()],
      );
      await client.query(
        `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
         values ($1, 'aprovada', now(), now())`,
        [id],
      );
      return id;
    })();

    const quotaAntes = await cota();
    const prov = provedor({ status: 'ponto', point: SP });
    const deps = montarDeps(prov);

    const primeiro = await ensurePermanentPoint({ subject: user, addressText: ENDERECO, callsCap: 40 }, deps);
    assert.equal(primeiro.status, 'ok', 'a base nova deve ter ponto');
    assert.equal(prov.chamadas, 1, 'uma unica chamada ao provedor simulado');

    const orcamento = await client.query(
      "select calls from app.geocode_budget where subject_kind = 'professional_base' and subject_id = $1",
      [user],
    );
    assert.equal(orcamento.rows[0].calls, 1, 'orcamento do profissional contou a chamada');
    assert.equal(await cota(), quotaAntes + 1, 'cota mensal do Mapbox subiu em 1 (simulada, sem rede)');

    // Coordenada so no ponto permanente; nenhuma coluna de coordenada na area ou no historico (catalogo).
    const ponto = await client.query(`${PONTOS_DO_ASSUNTO}`, [user]);
    assert.equal(ponto.rows.length, 1);
    assert.equal(ponto.rows[0].state, 'ok');
    assert.equal(ponto.rows[0].geocode_mode, 'permanent');
    assert.equal(ponto.rows[0].tem_ponto, true);
    const colunasDeCoordenada = await contar(
      `select column_name from information_schema.columns
        where table_schema = 'app' and table_name in ('professional_area', 'professional_area_history')
          and column_name ~* '^(lat|lon|latitude|longitude|geom|geometry|coord|coordinates|point|exact_point)$'`,
      [],
    );
    assert.equal(colunasDeCoordenada, 0, 'area e historico nao tem coluna de coordenada');

    // Rotulo gravado em base_label pela funcao de area (ponto e rotulo chegam juntos).
    const salvo = await client.query(SQL_AREA_SAVE, [user, primeiro.pointId, ROTULO, 10, new Date().toISOString()]);
    assert.equal(salvo.rows[0].out_status, 'definida');
    const area = await client.query('select base_label, radius_m, geocode_point_id from app.professional_area where professional_id = $1', [user]);
    assert.equal(area.rows[0].base_label, ROTULO);
    assert.equal(area.rows[0].radius_m, 10000);
    assert.equal(area.rows[0].geocode_point_id, primeiro.pointId);

    // Ponto temporario nunca existe (CHECK so aceita permanent ou nulo).
    assert.equal(
      await contar(`select 1 from app.geocode_point where subject_id = $1 and geocode_mode is not null and geocode_mode <> 'permanent'`, [user]),
      0,
    );

    // Mesmo endereco de novo: reutiliza o ponto, sem chamada nova e sem custo na cota.
    const quotaDepois = await cota();
    const segundo = await ensurePermanentPoint({ subject: user, addressText: ENDERECO, callsCap: 40 }, deps);
    assert.equal(segundo.status, 'ok');
    assert.equal(segundo.pointId, primeiro.pointId, 'reutiliza o mesmo ponto');
    assert.equal(prov.chamadas, 1, 'nenhuma chamada nova para o mesmo endereco');
    assert.equal(await cota(), quotaDepois, 'reuso nao gasta cota');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T-P07 | CA-06: falhas do provedor e do armazenamento nao deixam coordenada parcial nem reserva presa
// ---------------------------------------------------------------------------------------------------------------

/** Falha de provedor e teto: nada e gravado, a reserva some e a area/historico seguem como antes. */
const CASOS_SEM_ERRO_SQL = [
  { nome: 'sem resultado', modo: { status: 'sem_resultado' }, esperado: 'endereco_nao_encontrado', ponto: 'sem_resultado' },
  { nome: 'tempo esgotado', modo: { status: 'falha', code: 'provider_timeout' }, esperado: 'indisponivel' },
  { nome: 'erro 5xx', modo: { status: 'falha', code: 'provider_5xx' }, esperado: 'indisponivel' },
  { nome: 'limite 429', modo: { status: 'falha', code: 'provider_429' }, esperado: 'indisponivel' },
  { nome: 'forma inesperada', modo: { status: 'falha', code: 'provider_shape' }, esperado: 'indisponivel' },
  { nome: 'chave recusada', modo: { status: 'falha', code: 'provider_auth' }, esperado: 'indisponivel' },
];

for (const caso of CASOS_SEM_ERRO_SQL) {
  test(`T-P07 CA-06 (${caso.nome}): desfecho fixo, sem coordenada nova, reserva liberada, area intacta`, async () => {
    await tx(async () => {
      const user = randomUUID();
      await client.query(
        `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
         values ($1, $2, $3, 'ativo', now(), now())`,
        [user, `h036-${randomUUID()}@example.test`, randomUUID()],
      );
      await client.query(
        `insert into app.professional_profile (user_id, verification_status, created_at, updated_at)
         values ($1, 'aprovada', now(), now())`,
        [user],
      );
      const antes = await retrato(user);
      const prov = provedor(caso.modo);

      const out = await ensurePermanentPoint(
        { subject: user, addressText: `Rua h036 ${caso.nome}, 1 - Centro`, callsCap: 40 },
        montarDeps(prov),
      );
      assert.equal(out.status, caso.esperado);
      assert.equal(prov.chamadas, 1, 'uma unica tentativa, sem retentativa (CA-05)');
      assert.equal(Object.prototype.hasOwnProperty.call(out, 'lat'), false, 'desfecho sem coordenada');
      assert.equal(Object.prototype.hasOwnProperty.call(out, 'lon'), false, 'desfecho sem coordenada');

      const depois = await retrato(user);
      assert.equal(depois.pontosComCoordenada, antes.pontosComCoordenada, 'nenhuma exact_point nova');
      assert.equal(depois.reservados, 0, 'reserva liberada ou marcada, nao presa em reservado');
      assert.deepEqual({ areas: depois.areas, historico: depois.historico }, { areas: 0, historico: 0 }, 'sem base continua sem base');
      if (caso.ponto) {
        const estado = await client.query(`${PONTOS_DO_ASSUNTO} and state = $2`, [user, caso.ponto]);
        assert.equal(estado.rows.length, 1, `ponto marcado como ${caso.ponto}`);
      }
    });
  });
}

test('T-P07 CA-06: teto de chamadas recusa antes do provedor (contador zero) e sem linha nova', async () => {
  await tx(async () => {
    const user = randomUUID();
    await client.query(
      `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
       values ($1, $2, $3, 'ativo', now(), now())`,
      [user, `h036-${randomUUID()}@example.test`, randomUUID()],
    );
    const prov = provedor({ status: 'ponto', point: SP });
    const out = await ensurePermanentPoint({ subject: user, addressText: ENDERECO, callsCap: 0 }, montarDeps(prov));
    assert.equal(out.status, 'teto');
    assert.equal(prov.chamadas, 0, 'o teto recusa antes de qualquer chamada paga');
    assert.equal(await contar(PONTOS_DO_ASSUNTO, [user]), 0, 'nenhuma linha de ponto criada');
  });
});

test('T-P07 CA-06: ponto recusado pelo banco na gravacao libera a reserva e devolve erro fixo, sem detalhe', async () => {
  // Autocommit de proposito: o erro SQL da gravacao aborta uma transacao; a liberacao depende de nao estar em tx.
  const user = await usuarioCommit();
  try {
    const antes = await retrato(user);
    // Fora da caixa do Brasil (Londres): o CHECK de app.geocode_point recusa a gravacao.
    const prov = provedor({ status: 'ponto', point: { lon: -0.1276, lat: 51.5072, precision: 'endereco' } });
    let erro = null;
    try {
      await ensurePermanentPoint({ subject: user, addressText: ENDERECO, callsCap: 40 }, montarDeps(prov));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro, 'o armazenamento recusado propaga para a rota');
    assert.equal(erro.message, GEO_STORE_FALHOU, 'texto fixo, sem detalhe do banco');
    assert.equal(prov.chamadas, 1);

    const depois = await retrato(user);
    assert.equal(depois.pontosComCoordenada, antes.pontosComCoordenada, 'nenhuma coordenada parcial gravada');
    assert.equal(depois.reservados, 0, 'reserva liberada pelo adaptador (sem prender 60 s)');
    assert.equal(depois.areas, 0);
    assert.equal(depois.historico, 0);
  } finally {
    await limparCommit(user);
  }
});
