// Issue #159 | Teste estatico da migracao private.service_public_name (docs/factory/185-DESENHO-DEFEITOS-TELAS.md, §3.1).
// Sem banco e sem rede: le o SQL e confere postura (security definer, search_path vazio, revoke e grant so para app_api),
// a ausencia de alteracao nas funcoes de rascunho e o arquivo de desfazer. A aplicacao no banco fica para o db:test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261121120000_draft_add_service_public_name.sql';
const DOWN = '20261121120000_draft_add_service_public_name.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
const code = (s) =>
  s
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = code(raw);
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');

describe('Issue 159 estatico da migracao private.service_public_name', () => {
  it('cria a funcao de forma idempotente, security definer, com search_path vazio e leitura so do catalogo', () => {
    const l = lower(sql);
    expect(l).toContain('create or replace function private.service_public_name(p_service_id uuid)');
    expect(l).toContain('returns text');
    expect(l).toContain('language sql');
    expect(l).toContain('security definer');
    expect(l).toContain("set search_path = ''");
    expect(l).toContain('from app.service s where s.id = p_service_id');
  });

  it('revoga de public, anon, authenticated e service_role, e concede so a app_api', () => {
    const l = lower(sql);
    expect(l).toContain('revoke all on function private.service_public_name(uuid) from public, anon, authenticated, service_role;');
    expect(l).toContain('grant execute on function private.service_public_name(uuid) to app_api;');
    expect(l).not.toMatch(/grant execute on function private\.service_public_name\(uuid\) to (public|anon|authenticated|service_role)\b/);
  });

  it('nao altera as funcoes de rascunho nem cria tabela, coluna ou politica', () => {
    expect(sql).not.toMatch(/\b(draft_get|draft_create|draft_patch)\b\s*\(/i);
    expect(lower(sql)).not.toMatch(/create table|alter table|create policy|add column/);
  });

  it('o arquivo de desfazer remove so a funcao nova e a linha de versao', () => {
    const l = lower(down);
    expect(l).toContain('drop function if exists private.service_public_name(uuid);');
    expect(l).toContain("delete from ops.schema_migration where version = '20261121120000';");
    expect(l).not.toMatch(/drop function if exists private\.draft_(get|create|patch)/);
  });
});
