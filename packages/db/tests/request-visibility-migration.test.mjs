// Issue 45 (H-032) | Teste estatico da migracao M1 (20261113230000) e da reversao (docs/factory/127-DESENHO-H032.md, §4.1).
// Sem banco e sem rede: le os arquivos SQL. O comportamento no Postgres fica em request-visibility-h032.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIG = new URL('../../../supabase/migrations/20261113230000_requests_expand_location_visibility.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261113230000_requests_expand_location_visibility.down.sql', import.meta.url);

const sql = readFileSync(MIG, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();
const down = readFileSync(DOWN, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();

describe('migracao 20261113230000 (Issue 45, H-032, M1): estatico', () => {
  it('e expansiva: sem drop de coluna, sem drop table e sem apagar dados', () => {
    expect(sql).not.toMatch(/drop table|drop column|delete from app\.|truncate/);
    expect(sql).not.toMatch(/alter column [a-z_]+ type/);
  });

  it('nao edita request_publish_commit nem request_publish_begin (Issue 44)', () => {
    expect(sql).not.toMatch(/function private\.request_publish_commit\(/);
    expect(sql).not.toMatch(/function private\.request_publish_begin\(/);
  });

  it('leituras nao usam exact_point nem geography nem registram log', () => {
    const detalhe = sql.slice(sql.indexOf('function private.request_detail_professional('), sql.indexOf('-- 8.'));
    expect(detalhe).not.toMatch(/exact_point|geography/);
    expect(sql).not.toMatch(/raise (notice|log|warning)/);
  });

  it('todas as funcoes novas sao security definer com search_path vazio', () => {
    expect(sql.match(/security definer/g)?.length).toBe(sql.match(/set search_path = ''/g)?.length);
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('so app_system executa as funcoes novas que a API usa; nenhuma para papeis de API', () => {
    expect(sql).toMatch(/grant execute on function private\.request_publish_commit_enc[^;]*to app_system;/);
    expect(sql).toMatch(/grant execute on function private\.request_detail_professional[^;]*to app_system;/);
    expect(sql).toMatch(/grant execute on function private\.request_owner_get[^;]*to app_system;/);
    expect(sql).not.toMatch(/grant execute on function private\.request_(publish_commit_enc|owner_get|detail_professional|visibility_guard|address_)[^;]*to (app_api|anon|authenticated|service_role|public)/);
  });

  it('a reversao recusa com dados e restaura a funcao de imutabilidade da Issue 44', () => {
    expect(down).toMatch(/rollback_recusado_com_dados/);
    expect(down).toMatch(/app\.rollback_force/);
    expect(down).toMatch(/create or replace function private\.service_request_imutaveis_bu/);
    expect(down).toMatch(/delete from ops\.schema_migration where version = '20261113230000'/);
  });

  it('nao contem comentario com "#NNN" (usa "Issue 45")', () => {
    const bruto = readFileSync(MIG, 'utf8') + readFileSync(DOWN, 'utf8');
    expect(bruto).not.toMatch(/#\d{2,3}\b/);
  });
});
