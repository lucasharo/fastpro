// H-025 (Issue #38, D-10) | Reversao da migracao 20261111440000_draft_create_request_draft (docs/factory/74-DESENHO-H025.md §2, §4 D-10).
// Aplica a migracao e executa o arquivo de desfazer DENTRO de uma transacao que termina em rollback, e compara
// o estado do banco (tabela, RLS, indices, funcoes, privilegios, corpo das funcoes, registro da versao e
// contagens) antes e depois. O arquivo de desfazer traz o proprio begin/commit: eles sao removidos aqui,
// porque um commit dentro da transacao do teste gravaria a reversao. Nada persiste no banco de desenvolvimento.
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

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

// Sanidade: o arquivo de desfazer so pode trazer begin/commit que o teste retirou; o restante e o original.
test('o arquivo de desfazer tem begin e commit proprios, que o teste retira antes de executar', () => {
  assert.match(DESFAZER_ORIGINAL, /^\s*begin\s*;/im);
  assert.match(DESFAZER_ORIGINAL, /^\s*commit\s*;/im);
  assert.doesNotMatch(DESFAZER, /^\s*(begin|commit)\s*;/im);
  assert.match(DESFAZER, /drop table if exists app\.request_draft/);
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

/** Transacao de teste: tudo que fizer e desfeito no fim, qualquer que seja o resultado. */
async function naTransacao(fn) {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

test('aplicar, desfazer e fazer rollback deixa o banco exatamente como estava (D-10)', async () => {
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

test('desfazer duas vezes nao falha e reaplicar apos desfazer volta ao estado aplicado (D-10 idempotencia)', async () => {
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
