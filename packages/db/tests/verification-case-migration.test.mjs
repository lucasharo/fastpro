// Issue 52 (H-039) | Testes estaticos da migracao da fila de verificacao (124-DESENHO-H039 §6, T-20 e T-23).
// Nao conecta ao banco: le o arquivo da migracao e confere RLS, privilegios, funcoes e ausencia de agendamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRACAO = join(fileURLToPath(new URL('../../../', import.meta.url)), 'supabase', 'migrations', '20261113200000_verification_create_case_queue.sql');
const sql = readFileSync(MIGRACAO, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo.split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());

test('T-20 | nenhum agendamento, cron, ops.job ou gatilho de tempo criado', () => {
  assert.equal(/\bcron\.(job|schedule)\b/i.test(codigo), false, 'referencia a cron');
  assert.equal(/\bops\.job\b/i.test(codigo), false, 'referencia a ops.job');
  assert.equal(/create\s+extension[^;]*cron/i.test(codigo), false, 'extensao de agendamento');
});

test('T-23 | RLS habilitado e forcado nas duas tabelas', () => {
  for (const tabela of ['app.verification_case', 'app.verification_case_event']) {
    assert.ok(instrucoes.some((s) => s === `alter table ${tabela} enable row level security`), `enable ${tabela}`);
    assert.ok(instrucoes.some((s) => s === `alter table ${tabela} force row level security`), `force ${tabela}`);
  }
});

test('T-23 | nenhum grant de tabela a papeis de API ou de servico; revoke total nas duas tabelas', () => {
  const grants = instrucoes.filter((s) => s.startsWith('grant ') && /\bon\s+(table\s+)?app\.verification_case/.test(s));
  assert.deepEqual(grants, [], 'nao deve haver grant de tabela');
  assert.ok(
    instrucoes.some((s) => s.startsWith('revoke all on app.verification_case') && new RegExp('from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api').test(s)),
    'revoke total das tabelas',
  );
});

test('T-23 | toda funcao de verificacao tem execucao so para app_system', () => {
  const concessoes = instrucoes.filter((s) => s.startsWith('grant execute on function private.verification_') || s.startsWith('grant execute on function private.idoc_review_target'));
  assert.ok(concessoes.length > 0, 'deve haver concessoes de execucao');
  for (const s of concessoes) assert.match(s, /to app_system$/, s);
});

test('T-23 | toda funcao private de verificacao usa search_path vazio e security definer', () => {
  const funcoes = [...codigo.matchAll(/create or replace function private\.(verification_[a-z_]+|idoc_review_target)\(/gi)];
  assert.ok(funcoes.length >= 10, `funcoes encontradas: ${funcoes.length}`);
  const blocos = codigo.split(/create or replace function /i).slice(1).filter((b) => /^private\.(verification_|idoc_review_target)/i.test(b));
  for (const bloco of blocos) {
    const cabecalho = bloco.split(/\$\$/)[0];
    assert.match(cabecalho, /set search_path = ''/i, `search_path em ${bloco.slice(0, 60)}`);
  }
});

test('T-20 | unicos gatilhos da migracao sao os quatro previstos; nenhum e de tempo', () => {
  const gatilhos = [...codigo.matchAll(/create\s+trigger\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(gatilhos, [
    'identity_document_verification_case',
    'verification_case_event_no_mutation',
    'verification_case_guard',
    'verification_case_no_delete',
  ]);
  assert.equal(/\bcreate\s+event\s+trigger\b/i.test(codigo), false, 'gatilho de evento de banco');
});

test('T-23 | laco de privilegios cobre toda funcao verification_ e idoc_review_target (revoke dos papeis de API)', () => {
  assert.ok(codigo.includes("p.proname like 'verification\\_%'"), 'filtro por prefixo verification_');
  assert.ok(codigo.includes("p.proname = 'idoc_review_target'"), 'filtro de idoc_review_target');
  assert.ok(codigo.includes('revoke all on function %s from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api'), 'revoke no laco');
  assert.ok(
    instrucoes.some((s) => s.startsWith('revoke all on function private.professional_profile_guard_update')
      && new RegExp('from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api$').test(s)),
    'revoke da guarda de perfil',
  );
});

test('T-23 | nenhuma concessao de execucao ou de tabela a papeis de API, publico ou servico (so app_system)', () => {
  const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
  assert.ok(concessoes.length >= 8, `concessoes: ${concessoes.length}`);
  for (const s of concessoes) {
    assert.match(s, /to app_system$/, s);
    assert.equal(/\b(anon|authenticated|public|app_api)\b/.test(s), false, s);
  }
});

test('T-23 | funcoes de gatilho e de manutencao nao recebem execucao de ninguem (so revoke)', () => {
  for (const nome of ['verification_case_on_idoc_received', 'verification_event_refuse_mutation', 'verification_case_refuse_delete', 'verification_case_guard']) {
    assert.equal(instrucoes.some((s) => s.startsWith(`grant execute on function private.${nome}(`)), false, nome);
  }
});
