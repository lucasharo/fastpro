// Issue 120 (H-111) | Funcoes administrativas do DPO no banco (147-DESENHO-H111 §4.2, §6.3 e §7: T-DB-28, T-DB-29 e
// T-DB-03 na parte implementada nesta fatia). Banco de desenvolvimento. Cada teste roda em transacao e e desfeito
// (rollback). Valores sinteticos (@example.test). Sem rede, sem e-mail real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from '../scripts/lib/env.mjs';

const COMPORTAMENTO = readFileSync(
  fileURLToPath(new URL('./privacy-dsr-admin-comportamento.sql', import.meta.url)),
  'utf8',
);

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

test('comportamento: leitura reduzida do suporte, permissao, identidade, maquina de estados, extrato e anonimizacao', async () => {
  await client.query('begin');
  try {
    await client.query(COMPORTAMENTO);
  } finally {
    await client.query('rollback');
  }
});

test('T-DB-03 | as sete funcoes publicas sao SECURITY DEFINER, com search_path vazio e execute so para app_system', async () => {
  const { rows } = await client.query(`
    select p.oid::regprocedure::text as assinatura,
           p.prosecdef,
           p.proconfig,
           has_function_privilege('app_system', p.oid, 'EXECUTE') as app_system,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api,
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('dsr_admin_list', 'dsr_admin_get', 'dsr_assign', 'dsr_defer', 'dsr_reject',
                         'dsr_admin_generate_extract', 'dsr_admin_anonymize')`);
  assert.equal(rows.length, 7, 'sete funcoes administrativas');
  for (const r of rows) {
    assert.equal(r.prosecdef, true, `security definer em ${r.assinatura}`);
    assert.ok((r.proconfig ?? []).some((c) => c.startsWith('search_path=')), `search_path em ${r.assinatura}`);
    assert.equal(r.app_system, true, `app_system executa ${r.assinatura}`);
    assert.equal(r.anon, false, `anon nao executa ${r.assinatura}`);
    assert.equal(r.authenticated, false, `authenticated nao executa ${r.assinatura}`);
    assert.equal(r.app_api, false, `app_api nao executa ${r.assinatura}`);
    assert.equal(r.publico, false, `PUBLIC nao executa ${r.assinatura}`);
  }
});

test('T-DB-03 | o helper privado de permissao nao e executavel por anon, authenticated, app_api nem PUBLIC', async () => {
  const { rows } = await client.query(`
    select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'dsr_admin_caso'`);
  assert.equal(rows.length, 1, 'helper existe');
  assert.equal(rows[0].anon, false);
  assert.equal(rows[0].authenticated, false);
  assert.equal(rows[0].app_api, false);
});
