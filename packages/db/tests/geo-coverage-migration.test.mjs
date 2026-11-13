// Issue 37 (H-024) | Teste estatico da migracao 20261113220000 e do rollback (docs/factory/99-DESENHO-H024.md, §4.3, §6 e §7).
// Sem banco e sem rede: le os arquivos SQL. O comportamento no Postgres fica em geo-coverage.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIG = new URL('../../../supabase/migrations/20261113220000_geo_expand_coverage.sql', import.meta.url);
const DOWN = new URL('../../../supabase/rollbacks/20261113220000_geo_expand_coverage.down.sql', import.meta.url);

const bruto = readFileSync(MIG, 'utf8');
const sql = bruto
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();
const down = readFileSync(DOWN, 'utf8').toLowerCase();

describe('migracao 20261113220000 (Issue 37, H-024): estatico', () => {
  it('e so expansao: a unica tabela nova e o cache; nenhuma alteracao em tabela de origem; nenhum dado gravado', () => {
    expect(sql.match(/create table/g)?.length).toBe(1);
    expect(sql).toMatch(/create table if not exists ops\.coverage_cache/);
    expect(sql).not.toMatch(/alter table app\./);
    expect(sql).not.toMatch(/drop table|drop column|insert into app\.|update app\.|delete from app\./);
  });

  it('sem contagem, lista ou agregado no caminho de cobertura (CA-02)', () => {
    expect(sql).not.toMatch(/\bcount\s*\(|array_agg|string_agg|json_agg|jsonb_agg|json_build_object|jsonb_build_object/);
  });

  it('o caminho de consulta nao le exact_point, nao usa geography nem PostGIS (CA-05)', () => {
    expect(sql).not.toMatch(/exact_point|geography|extensions\.st_|\bst_/);
  });

  it('sem log, aviso ou mensagem formatada (CA-12)', () => {
    expect(sql).not.toMatch(/raise (notice|log|warning)|\bformat\s*\(/);
  });

  it('erros com texto fixo; a entrada e a existencia usam codigo 22023 para parametro invalido', () => {
    expect(sql).toContain("raise exception 'coverage_parametro_invalido' using errcode = '22023'");
    expect(sql).toContain("raise exception 'coverage_pre_requisito_ausente'");
    const mensagens = [...sql.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1]);
    expect(new Set(mensagens)).toEqual(new Set(['coverage_parametro_invalido', 'coverage_pre_requisito_ausente']));
  });

  it('a entrada e a unica concedida, so a app_system; a existencia nao tem concessao a papel algum', () => {
    expect(sql).toMatch(/grant execute on function private\.coverage_for_request\(uuid, uuid, text, timestamptz, integer, integer, integer\)\s+to app_system;/);
    expect(sql).not.toMatch(/grant execute on function private\.coverage_exists/);
    expect(sql).toMatch(/revoke all on function private\.coverage_exists[\s\S]*from public, anon, authenticated, \w+, app_api, app_backup_reader, app_system;/);
  });

  it('papeis de API nao executam a entrada (app_api e app_backup_reader revogados)', () => {
    expect(sql).toMatch(/revoke all on function private\.coverage_for_request[\s\S]*app_api, app_backup_reader;/);
  });

  it('funcoes com search_path vazio; a entrada e o contador sao security definer ou usam search_path vazio', () => {
    expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/security definer/g)?.length).toBe(2);
  });

  it('a regra de descoberta e so a das cinco funcoes puras (nao repete o raio da Terra fora delas)', () => {
    expect(sql.match(/6371008\.8/g)?.length).toBe(1);
    for (const f of ['discovery_dist_m', 'discovery_open', 'discovery_mod_pres', 'discovery_mod_onl', 'discovery_serves']) {
      expect(sql).toContain(`create or replace function private.${f}(`);
    }
  });

  it('a pre-condicao confere funcoes da Issue 36 e do contador (discover_scan, match_janela, rl_check, rl_hit)', () => {
    for (const f of ['match_janela', 'rl_check', 'rl_hit', 'professional_eligible', 'discover_scan']) {
      expect(sql).toContain(f);
    }
  });

  it('nao contem comentario com numero de Issue no formato "#NNN" (usa "Issue 37")', () => {
    expect(bruto).not.toMatch(/#\d{2,3}\b/);
    expect(bruto).toContain('Issue 37');
  });

  it('rollback remove as funcoes, o indice, a tabela e a linha de controle, sem tocar dados de origem', () => {
    for (const f of ['coverage_for_request', 'coverage_take', 'coverage_exists', 'discovery_serves', 'discovery_dist_m']) {
      expect(down).toContain(`drop function if exists private.${f}`);
    }
    expect(down).toContain('drop index if exists app.geocode_point_match_cell_base_idx');
    expect(down).toContain('drop table if exists ops.coverage_cache');
    expect(down).toContain("delete from ops.schema_migration where version = '20261113220000'");
    expect(down).not.toMatch(/drop table if exists app\.|delete from app\./);
  });
});
