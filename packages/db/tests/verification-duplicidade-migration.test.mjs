// Issue 53 (H-040) | Testes estaticos da migracao da retencao por duplicidade (docs/factory/134-DESENHO-H040.md §5).
// Nao conecta ao banco: le a migracao e o rollback e confere ausencia de agendamento (T40-14), ausencia de chamada
// externa, privilegios so de app_system, search_path fixo e rollback completo (T40-18).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', '20261113280000_verification_expand_duplicate_retention.sql');
const ROLLBACK = join(RAIZ, 'supabase', 'rollbacks', '20261113280000_verification_expand_duplicate_retention.down.sql');

// Sem comentarios de linha: textos explicativos nao mascaram o SQL real.
const semComentarios = (texto) => texto.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const codigo = semComentarios(readFileSync(MIGRACAO, 'utf8'));
const rollback = semComentarios(readFileSync(ROLLBACK, 'utf8'));
const minusculo = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const comandos = minusculo(codigo).split(';').map((s) => s.trim()).filter(Boolean);
const PAPEL_SERVICO = ['service', 'role'].join('_');
const PAPEIS_SEM_EXECUCAO = ['public', 'anon', 'authenticated', PAPEL_SERVICO, 'app_api'];

describe('retencao por duplicidade: migracao estatica (Issue 53)', () => {
  it('T40-14 | sem cron, ops.job, gatilho de tempo, extensao de agendamento nem funcao agendada', () => {
    expect(/\bcron\b/i.test(codigo), 'referencia a cron').toBe(false);
    expect(/\bops\.job\b/i.test(codigo), 'referencia a ops.job').toBe(false);
    expect(/create\s+extension/i.test(codigo), 'extensao').toBe(false);
    expect(/\bpg_sleep\b|\bschedule\b|\bon\s+time\b/i.test(codigo), 'agendamento ou espera').toBe(false);
  });

  it('T40-14 | o gatilho novo dispara so em UPDATE OF verification_status, sem condicao de tempo', () => {
    const gatilho = comandos.find((c) => c.startsWith('create trigger professional_profile_retained_audit'));
    expect(gatilho, 'gatilho de auditoria do cadastro').toBeTruthy();
    expect(gatilho).toContain('after update of verification_status on app.professional_profile');
    expect(gatilho).not.toMatch(/now\(\)|interval|clock_timestamp/);
  });

  it('T40-18 | nenhuma chamada externa: sem rede, sem Mapbox, sem envio de e-mail', () => {
    expect(/\bhttp\b|\bfetch\b|\bmapbox\b|\bnet\.|\bdblink\b|\bemail\b|\bresend\b/i.test(codigo)).toBe(false);
  });

  it('T40-18 | sem alteracao de tabela, coluna, constraint ou politica (RLS intacta)', () => {
    expect(comandos.filter((c) => c.startsWith('alter table')), 'alter table').toEqual([]);
    expect(comandos.filter((c) => c.startsWith('create table')), 'create table').toEqual([]);
    expect(comandos.filter((c) => c.startsWith('create policy') || c.startsWith('drop policy')), 'politica').toEqual([]);
    expect(comandos.filter((c) => /^grant\s+(select|insert|update|delete)\b.*\bon\s+(table\s+)?app\./.test(c)), 'grant de tabela').toEqual([]);
  });

  it('T40-18 | toda funcao nova ou alterada tem search_path vazio', () => {
    const funcoes = (codigo.match(/create or replace function/gi) ?? []).length;
    const caminhosFixos = (codigo.match(/set search_path = ''/g) ?? []).length;
    expect(funcoes).toBe(8);
    expect(caminhosFixos).toBe(funcoes);
  });

  it('T40-18 | execucao so para app_system; revoke total para os demais papeis em cada funcao nova', () => {
    const concessoes = comandos.filter((c) => c.startsWith('grant execute on function'));
    expect(concessoes.length, 'concessoes').toBeGreaterThan(0);
    for (const c of concessoes) {
      expect(c.endsWith('to app_system'), c).toBe(true);
      for (const papel of PAPEIS_SEM_EXECUCAO) {
        expect(c.includes(` to ${papel}`), `${papel} em ${c}`).toBe(false);
      }
    }
    for (const nome of ['verification_duplicate_original_alive(uuid)', 'verification_profile_mirror_blocked(uuid)',
      'verification_duplicate_view(uuid, text, uuid, timestamptz)', 'professional_profile_retained_audit()']) {
      const revoke = comandos.find((c) => c.startsWith('revoke all on function private.') && c.includes(nome));
      expect(revoke, `revoke de ${nome}`).toBeTruthy();
      for (const papel of PAPEIS_SEM_EXECUCAO) {
        expect(revoke.includes(papel), `${papel} em revoke de ${nome}`).toBe(true);
      }
    }
  });

  it('T40-18 | assinaturas de #52 preservadas (decide, assign, appeal, queue_list)', () => {
    expect(codigo).toContain('function private.verification_case_assign(\n  p_actor uuid, p_session_hash text, p_case uuid, p_expected_version integer, p_now timestamptz)');
    expect(codigo).toContain('function private.verification_case_appeal(p_professional uuid, p_now timestamptz)');
    expect(codigo).toContain('p_complement text, p_expected_version integer, p_now timestamptz)');
    expect(codigo).toContain('p_after_sla timestamptz, p_after_id uuid, p_now timestamptz)');
  });

  it('T40-18 | idempotente: create or replace, drop trigger if exists e on conflict do nothing', () => {
    expect(/drop trigger if exists professional_profile_retained_audit/.test(minusculo(codigo))).toBe(true);
    expect(/on conflict \(action, object_type\) do nothing/.test(minusculo(codigo))).toBe(true);
  });

  it('T40-18 | rollback remove o gatilho, as funcoes novas e a acao de auditoria, e restaura as quatro funcoes de #52', () => {
    const r = minusculo(rollback);
    expect(r).toContain('drop trigger if exists professional_profile_retained_audit');
    expect(r).toContain('drop function if exists private.professional_profile_retained_audit');
    expect(r).toContain("delete from audit.action_catalog where action = 'verification.profile.retained'");
    for (const f of ['verification_case_assign', 'verification_case_decide', 'verification_case_appeal', 'verification_queue_list']) {
      expect(r, `restaura ${f}`).toContain(`create or replace function private.${f}(`);
    }
    expect(r).not.toMatch(/drop\s+table|truncate|delete\s+from\s+audit\.audit_event|delete\s+from\s+app\./);
  });
});
