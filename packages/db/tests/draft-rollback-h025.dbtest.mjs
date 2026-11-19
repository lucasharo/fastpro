// H-025 (Issue 38, D-10) | Reversao da migracao 20261111440000_draft_create_request_draft (docs/factory/74-DESENHO-H025.md §2, §4 D-10).
// Todos os testes rodam dentro de uma transacao que termina em rollback. O arquivo de desfazer traz o proprio
// begin/commit: eles sao removidos aqui, porque um commit dentro da transacao do teste gravaria a reversao.
// Protecao relacional: com dependentes posteriores (chaves estrangeiras e funcoes de outras migracoes), o
// desfazer tem de ser recusado com 2BP01; sem dependentes, o ciclo completo e executado. O unico skip e o
// ciclo destrutivo completo (T5), que traz o motivo e a lista de dependentes no proprio skip.
// Rodar sozinho: node --test --test-concurrency=1 packages/db/tests/draft-rollback-h025.dbtest.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, REPO_ROOT } from '../scripts/lib/env.mjs';
import { checksum } from '../scripts/lib/migrations.mjs';

const NOME = '20261111440000_draft_create_request_draft';
const VERSAO = '20261111440000';
const MIGRACAO = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', `${NOME}.sql`), 'utf8');
const DESFAZER_ORIGINAL = readFileSync(
  join(REPO_ROOT, 'supabase', 'rollbacks', `${NOME}.down.sql`),
  'utf8',
);
const DESFAZER = DESFAZER_ORIGINAL.split(/\r?\n/)
  .filter((linha) => !/^\s*(begin|commit)\s*;\s*$/i.test(linha))
  .join('\n');
const LINHA_DROP_TABELA = /^\s*drop table if exists app\.request_draft\s*;\s*$/i;
const DESFAZER_SEM_TABELA = DESFAZER.split(/\r?\n/)
  .filter((linha) => !LINHA_DROP_TABELA.test(linha))
  .join('\n');
const ERRO_DEPENDENCIA = '2BP01';

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

/** Estado observavel do banco que a migracao e a reversao podem alterar. Nunca grava nada. */
async function estado() {
  const { rows } = await client.query(`
    select jsonb_build_object(
      'tabela', to_regclass('app.request_draft')::text,
      'rls', (select jsonb_build_object('habilitada', c.relrowsecurity, 'forcada', c.relforcerowsecurity, 'acl', c.relacl::text)
                from pg_class c where c.oid = to_regclass('app.request_draft')),
      'indices', coalesce((select jsonb_agg(indexdef order by indexname) from pg_indexes
                            where schemaname = 'app' and tablename = 'request_draft'), '[]'::jsonb),
      'funcoes', coalesce((select jsonb_agg(jsonb_build_object(
                    'assinatura', p.oid::regprocedure::text,
                    'secdef', p.prosecdef,
                    'config', p.proconfig,
                    'acl', p.proacl::text,
                    'corpo', md5(pg_get_functiondef(p.oid)))
                  order by p.oid::regprocedure::text)
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private'
                    and p.proname in ('draft_get', 'draft_create', 'draft_patch', 'draft_discard')), '[]'::jsonb),
      'registro', coalesce((select jsonb_agg(to_jsonb(s) order by s.version)
                              from ops.schema_migration s), '[]'::jsonb),
      'servicos', (select count(*) from app.service)
    ) as estado`);
  const e = rows[0].estado;
  if (e.tabela !== null) {
    const {
      rows: [l],
    } = await client.query('select count(*)::int as n from app.request_draft');
    e.linhas = l.n;
  }
  return e;
}

/** Simula o registro do migrador (ops.schema_migration), so se a versao ainda nao estiver la. */
async function registrarSeFaltar() {
  const { rows } = await client.query('select 1 from ops.schema_migration where version = $1', [
    VERSAO,
  ]);
  if (rows.length === 0) {
    await client.query(
      'insert into ops.schema_migration (version, name, checksum) values ($1, $2, $3)',
      [VERSAO, NOME, checksum(MIGRACAO)],
    );
  }
}

/**
 * Objetos posteriores que dependem de app.request_draft, lidos do catalogo (somente leitura). Exclui os objetos
 * da propria tabela (constraints, indices, gatilhos) e as quatro funcoes de rascunho que a reversao remove.
 * Lista vazia se a tabela nao existir. Nunca usa nomes fixos de migracao: o banco decide.
 */
