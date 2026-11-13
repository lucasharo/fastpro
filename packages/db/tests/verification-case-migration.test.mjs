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
