// Issue 36 (H-023) | Teste estatico da migracao 20261113210000 e do rollback (docs/factory/97-DESENHO-H023.md, §3 e §7).
// Sem banco e sem rede: le os arquivos SQL. O comportamento no Postgres fica em geo-discovery-requests.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIG = new URL('../../../supabase/migrations/20261113210000_geo_expand_discovery_requests.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261113210000_geo_expand_discovery_requests.down.sql', import.meta.url);

const bruto = readFileSync(MIG, 'utf8');
const sql = bruto
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();
const down = readFileSync(DOWN, 'utf8').toLowerCase();

describe('migracao 20261113210000 (Issue 36, H-023): estatico', () => {
  it('e so expansao: sem create table, alter table, create index nem insert/update/delete em dados', () => {
    expect(sql).not.toMatch(/create table|alter table|create index|drop table|insert into|update app\.|delete from/);
  });

  it('o caminho de consulta nao le exact_point nem geography e nao registra log', () => {
    expect(sql).not.toMatch(/exact_point|geography/);
    expect(sql).not.toMatch(/raise (notice|log|warning)|format\(/);
  });

  it('erros usam texto fixo e codigo 22023 (CA-04, CA-11)', () => {
    for (const erro of ['discover_parametro_invalido', 'discover_raio_invalido', 'discover_pre_requisito_ausente']) {
      expect(sql).toContain(erro);
    }
    expect(sql.match(/errcode = '22023'/g)?.length).toBe(2);
  });

  it('piso e teto do raio (5.000 a 100.000 m) imposto na consulta interna (CA-04)', () => {
    expect(sql).toMatch(/p_radius_m < 5000 or p_radius_m > 100000/);
  });

  it('so app_system executa a entrada; a interna nao tem execute para ninguem; nenhum papel de API', () => {
    expect(sql).toMatch(/grant execute on function private\.discover_requests\(uuid, integer, smallint, integer, uuid\) to app_system;/);
    expect(sql).not.toMatch(/grant execute on function private\.discover_scan/);
    expect(sql).toMatch(/revoke all on function private\.discover_scan[\s\S]*from public, anon, authenticated, service_role, app_api, app_backup_reader;/);
    expect(sql).toMatch(/revoke all on function private\.discover_requests[\s\S]*from public, anon, authenticated, service_role, app_api, app_backup_reader;/);
  });

  it('funcoes com search_path vazio e security definer', () => {
    expect(sql.match(/set search_path = ''/g)?.length).toBe(2);
    expect(sql.match(/security definer/g)?.length).toBe(2);
  });

  it('nao contem comentario com "#NNN" (usa "Issue 36")', () => {
    expect(bruto).not.toMatch(/#\d{2,3}\b/);
  });

  it('rollback remove as duas funcoes e a linha de controle da versao', () => {
    expect(down).toContain('drop function if exists private.discover_requests');
    expect(down).toContain('drop function if exists private.discover_scan');
    expect(down).toContain("delete from ops.schema_migration where version = '20261113210000'");
    expect(down).not.toMatch(/drop table|delete from app\./);
  });
});
