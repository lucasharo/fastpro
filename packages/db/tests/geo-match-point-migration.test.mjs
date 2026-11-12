// H-022 | Teste estatico da migracao 20261112120500 e da fixture dourada (docs/factory/88-DESENHO-H022.md, §8 T-SEG).
// Sem banco e sem rede: le os arquivos SQL e recalcula a grade em JavaScript. O comportamento no Postgres fica
// em geo-match-point.dbtest.mjs. Executar: vitest (pnpm test).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261112120500_geo_expand_match_point.sql';
const DOWN = '20261112120500_geo_expand_match_point.down.sql';
const ANTERIOR = '20261112110000_retention_expurgo_ajustes.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');

// Trechos "create or replace function ... $$ ... $$;" (o cabecalho vai ate o primeiro $$ de abertura).
const funcoes = lower(sql)
  .split('create or replace function ')
  .slice(1)
  .map((trecho) => {
    const nome = trecho.match(/^([a-z_.]+)\(/)[1];
    const cabecalho = trecho.slice(0, trecho.indexOf('as $$'));
    return { nome, cabecalho };
  });

describe('T-SEG arquivos e nomes', () => {
  it('o nome segue o padrao de versao e a migracao vem depois da ultima existente', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z_]+\.sql$/);
    const versoes = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.*\.sql$/.test(f)).map((f) => f.slice(0, 14));
    expect(versoes.filter((v) => v === '20261112120500')).toHaveLength(1);
    expect(ANTERIOR.slice(0, 14) < '20261112120500').toBe(true);
  });

  it('o arquivo de desfazer existe com o mesmo nome base', () => {
    expect(DOWN).toBe(FILE.replace(/\.sql$/, '.down.sql'));
    expect(down.length).toBeGreaterThan(0);
  });

  it('a migracao nao tem BEGIN/COMMIT (o executor encapsula a transacao)', () => {
    expect(sql.split(/\r?\n/).filter((l) => /^\s*(begin|commit|rollback)\s*;\s*$/i.test(l))).toEqual([]);
  });
});

describe('T-SEG funcoes: search_path vazio, dono de execucao e permissoes', () => {
  it('a migracao cria as quatro funcoes da grade/consulta mais o gatilho', () => {
    expect(funcoes.map((f) => f.nome).sort()).toEqual(
      [
        'private.geocode_point_set_match',
        'private.match_grid',
        'private.match_grid_dlon',
        'private.match_janela',
        'private.match_points_within',
      ].sort(),
    );
  });

  it('toda funcao nova tem set search_path = empty string', () => {
    for (const f of funcoes) {
      expect(f.cabecalho, f.nome).toContain("set search_path = ''");
    }
  });

  it('todo grant de execucao vai so para app_system', () => {
    const grants = lower(sql).match(/grant execute on function [^;]* to [a-z_]+;/g) ?? [];
    expect(grants.length).toBe(4);
    for (const g of grants) expect(g).toMatch(/to app_system;$/);
  });

  // O papel de servico do Supabase entra como \w+ (nome omitido de proposito, ver check:secrets).
  it('toda funcao nova e revogada de PUBLIC, anon, authenticated, o papel de servico e app_api', () => {
    const revokes = lower(sql).match(/revoke all on function [^;]*;/g) ?? [];
    expect(revokes.length).toBe(5);
    for (const r of revokes) {
      expect(r).toMatch(/from public, anon, authenticated, \w+, app_api/);
    }
  });

  it('o gatilho nao recebe execute de ninguem (o dono o executa; app_system tambem e revogado)', () => {
    expect(lower(sql)).toMatch(
      /revoke all on function private\.geocode_point_set_match\(\)\s+from public, anon, authenticated, \w+, app_api, app_system, app_backup_reader;/,
    );
  });

  it('a janela de faixas (funcao pura) nao le exact_point', () => {
    const inicio = lower(sql).indexOf('create or replace function private.match_janela');
    const fim = lower(sql).indexOf('$$;', inicio);
    expect(inicio).toBeGreaterThan(0);
    expect(lower(sql).slice(inicio, fim)).not.toContain('exact_point');
  });
});