async function dependentesPosteriores() {
  const { rows } = await client.query(`
    with alvo as (
      select to_regclass('app.request_draft')::oid as rel
    )
    select distinct pg_describe_object(d.classid, d.objid, d.objsubid) as dependente
      from alvo
      join pg_class c on c.oid = alvo.rel
      join pg_depend d on d.deptype = 'n'
       and ((d.refclassid = 'pg_class'::regclass and d.refobjid = c.oid)
         or (d.refclassid = 'pg_type'::regclass and d.refobjid = c.reltype))
     where not (d.classid = 'pg_class'::regclass and d.objid = c.oid)
       and not (d.classid = 'pg_constraint'::regclass and exists (
              select 1 from pg_constraint k where k.oid = d.objid and k.conrelid = c.oid))
       and not (d.classid = 'pg_proc'::regclass and d.objid in (
              select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'private'
                 and p.proname in ('draft_get', 'draft_create', 'draft_patch', 'draft_discard')))
     order by 1`);
  return rows.map((r) => r.dependente);
}

/** Transacao de teste: tudo que fizer e desfeito no fim, qualquer que seja o resultado. */
async function naTransacao(fn) {
  await client.query('begin');
  try {
    await client.query("set local lock_timeout = '5s'");
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

// T1 estatico: o arquivo de desfazer e o original; a remocao da tabela nunca usa CASCADE (decisao 801).
test('T1 estatico: o arquivo de desfazer tem begin e commit proprios, remove a tabela sem CASCADE e tira a versao', () => {
  assert.match(DESFAZER_ORIGINAL, /^\s*begin\s*;/im);
  assert.match(DESFAZER_ORIGINAL, /^\s*commit\s*;/im);
  assert.doesNotMatch(DESFAZER, /^\s*(begin|commit)\s*;/im);
  assert.doesNotMatch(DESFAZER_ORIGINAL, /cascade/i, 'o desfazer nao usa CASCADE');
  assert.equal(
    DESFAZER.match(/drop table if exists app\.request_draft/g)?.length,
    1,
    'uma unica remocao da tabela',
  );
  assert.equal(
    DESFAZER.match(/drop function if exists private\.draft_/g)?.length,
    4,
    'quatro remocoes de funcao de rascunho',
  );
  assert.match(DESFAZER, /delete from ops\.schema_migration where version = '20261111440000'/);
});

// T2 idempotencia do UP (CA-147-02): aplicar a migracao duas vezes nao falha e nao muda o estado.
test('T2 idempotencia do UP: aplicar a migracao duas vezes nao falha e a segunda nao muda o estado', async () => {
  const antes = await estado();

  await naTransacao(async () => {
    await client.query(MIGRACAO);
    const primeira = await estado();
    await client.query(MIGRACAO);
    const segunda = await estado();

    assert.notEqual(segunda.tabela, null, 'a tabela existe apos a migracao');
    assert.equal(segunda.funcoes.length, 4, 'as quatro funcoes de rascunho existem');
    assert.deepEqual(segunda, primeira, 'a segunda aplicacao nao muda o estado');
  });

  const depois = await estado();
  assert.deepEqual(depois, antes, 'apos o rollback o estado e identico ao de antes');
});

// T3 protecao relacional (CA-147-03): com dependentes, o desfazer e recusado com 2BP01 e nada muda.
// Sem dependentes, o desfazer nao pode ser recusado. Nao ha skip aqui: a guarda e bidirecional.
test('T3 protecao relacional: com dependentes posteriores o desfazer e recusado com 2BP01; sem eles, nao e recusado', async (t) => {
  const dependentes = await dependentesPosteriores();
  t.diagnostic(`dependentes posteriores de app.request_draft: ${dependentes.length}`);
  for (const dep of dependentes) t.diagnostic(`  - ${dep}`);

  await naTransacao(async () => {
    await client.query(MIGRACAO);
    await registrarSeFaltar();
    const antes = await estado();
    assert.notEqual(antes.tabela, null, 'a tabela existe antes do desfazer');

    await client.query('savepoint t3');
    let erro = null;
    try {
      await client.query(DESFAZER);
    } catch (err) {
      erro = err;
    }

    if (dependentes.length > 0) {
      assert.notEqual(
        erro,
        null,
        'o desfazer passou com dependentes posteriores: a protecao relacional sumiu',
      );
      assert.equal(erro.code, ERRO_DEPENDENCIA, 'a recusa e por dependencia (2BP01)');
      await client.query('rollback to savepoint t3');
      const depois = await estado();
      assert.deepEqual(depois, antes, 'apos a recusa o estado segue identico ao de antes');
    } else {
      assert.equal(
        erro,
        null,
        `sem dependentes o desfazer deveria passar, mas falhou com ${erro?.code}`,
      );
    }
  });
});

// T4 desfazer parcial (decisao 2.1.4 do desenho): sem a remocao da tabela, as funcoes saem e o resto fica.
test('T4 desfazer parcial: sem a remocao da tabela, as quatro funcoes saem, a versao sai e a tabela e app.service ficam', async () => {
  await naTransacao(async () => {
    await client.query(MIGRACAO);
    await registrarSeFaltar();
    const aplicado = await estado();
    assert.notEqual(aplicado.tabela, null, 'a tabela existe antes do desfazer parcial');
    assert.equal(aplicado.funcoes.length, 4, 'as quatro funcoes existem antes do desfazer parcial');
    assert.equal(
      aplicado.registro.some((r) => r.version === VERSAO),
      true,
      'a versao consta no registro antes do desfazer parcial',
    );

    await client.query(DESFAZER_SEM_TABELA);
    const parcial = await estado();
    assert.deepEqual(parcial.funcoes, [], 'o desfazer parcial remove as quatro funcoes');
    assert.equal(
      parcial.registro.some((r) => r.version === VERSAO),
      false,
      'o desfazer parcial tira a versao do registro',
    );
    assert.equal(parcial.tabela, aplicado.tabela, 'a tabela continua existindo');
    assert.equal(parcial.linhas, aplicado.linhas, 'as linhas da tabela nao mudam');
    assert.equal(parcial.servicos, aplicado.servicos, 'o desfazer nao toca em app.service');
  });
});

// T5a ciclo completo condicional (CA-147-04/05): aplicar, desfazer e comparar com o estado de antes.
// Executa so sem dependentes posteriores; com dependentes, o skip traz o motivo e a lista.
test('T5a ciclo completo: aplicar, desfazer e fazer rollback deixa o banco exatamente como estava (D-10)', async (t) => {
  const dependentes = await dependentesPosteriores();
  if (dependentes.length > 0) {
    t.skip(
      `Ciclo completo de rollback de H-025 requer banco sem dependentes posteriores; encontrados ${dependentes.length}: ${dependentes.join('; ')}`,
    );
    return;
  }

  const antes = await estado();

  await naTransacao(async () => {
    await client.query(MIGRACAO);
    await registrarSeFaltar();
    const aplicado = await estado();
    assert.notEqual(aplicado.tabela, null, 'a migracao cria app.request_draft');
    assert.equal(aplicado.funcoes.length, 4, 'a migracao cria as quatro funcoes de rascunho');
    assert.equal(
      aplicado.registro.some((r) => r.version === VERSAO),
      true,
      'a versao consta no registro',
    );

    await client.query(DESFAZER);
    const desfeito = await estado();
    assert.equal(desfeito.tabela, null, 'a reversao remove a tabela');
    assert.deepEqual(desfeito.funcoes, [], 'a reversao remove as quatro funcoes');
    assert.equal(
      desfeito.registro.some((r) => r.version === VERSAO),
      false,
      'a reversao tira a versao do registro',
    );
    assert.equal(desfeito.servicos, aplicado.servicos, 'a reversao nao toca em app.service');
    assert.equal(
      desfeito.registro.length,
      aplicado.registro.length - 1,
      'so a versao da migracao sai do registro',
    );
  });

  const depois = await estado();
  assert.deepEqual(depois, antes, 'apos o rollback o estado e identico ao de antes');
});

// T5b ciclo completo condicional: desfazer duas vezes e reaplicar duas vezes volta ao estado aplicado.
test('T5b ciclo completo: desfazer duas vezes nao falha e reaplicar apos desfazer volta ao estado aplicado (D-10 idempotencia)', async (t) => {
  const dependentes = await dependentesPosteriores();
  if (dependentes.length > 0) {
    t.skip(
      `Ciclo completo de rollback de H-025 requer banco sem dependentes posteriores; encontrados ${dependentes.length}: ${dependentes.join('; ')}`,
    );
    return;
  }

  const antes = await estado();

  await naTransacao(async () => {
    await client.query(MIGRACAO);
    await registrarSeFaltar();
    const aplicado = await estado();

    await client.query(DESFAZER);
    await client.query(DESFAZER);
    await client.query(MIGRACAO);
    await client.query(MIGRACAO);
    await registrarSeFaltar();
    const reaplicado = await estado();
    assert.deepEqual(reaplicado.funcoes, aplicado.funcoes, 'reaplicar recria as mesmas funcoes');
    assert.equal(reaplicado.tabela, aplicado.tabela, 'reaplicar recria a tabela');
    assert.deepEqual(
      reaplicado.rls,
      aplicado.rls,
      'RLS e privilegios iguais aos da primeira aplicacao',
    );
    assert.deepEqual(
      reaplicado.indices,
      aplicado.indices,
      'indices iguais aos da primeira aplicacao',
    );
  });

  const depois = await estado();
  assert.deepEqual(depois, antes, 'apos o rollback o estado e identico ao de antes');
});
