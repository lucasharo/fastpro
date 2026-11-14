// Issue 54 (H-041) | Testes estaticos da migracao do estado visivel (docs/factory/141-DESENHO-H041.md §8).
// Nao conecta ao banco: le a migracao e o rollback e confere ausencia de agendamento (T41-17), ausencia de
// chamada externa, privilegios so de app_system, search_path fixo e rollback completo (T41-18).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', '20261113320000_verification_create_professional_state.sql');
const ROLLBACK = join(RAIZ, 'supabase', 'rollbacks', '20261113320000_verification_create_professional_state.down.sql');

// Sem comentarios de linha: textos explicativos nao mascaram o SQL real.
const semComentarios = (texto) => texto.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const codigo = semComentarios(readFileSync(MIGRACAO, 'utf8'));
const rollback = semComentarios(readFileSync(ROLLBACK, 'utf8'));
const minusculo = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const comandos = minusculo(codigo).split(';').map((s) => s.trim()).filter(Boolean);
const PAPEL_SERVICO = ['service', 'role'].join('_');
const PAPEIS_SEM_EXECUCAO = ['public', 'anon', 'authenticated', PAPEL_SERVICO, 'app_api'];

describe('estado visivel: migracao estatica (Issue 54)', () => {
  it('T41-17 | sem cron, ops.job, gatilho de tempo, extensao de agendamento nem funcao agendada', () => {
    expect(/\bcron\b/i.test(codigo), 'referencia a cron').toBe(false);
    expect(/\bops\.job\b/i.test(codigo), 'referencia a ops.job').toBe(false);
    expect(/create\s+extension/i.test(codigo), 'extensao').toBe(false);
    expect(/\bpg_sleep\b|\bschedule\b|\bon\s+time\b/i.test(codigo), 'agendamento ou espera').toBe(false);
  });

  it('T41-17 | sem tabela, coluna, gatilho, politica ou catalogo de auditoria novos', () => {
    expect(comandos.filter((c) => c.startsWith('create table') || c.startsWith('alter table')), 'tabela').toEqual([]);
    expect(comandos.filter((c) => c.startsWith('create trigger')), 'gatilho').toEqual([]);
    expect(comandos.filter((c) => c.includes('policy')), 'politica').toEqual([]);
    expect(comandos.filter((c) => c.includes('audit.action_catalog')), 'catalogo de auditoria').toEqual([]);
  });

  it('T41-17 | nenhuma chamada externa: sem rede, sem Mapbox, sem envio de e-mail', () => {
    expect(/\bhttp\b|\bfetch\b|\bmapbox\b|\bnet\.|\bdblink\b|\bemail\b|\bresend\b/i.test(codigo)).toBe(false);
  });

  it('T41-18 | as duas funcoes sao security definer com search_path vazio', () => {
    const definicoes = comandos.filter((c) => c.startsWith('create or replace function'));
    expect(definicoes).toHaveLength(2);
    for (const d of definicoes) {
      expect(d).toContain('security definer');
      expect(d).toContain("set search_path = ''");
    }
  });

  it('T41-18 | execute so para app_system; revoke explicito para publico e papeis de API', () => {
    const grants = comandos.filter((c) => c.startsWith('grant execute'));
    expect(grants).toHaveLength(2);
    for (const g of grants) expect(g.endsWith('to app_system')).toBe(true);
    const revokes = comandos.filter((c) => c.startsWith('revoke all on function'));
    expect(revokes).toHaveLength(2);
    for (const r of revokes) for (const papel of PAPEIS_SEM_EXECUCAO) expect(r).toContain(papel);
  });

  it('T41-18 | a leitura e STABLE e o recurso nao e stable', () => {
    expect(comandos.find((c) => c.includes('function private.professional_verification_state'))).toContain('stable');
    expect(comandos.find((c) => c.includes('function private.professional_verification_appeal'))).not.toContain(' stable ');
  });

  it('T41-18 | rollback remove as duas funcoes pelas assinaturas completas e nada mais', () => {
    expect(rollback).toContain('drop function if exists private.professional_verification_appeal(uuid, timestamptz)');
    expect(rollback).toContain('drop function if exists private.professional_verification_state(uuid)');
    expect(/\bdrop\s+(table|trigger|policy)\b|\bdelete\s+from\s+app\./i.test(rollback)).toBe(false);
  });
});