describe('T-SEG escopo de colunas e tabelas', () => {
  it('so app.geocode_point recebe alteracao de tabela; as colunas novas sao match_*', () => {
    const alteracoes = lower(sql).match(/alter table [a-z_.]+/g) ?? [];
    expect(new Set(alteracoes)).toEqual(new Set(['alter table app.geocode_point']));
    const colunas = lower(sql).match(/add column if not exists [a-z_]+/g) ?? [];
    expect(colunas.map((c) => c.split(' ').pop())).toEqual(['match_cell', 'match_lon', 'match_lat', 'match_grid_version']);
  });

  it('nenhuma tabela nova e criada e nenhum grant de tabela aparece', () => {
    expect(lower(sql)).not.toMatch(/create table/);
    expect(lower(sql)).not.toMatch(/grant (select|insert|update|delete|all)[^;]* on (table )?app\.geocode_point/);
  });

  it('o indice e parcial e cobre so pedidos ok com celula', () => {
    expect(lower(sql)).toContain(
      "create index if not exists geocode_point_match_cell_idx on app.geocode_point (match_grid_version, match_cell) include (subject_id, match_lon, match_lat) where subject_kind = 'request' and state = 'ok' and match_cell is not null;",
    );
  });

  it('o desfazer remove colunas, gatilho, funcoes, indice e o registro da versao, sem tocar exact_point', () => {
    const d = lower(down);
    expect(d).toContain('drop trigger if exists geocode_point_match_biu');
    expect(d).toContain('drop function if exists private.geocode_point_set_match()');
    expect(d).toContain('drop index if exists app.geocode_point_match_cell_idx');
    expect(d).toContain('drop column if exists match_cell');
    expect(d).toContain("delete from ops.schema_migration where version = '20261112120500';");
    expect(d).not.toMatch(/exact_point\s*(drop|=|set)/);
    expect(d).not.toMatch(/drop (table|column if exists exact_point)/);
  });
});

// Fixture dourada: a grade recalculada em JavaScript (formula da v1) tem de bater com os valores gravados.
const LAT0 = -35000000;
const LON0 = -75000000;
const DLAT = 4497;
function gradeJs(lon, lat) {
  const latU = Math.round(lat * 1e6);
  const lonU = Math.round(lon * 1e6);
  const row = Math.floor((latU - LAT0) / DLAT);
  const latC = (LAT0 + (row + 0.5) * DLAT) / 1e6;
  const dlon = Math.round(DLAT / Math.cos(latC * (Math.PI / 180)));
  const col = Math.floor((lonU - LON0) / dlon);
  return {
    cell: row * 65536 + col,
    c_lat: (LAT0 + row * DLAT + DLAT / 2) / 1e6,
    c_lon: (LON0 + col * dlon + dlon / 2) / 1e6,
  };
}

describe('T-DOUR fixture dourada (formula independente, sem banco)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/geo-match-point-dourados.json', import.meta.url), 'utf8'));

  it('tem 30 coordenadas, com os extremos e a fronteira de linha', () => {
    expect(fixture).toHaveLength(30);
    expect(fixture.some((f) => f.lon === -74 && f.lat === -34)).toBe(true);
    expect(fixture.some((f) => f.lon === -34 && f.lat === 6)).toBe(true);
    expect(fixture.some((f) => f.lat === -30.503)).toBe(true);
    expect(fixture.some((f) => f.lat === -30.503001)).toBe(true);
  });

  it('cada entrada bate com a formula recalculada', () => {
    for (const f of fixture) {
      expect(gradeJs(f.lon, f.lat)).toEqual({ cell: f.cell, c_lat: f.c_lat, c_lon: f.c_lon });
    }
  });

  it('a fronteira de linha: k e k-1 (desenho §8, CA-09)', () => {
    const acima = fixture.find((f) => f.lat === -30.503);
    const abaixo = fixture.find((f) => f.lat === -30.503001);
    expect(Math.floor(acima.cell / 65536)).toBe(1000);
    expect(Math.floor(abaixo.cell / 65536)).toBe(999);
  });

  it('erro maximo medido na esfera fica abaixo de 355 m para as 30 coordenadas', () => {
    const R = 6371008.8;
    const k = Math.PI / 180;
    const hav = (a, b, c, d) => {
      const dl = (d - b) * k;
      const dn = (c - a) * k;
      const h = Math.sin(dl / 2) ** 2 + Math.cos(b * k) * Math.cos(d * k) * Math.sin(dn / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };
    for (const f of fixture) {
      expect(hav(f.lon, f.lat, f.c_lon, f.c_lat)).toBeLessThanOrEqual(355);
    }
  });
});
