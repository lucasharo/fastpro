// Issue 52 (H-039) | Testes estaticos da migracao da fila de verificacao (124-DESENHO-H039 §6, T-20 e T-23).
// Nao conecta ao banco: le o arquivo da migracao e confere RLS, privilegios, funcoes e ausencia de agendamento.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRACAO = join(fileURLToPath(new URL('../../../', import.meta.url)), 'supabase', 'migrations', '20261113200000_verification_create_case_queue.sql');
const sql = readFileSync(MIGRACAO, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo.split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());

describe('migracao da fila de verificacao (Issue 52)', () => {
  it('T-20 | nenhum agendamento, cron, ops.job ou gatilho de tempo criado', () => {
    expect(/\bcron\.(job|schedule)\b/i.test(codigo), 'referencia a cron').toBe(false);
    expect(/\bops\.job\b/i.test(codigo), 'referencia a ops.job').toBe(false);
    expect(/create\s+extension[^;]*cron/i.test(codigo), 'extensao de agendamento').toBe(false);
  });

  it('T-23 | RLS habilitado e forcado nas duas tabelas', () => {
    for (const tabela of ['app.verification_case', 'app.verification_case_event']) {
      expect(instrucoes.some((s) => s === `alter table ${tabela} enable row level security`), `enable ${tabela}`).toBe(true);
      expect(instrucoes.some((s) => s === `alter table ${tabela} force row level security`), `force ${tabela}`).toBe(true);
    }
  });

  it('T-23 | nenhum grant de tabela a papeis de API ou de servico; revoke total nas duas tabelas', () => {
    const grants = instrucoes.filter((s) => s.startsWith('grant ') && /\bon\s+(table\s+)?app\.verification_case/.test(s));
    expect(grants, 'nao deve haver grant de tabela').toEqual([]);
    expect(
      instrucoes.some((s) => s.startsWith('revoke all on app.verification_case') && new RegExp('from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api').test(s)),
      'revoke total das tabelas',
    ).toBe(true);
  });

  it('T-23 | toda funcao de verificacao tem execucao so para app_system', () => {
    const concessoes = instrucoes.filter((s) => s.startsWith('grant execute on function private.verification_') || s.startsWith('grant execute on function private.idoc_review_target'));
    expect(concessoes.length > 0, 'deve haver concessoes de execucao').toBe(true);
    for (const s of concessoes) expect(s, s).toMatch(/to app_system$/);
  });

  it('T-23 | toda funcao private de verificacao usa search_path vazio e security definer', () => {
    const funcoes = [...codigo.matchAll(/create or replace function private\.(verification_[a-z_]+|idoc_review_target)\(/gi)];
    expect(funcoes.length >= 10, `funcoes encontradas: ${funcoes.length}`).toBe(true);
    const blocos = codigo.split(/create or replace function /i).slice(1).filter((b) => /^private\.(verification_|idoc_review_target)/i.test(b));
    for (const bloco of blocos) {
      const cabecalho = bloco.split(/\$\$/)[0];
      expect(cabecalho, `search_path em ${bloco.slice(0, 60)}`).toMatch(/set search_path = ''/i);
    }
  });

  it('T-20 | unicos gatilhos da migracao sao os quatro previstos; nenhum e de tempo', () => {
    const gatilhos = [...codigo.matchAll(/create\s+trigger\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).sort();
    expect(gatilhos).toEqual([
      'identity_document_verification_case',
      'verification_case_event_no_mutation',
      'verification_case_guard',
      'verification_case_no_delete',
    ]);
    expect(/\bcreate\s+event\s+trigger\b/i.test(codigo), 'gatilho de evento de banco').toBe(false);
  });

  it('T-23 | laco de privilegios cobre toda funcao verification_ e idoc_review_target (revoke dos papeis de API)', () => {
    expect(codigo.includes("p.proname like 'verification\\_%'"), 'filtro por prefixo verification_').toBe(true);
    expect(codigo.includes("p.proname = 'idoc_review_target'"), 'filtro de idoc_review_target').toBe(true);
    expect(codigo.includes('revoke all on function %s from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api'), 'revoke no laco').toBe(true);
    expect(
      instrucoes.some((s) => s.startsWith('revoke all on function private.professional_profile_guard_update')
        && new RegExp('from public, anon, authenticated, ' + PAPEL_SERVICO + ', app_api$').test(s)),
      'revoke da guarda de perfil',
    ).toBe(true);
  });

  it('T-23 | nenhuma concessao de execucao ou de tabela a papeis de API, publico ou servico (so app_system)', () => {
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes.length >= 8, `concessoes: ${concessoes.length}`).toBe(true);
    for (const s of concessoes) {
      expect(s, s).toMatch(/to app_system$/);
      expect(/\b(anon|authenticated|public|app_api)\b/.test(s), s).toBe(false);
    }
  });

  it('T-23 | funcoes de gatilho e de manutencao nao recebem execucao de ninguem (so revoke)', () => {
    for (const nome of ['verification_case_on_idoc_received', 'verification_event_refuse_mutation', 'verification_case_refuse_delete', 'verification_case_guard']) {
      expect(instrucoes.some((s) => s.startsWith(`grant execute on function private.${nome}(`)), nome).toBe(false);
    }
  });
});
