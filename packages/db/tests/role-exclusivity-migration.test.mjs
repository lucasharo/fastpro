// H-017 (Issue #30) | T-16 da exclusividade de papeis: teste estatico da migracao e do desfazer
// (101-DESENHO-H017.md, §3 e §7). Sem banco e sem rede: le o SQL e confere postura (RLS forcada, grants,
// search_path, ausencia de delete/drop de dado de usuario, auditoria cadastrada, chaves de erro, guarda do desfazer).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION = new URL('../../../supabase/migrations/20261112200000_identity_create_role_exclusivity.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261112200000_identity_create_role_exclusivity.down.sql', import.meta.url);

const raw = readFileSync(MIGRATION, 'utf8');
const down = readFileSync(DOWN, 'utf8');
// Codigo sem linhas de comentario (os cabecalhos citam nomes e regras de proposito).
const code = (s) =>
  s
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = code(raw).toLowerCase();
const sqlDown = code(down).toLowerCase();

describe('T-16 migracao da exclusividade de papeis (estatico)', () => {
  it('customer_profile tem RLS habilitada e forcada', () => {
    expect(sql).toContain('alter table app.customer_profile enable row level security;');
    expect(sql).toContain('alter table app.customer_profile force row level security;');
  });

  it('nenhum grant para anon, authenticated, service_role ou app_api; revoke explicito em customer_profile', () => {
    expect(sql).toContain('revoke all on app.customer_profile from public, anon, authenticated, service_role, app_api;');
    expect(sql).not.toMatch(/grant\s[^;]*\bto\s+(anon|authenticated|service_role|app_api)\b/);
  });

  it('customer_profile recebe so select e insert para app_system (sem update nem delete)', () => {
    expect(sql).toContain('grant select, insert on app.customer_profile to app_system;');
    expect(sql).not.toMatch(/grant[^;]*\bupdate\b[^;]*customer_profile/);
    expect(sql).not.toMatch(/grant[^;]*\bdelete\b[^;]*customer_profile/);
  });

  it('toda funcao security definer tem search_path vazio', () => {
    const definers = (sql.match(/security definer/g) ?? []).length;
    const paths = (sql.match(/set search_path = ''/g) ?? []).length;
    expect(definers).toBeGreaterThan(0);
    expect(paths).toBe(definers);
  });

  it('nao apaga nem altera dado de usuario (sem delete, truncate ou drop table fora do desfazer)', () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    expect(sql).not.toMatch(/\bdrop\s+table\b/);
    expect(sql).not.toMatch(/\bupdate\s+app\.(app_user|professional_profile|admin_staff)\b/);
  });

  it('cada raise de regra usa errcode 23514 (um raise por regra mais a verificacao previa e o isolamento)', () => {
    const raises = (sql.match(/raise exception/g) ?? []).length;
    const codes = (sql.match(/errcode = '23514'/g) ?? []).length;
    expect(raises).toBeGreaterThan(0);
    expect(codes).toBe(raises);
  });

  it('a verificacao previa (h017_violacao_existente) vem antes de qualquer DDL', () => {
    const verificacao = sql.indexOf("'h017_violacao_existente'");
    const primeiraTabela = sql.indexOf('create table');
    expect(verificacao).toBeGreaterThan(-1);
    expect(verificacao).toBeLessThan(primeiraTabela);
  });

  it('a acao de auditoria da recusa esta cadastrada no catalogo', () => {
    expect(sql).toContain("'identity.role_exclusivity.denied'");
    expect(sql).toMatch(/insert into audit\.action_catalog[\s\S]*on conflict \(action, object_type\) do nothing/);
  });

  it('o gatilho de imutabilidade de auth_user_id existe em app_user', () => {
    expect(sql).toContain('before update of auth_user_id on app.app_user');
  });

  it('desfazer existe, tem a guarda de dados e nao toca app_user, professional_profile nem admin_staff alem dos gatilhos', () => {
    expect(sqlDown).toContain("'rollback_recusado_com_dados'");
    expect(sqlDown).toContain("app.rollback_force");
    expect(sqlDown).toMatch(/drop table if exists app\.customer_profile;/);
    expect(sqlDown).not.toMatch(/\bdelete\s+from\s+app\.(app_user|professional_profile|admin_staff)\b/);
    expect(sqlDown).toContain("delete from ops.schema_migration where version = '20261112200000';");
  });
});
