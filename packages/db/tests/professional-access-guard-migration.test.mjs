// Issue 55 (H-042), parte A | Teste estatico da migracao 20261113420000 e da reversao (docs/factory/142-DESENHO-H042.md, §4, T-18 e T-19).
// Sem banco e sem rede: le os arquivos SQL. O comportamento no Postgres fica em professional-access-guard.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const PREFIXO = '20261113420000';
const NOME = `${PREFIXO}_eligibility_expand_professional_access_guard`;
const MIG_DIR = new URL('../../../supabase/migrations/', import.meta.url);
const DOWN_DIR = new URL('../../../supabase/rollbacks/', import.meta.url);
const MIG = readFileSync(new URL(`${NOME}.sql`, MIG_DIR), 'utf8');
const DOWN = readFileSync(new URL(`${NOME}.down.sql`, DOWN_DIR), 'utf8');

/** Corpo de uma funcao: do "as $$" ao primeiro "$$;" seguinte, a partir do cabecalho dado. */
function corpo(sql, cabecalho) {
  const inicio = sql.indexOf(cabecalho);
  if (inicio < 0) return '';
  const abre = sql.indexOf('$$', inicio);
  const fecha = sql.indexOf('$$;', abre + 2);
  return sql.slice(abre + 2, fecha);
}

const GUARDA = corpo(MIG, 'function private.professional_access_guard(');

describe('T-18 migracao: nome, prefixo e reversao', () => {
  it('arquivos da migracao e da reversao existem com o mesmo prefixo', () => {
    expect(MIG.length).toBeGreaterThan(0);
    expect(DOWN.length).toBeGreaterThan(0);
    const migs = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    expect(migs).toContain(`${NOME}.sql`);
    const antigas = migs.filter((f) => f < `${NOME}.sql` && f.startsWith('2026'));
    expect(antigas.length).toBeGreaterThan(0);
  });

  it('o prefixo e maior que o da ultima migracao que existia no desenho (20261113310000)', () => {
    expect(PREFIXO > '20261113310000').toBe(true);
  });

  it('a reversao restaura a fachada antiga, a entrada de 5 argumentos e remove a guarda nova', () => {
    expect(DOWN).toContain("p.verification_status = 'aprovada'");
    expect(DOWN).toContain('p_professional_id uuid,\n  p_limit           integer default 50,');
    expect(DOWN).toMatch(/drop function if exists private\.discover_requests\(uuid, integer, smallint, integer, uuid, timestamp with time zone\)/);
    expect(DOWN).toMatch(/drop function if exists private\.professional_access_guard\(uuid, text, timestamp with time zone\)/);
  });
});

describe('T-19 migracao: estatico', () => {
  it('guarda sem now() e sem raise exception (o instante vem de p_now)', () => {
    expect(GUARDA.length).toBeGreaterThan(0);
    expect(GUARDA).not.toMatch(/\bnow\s*\(/);
    expect(GUARDA).not.toMatch(/clock_timestamp/);
    expect(GUARDA).not.toMatch(/raise\s+exception/i);
  });

  it('a guarda chama professional_eligible e commercial_access, e usa lista de permissao', () => {
    expect(GUARDA).toContain('private.professional_eligible(p_professional_id)');
    expect(GUARDA).toContain('private.commercial_access(p_professional_id, p_now)');
    expect(GUARDA).toMatch(/v_estado in \('trial_ativo', 'ativa', 'cancelada_com_acesso_ate_fim_do_periodo', 'em_carencia'\)/);
  });

  it('todo grant de execucao da migracao vai so para app_system', () => {
    const grants = MIG.split('\n').filter((l) => /^\s*grant execute/i.test(l));
    expect(grants.length).toBe(3);
    for (const g of grants) expect(g).toMatch(/to app_system;$/);
  });

  it('a migracao nao cria, altera nem apaga tabela, dado, cron ou grant de tabela', () => {
    expect(MIG).not.toMatch(/\bcreate\s+table\b/i);
    expect(MIG).not.toMatch(/\balter\s+table\b/i);
    expect(MIG).not.toMatch(/\binsert\s+into\b/i);
    expect(MIG).not.toMatch(/\bdelete\s+from\b/i);
    expect(MIG).not.toMatch(/\btruncate\b/i);
    expect(MIG).not.toMatch(/\bcron\./i);
    expect(MIG).not.toMatch(/\bgrant\s+(select|insert|update|delete|all)\b/i);
  });

  it('pre-requisitos ausentes levantam codigo fixo antes de qualquer troca', () => {
    expect(MIG.indexOf('guarda_pre_requisito_ausente')).toBeLessThan(MIG.indexOf('create or replace function private.professional_access_guard'));
  });

  it('a fachada mantem o raise 22023 para parametro nulo (decisao 643)', () => {
    const fachada = corpo(MIG, 'function private.request_visibility_guard(');
    expect(fachada).toContain("raise exception 'visibilidade_parametro_invalido' using errcode = '22023'");
    expect(fachada).toContain("private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)");
    expect(fachada).not.toContain('verification_status');
  });
});
