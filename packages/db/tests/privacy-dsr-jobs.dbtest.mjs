// Issue 120 (H-111) | Jobs e avisos dos direitos do titular no banco (147-DESENHO-H111 §4.4, §7: T-API-11, T-API-12 e
// T-API-14 na parte de banco). Banco de desenvolvimento. Cada cenario roda em transacao e e desfeito (rollback).
// Valores sinteticos (@example.test). Sem rede, sem e-mail real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect } from '../scripts/lib/env.mjs';

const COMPORTAMENTO = readFileSync(
  fileURLToPath(new URL('./privacy-dsr-jobs-comportamento.sql', import.meta.url)),
  'utf8',
);

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

test('comportamento: enfileiramento, processamento automatico, limpeza de autenticacao, aviso e expurgo', async () => {
  await client.query('begin');
  try {
    await client.query(COMPORTAMENTO);
  } finally {
    await client.query('rollback');
  }
});

test('T-DB-03 | as quatro funcoes-alvo sao SECURITY DEFINER, com search_path vazio e execute so para app_system', async () => {
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
       and p.proname in ('dsr_job_process_auto', 'dsr_job_export_target', 'dsr_job_export_mark_purged',
                         'dsr_job_auth_cleanup_target')`);
  assert.equal(rows.length, 4, 'quatro funcoes-alvo');
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

test('T-DB-03 | os gatilhos de enfileiramento nao sao executaveis diretamente por papeis de aplicacao', async () => {
  const { rows } = await client.query(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('dsr_case_enqueue_job', 'dsr_usuario_enqueue_auth_cleanup',
                         'dsr_export_enqueue_purge', 'dsr_event_enqueue_email')`);
  assert.equal(rows.length, 4, 'quatro gatilhos');
  for (const r of rows) {
    assert.equal(r.anon, false, `anon em ${r.proname}`);
    assert.equal(r.authenticated, false, `authenticated em ${r.proname}`);
    assert.equal(r.app_api, false, `app_api em ${r.proname}`);
  }
});
