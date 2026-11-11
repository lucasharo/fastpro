// Testes de banco da busca de servico (H-019, desenho 64-DESENHO-H019 §5.2): T-H019-09 a 16.
// Rodam no banco de desenvolvimento COMPARTILHADO: cada caso roda dentro de transacao com ROLLBACK
// (nunca COMMIT). A semente e aplicada DENTRO da transacao (nunca por db:seed:catalog).
// Executar: node --test --test-concurrency=1 packages/db/tests/catalog-search.dbtest.mjs (exige a migracao 20261111350000).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '../scripts/lib/env.mjs';

const SEED = JSON.parse(
  readFileSync(new URL('../../../supabase/seed/catalog/catalog.v1.json', import.meta.url), 'utf8'),
);
const COLUMNS = [
  'group_id',
  'group_name',
  'group_position',
  'service_id',
  'service_name',
  'modality',
  'regulated',
];

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// --- Utilitarios ------------------------------------------------------------------------------------

/** Executa fn dentro de transacao que sempre termina em ROLLBACK. */
async function inTx(fn) {
  await client.query('begin');
  try {
    // Concessao valida so dentro da transacao (desfeita pelo rollback): permite SET LOCAL ROLE.
    await client.query('grant app_system, app_api to current_user');
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Exige que o comando falhe com o SQLSTATE indicado; a transacao segue viva (savepoint). */
async function expectError(sql, params, code) {
  await client.query('savepoint sp_expect');
  let err = null;
  try {
    await client.query(sql, params);
  } catch (e) {
    err = e;
  }
  if (err) await client.query('rollback to savepoint sp_expect');
  else await client.query('release savepoint sp_expect');
  assert.ok(err, `deveria falhar com ${code}`);
  assert.equal(err.code, code, `codigo inesperado (${err.code}): ${err.message}`);
}

/** Aplica a semente versionada dentro da transacao (papel app_system); volta ao dono ao final. */
async function semente() {
  await client.query('set local role app_system');
  const res = await client.query('select private.catalog_seed_apply($1::jsonb) as r', [
    JSON.stringify(SEED),
  ]);
  await client.query('reset role');
  assert.equal(res.rows[0].r.status, 'aplicada');
}

/** Chama a busca como o visitante anonimo (papel app_api, principal anonymous). Nao cria nada. */
async function buscar(term) {
  await client.query('set local role app_api');
  await client.query(`select set_config('app.principal_type', 'anonymous', true)`);
  const res = await client.query('select * from private.catalog_search($1)', [term]);
  await client.query('reset role');
  return res.rows;
}

async function criarGrupo(name, position, active = true) {
  const id = randomUUID();
  await client.query(
    'insert into app.service_group (id, name, position, active) values ($1, $2, $3, $4)',
    [id, name, position, active],
  );
  return id;
}

/** Cria servico (com sinonimos [{ term, active }]) como dono da transacao. */
async function criarServico(groupId, name, { active = true, synonyms = [] } = {}) {
  const id = randomUUID();
  await client.query(
    `insert into app.service (id, group_id, name, modality, regulated, active, council_body, moderation_sensitive)
     values ($1, $2, $3, 'online', false, $4, null, false)`,
    [id, groupId, name, active],
  );
  for (const s of synonyms) {
    await client.query(
      'insert into app.service_synonym (service_id, term, active) values ($1, $2, $3)',
      [id, s.term, s.active ?? true],
    );
  }
  return id;
}

/** Catalogo de teste (grupos de posicao 990 a 992, termo "kfw" sem colisao com a semente). */
async function criarCatalogoTeste() {
  const gA = await criarGrupo('Grupo kfw A', 990);
  const gB = await criarGrupo('Grupo kfw B', 991);
  await criarServico(gA, 'Kfw', { synonyms: [{ term: 'kfw teste' }, { term: 'kfw extra' }] });
  await criarServico(gA, 'Kfw telhado');
  await criarServico(gB, 'Kfw alfa');
  await criarServico(gA, 'Obra de kfw');
  await criarServico(gA, 'Ajuste xkfwy');
  for (let i = 1; i <= 4; i += 1) await criarServico(gA, `Ajuste xkfwy ${i}`);
  await criarServico(gA, 'Servico Comum', { synonyms: [{ term: 'kfw sinonimo' }] });
  await criarServico(gA, 'Servico Outro', { synonyms: [{ term: 'trabalho de kfw' }] });
  await criarServico(gA, 'Servico Sete', { synonyms: [{ term: 'xkfw' }] });
  return { gA, gB };
}

async function contagens() {
  const r = await client.query(
    `select (select count(*) from app.service)::int as servicos,
            (select count(*) from app.service_group)::int as grupos,
            (select count(*) from app.service_synonym)::int as sinonimos,
            (select count(*) from app.catalog_revision)::int as revisoes,
            (select count(*) from audit.audit_event)::int as auditoria`,
  );
  return r.rows[0];
}

const nomes = (rows) => rows.map((r) => r.service_name);

// --- T-H019-09 (CA-01): sem acento e sem caixa --------------------------------------------------------

test('T-H019-09 (CA-01) sem acento e sem caixa: "PROJETO ARQUITETONICO" acha "Projeto arquitetonico"; "ampliacao" e "AMPLIACAO" acham "Ampliacao / puxadinho"', () =>
  inTx(async () => {
    await semente();
    // A semente deixa "Projeto arquitetonico" inativo (conselho CAU, 53 §4.1). Ativo so nesta transacao (rollback).
    await client.query(
      "update app.service set active = true where name_norm = 'projeto arquitetonico'",
    );

    const proj = await buscar('PROJETO ARQUITETONICO');
    assert.ok(
      nomes(proj).includes('Projeto arquitetônico'),
      'deve achar o projeto sem acento e em maiusculas',
    );

    const ampl1 = await buscar('ampliacao');
    assert.ok(nomes(ampl1).includes('Ampliação / puxadinho'));
    const ampl2 = await buscar('AMPLIAÇÃO');
    assert.ok(nomes(ampl2).includes('Ampliação / puxadinho'));
  }));

// --- T-H019-10 (CA-03): ordem, limite de 10, sem repetir -------------------------------------------

test('T-H019-10 (CA-03) ordem: inicio antes de meio de palavra; nome antes de sinonimo; empate por grupo; no maximo 10; servico uma vez', () =>
  inTx(async () => {
    await semente();
    // Exemplo do PO: "pedr" lista "Pedreiro" antes de "Servente de pedreiro".
    const pedr = nomes(await buscar('pedr'));
    assert.ok(pedr.indexOf('Pedreiro') >= 0 && pedr.indexOf('Servente de pedreiro') >= 0);
    assert.ok(pedr.indexOf('Pedreiro') < pedr.indexOf('Servente de pedreiro'));
    // Meio de palavra: "reiro" acha "Pedreiro".
    assert.ok(nomes(await buscar('reiro')).includes('Pedreiro'));
    // Termo amplo: no maximo 10 e nunca vazio.
    const ar = await buscar('ar');
    assert.ok(ar.length > 0 && ar.length <= 10, `ar devolveu ${ar.length}`);

    // Catalogo de teste: ordem exata por relevancia (1 nome comeca; 2 palavra; 3 contem; 4/5/6 sinonimo).
    await criarCatalogoTeste();
    const rows = await buscar('kfw');
    assert.equal(rows.length, 10, 'no maximo 10 resultados');
    assert.deepEqual(nomes(rows), [
      'Kfw',
      'Kfw telhado',
      'Kfw alfa', // mesmo ranking 1, grupo de posicao 991 depois do 990
      'Obra de kfw', // 2: palavra comeca com o termo
      'Ajuste xkfwy', // 3: nome contem
      'Ajuste xkfwy 1',
      'Ajuste xkfwy 2',
      'Ajuste xkfwy 3',
      'Ajuste xkfwy 4',
      'Servico Comum', // 4: sinonimo comeca; "Servico Outro" (5) e "Servico Sete" (6) ficam fora do limite
    ]);
    // Servico que casa por nome e por sinonimos aparece uma vez so.
    const ids = rows.map((r) => r.service_id);
    assert.equal(new Set(ids).size, ids.length, 'nenhum servico repetido');
  }));

// --- T-H019-11 (CA-04): sinonimo encontra o servico, sem o sinonimo na linha ------------------------

test('T-H019-11 (CA-04) sinonimo: "empreiteiro" e "empreit" acham "Construcao de casa" com seu grupo; a linha so tem os 7 campos', () =>
  inTx(async () => {
    await semente();
    for (const term of ['empreiteiro', 'empreit']) {
      const rows = await buscar(term);
      const hit = rows.find((r) => r.service_name === 'Construção de casa');
      assert.ok(hit, `"${term}" deve achar Construcao de casa`);
      assert.equal(hit.group_name, 'Reformas e construção');
      assert.deepEqual(Object.keys(hit).sort(), [...COLUMNS].sort(), 'so os 7 campos publicos');
      assert.ok(
        !Object.values(hit).some((v) => String(v).toLowerCase().includes(term)),
        'o sinonimo que casou nao sai',
      );
    }
  }));

// --- T-H019-12 (CA-05): nada inativo aparece -------------------------------------------------------

test('T-H019-12 (CA-05) inativos: servico inativo (nome ou sinonimo), sinonimo inativo, grupo inativo e conselho inativo nunca aparecem', () =>
  inTx(async () => {
    await semente();
    const g = await criarGrupo('Grupo kfw C', 992, true);
    const gInativo = await criarGrupo('Grupo kfw D', 993, false);
    await criarServico(g, 'Zz inativo kfwq', { active: false, synonyms: [{ term: 'kfwq sin' }] });
    await criarServico(g, 'Zz ativo kfwr', { synonyms: [{ term: 'kfwr2', active: false }] });
    await criarServico(gInativo, 'Zz grupo kfwt', { synonyms: [{ term: 'kfwt sin' }] });

    assert.deepEqual(await buscar('kfwq'), [], 'servico inativo nao aparece pelo nome');
    assert.deepEqual(await buscar('kfwq sin'), [], 'servico inativo nao aparece pelo sinonimo');
    assert.deepEqual(await buscar('kfwr2'), [], 'so sinonimo inativo nao faz o servico aparecer');
    assert.ok(
      nomes(await buscar('zz ativo')).includes('Zz ativo kfwr'),
      'nome ativo continua valendo',
    );
    assert.deepEqual(await buscar('kfwt'), [], 'grupo inativo esconde seus servicos');
    assert.deepEqual(await buscar('kfwt sin'), [], 'grupo inativo esconde pelo sinonimo tambem');

    // Conselho profissional inativo da semente (CAU, 53 §4.1): nem pelo nome, nem pelo sinonimo.
    assert.deepEqual(
      await buscar('arquiteto'),
      [],
      'sinonimo do item de conselho inativo nao aparece',
    );
    assert.ok(!nomes(await buscar('planta de casa')).includes('Projeto arquitetônico'));
  }));

// --- T-H019-13: entradas degeneradas ------------------------------------------------------------------

test('T-H019-13 entradas: null, vazio, 1 caractere, so pontuacao e curingas ⇒ vazio sem erro (nao viram padrao); 200 caracteres ⇒ vazio', () =>
  inTx(async () => {
    await semente();
    for (const t of [null, '', ' ', 'a', ' a ', '%', '%%', '_', '\\', '--', "'", '""', '%_']) {
      assert.deepEqual(await buscar(t), [], `entrada ${JSON.stringify(t)} deve dar conjunto vazio`);
    }
    assert.deepEqual(await buscar('x'.repeat(200)), []);
  }));

// --- T-H019-14: privilegios --------------------------------------------------------------------------

test('T-H019-14 privilegio: app_api (anonimo) executa; anon/authenticated/PUBLIC sem EXECUTE; tabelas negadas a app_api; nenhuma escrita pela busca', () =>
  inTx(async () => {
    await semente();
    const antes = await contagens();

    const rows = await buscar('pedr');
    assert.ok(rows.length > 0, 'app_api como anonimo executa a busca');

    await client.query('set local role app_api');
    await expectError('select term from app.service_synonym', [], '42501');
    await expectError('select id from app.service', [], '42501');
    await client.query('reset role');

    const priv = await client.query(
      `select has_function_privilege('anon', 'private.catalog_search(text)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'private.catalog_search(text)', 'EXECUTE') as auth,
              has_function_privilege('app_api', 'private.catalog_search(text)', 'EXECUTE') as api,
              exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = 'private.catalog_search(text)'::regprocedure
                         and a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico`,
    );
    assert.deepEqual(priv.rows[0], { anon: false, auth: false, api: true, publico: false });

    assert.deepEqual(await contagens(), antes, 'a busca nao altera nenhuma tabela');
  }));

// --- T-H019-15: normalizacao no banco ------------------------------------------------------------------

test('T-H019-15 normalizacao: termo em caixa e acento diferentes devolve o mesmo resultado', () =>
  inTx(async () => {
    await semente();
    assert.deepEqual(await buscar('AMPLIAÇÃO'), await buscar('ampliacao'));
    assert.deepEqual(await buscar('PEDR'), await buscar('pedr'));
    assert.deepEqual(await buscar('Construção'), await buscar('CONSTRUCAO'));
  }));

// --- T-H019-16: medicao (relatorio, nao aprovacao) ----------------------------------------------------

test('T-H019-16 medicao local: 200 buscas com a semente completa (2, 3 e 5+ letras; com e sem resultado); p50, p95 e maximo no relato', () =>
  inTx(async () => {
    await semente();
    const termos = [
      'pe',
      'ar',
      'pad',
      'obr',
      'pedr',
      'pedreiro',
      'empreiteiro',
      'ampliacao',
      'xyzw',
      'zzzzqq',
    ];
    await client.query('set local role app_api');
    await client.query(`select set_config('app.principal_type', 'anonymous', true)`);
    const tempos = [];
    let comResultado = 0;
    for (let i = 0; i < 200; i += 1) {
      const t = termos[i % termos.length];
      const t0 = process.hrtime.bigint();
      const res = await client.query('select * from private.catalog_search($1)', [t]);
      tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (res.rows.length > 0) comResultado += 1;
    }
    await client.query('reset role');
    tempos.sort((a, b) => a - b);
    const pct = (p) => tempos[Math.ceil(p * tempos.length) - 1];
    console.log(
      `T-H019-16 medicao (banco de desenvolvimento, transacao com rollback): n=${tempos.length} ` +
        `com_resultado=${comResultado} p50=${pct(0.5).toFixed(2)}ms p95=${pct(0.95).toFixed(2)}ms max=${pct(1).toFixed(2)}ms`,
    );
    assert.equal(tempos.length, 200);
  }));
