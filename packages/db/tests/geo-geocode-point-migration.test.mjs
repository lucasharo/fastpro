// H-021 | Teste estatico da migracao app.geocode_point (docs/factory/68-DESENHO-H021.md, §2, §7 G-05 e G-I28b).
// Sem banco e sem rede: le o arquivo SQL. A validacao real dos CHECKs no Postgres (G-05, SQL direto como dono
// e como app_system/app_api) fica no teste de banco da proxima fatia, quando o banco de desenvolvimento estiver
// disponivel. Executar: pnpm test (vitest).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111370000_geo_create_geocode_point.sql';
const DOWN = '20261111370000_geo_create_geocode_point.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// SQL sem linhas de comentario (o cabecalho cita as funcoes futuras, de proposito).
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const tabela = (nome) => {
  const inicio = lower(sql).indexOf(`create table if not exists ${nome} (`);
  if (inicio < 0) return '';
  const fim = lower(sql).indexOf(');', inicio);
  return lower(sql).slice(inicio, fim);
};
const geocodePoint = tabela('app.geocode_point');
const geocodeBudget = tabela('app.geocode_budget');

describe('T-H021-04a CHECK do selo permanente e do estado (CA-4, G-05 estatico)', () => {
  it('a tabela existe e o ponto exige o selo permanente', () => {
    expect(geocodePoint).not.toBe('');
    expect(geocodePoint).toContain(
      "constraint geocode_point_selo_permanente check (exact_point is null or geocode_mode = 'permanent')",
    );
  });

  it('o modo aceita so nulo ou permanent (nao existe temporary no dominio)', () => {
    expect(geocodePoint).toContain("geocode_mode text check (geocode_mode is null or geocode_mode = 'permanent')");
    expect(geocodePoint).not.toContain("'temporary'");
  });

  it('ponto e estado andam juntos: ok se e so se houver ponto', () => {
    expect(geocodePoint).toContain("constraint geocode_point_estado_ponto check ((state = 'ok') = (exact_point is not null))");
  });

  it('estado ok exige precisao gravada', () => {
    expect(geocodePoint).toContain("check (state <> 'ok' or precision is not null)");
  });

  it('o estado aceita so os quatro valores do desenho', () => {
    expect(geocodePoint).toContain(
      "state text not null check (state in ('aguardando', 'reservado', 'ok', 'sem_resultado'))",
    );
  });
});

describe('T-H021-04b caixa do Brasil e forma do ponto (G-05 estatico)', () => {
  it('o CHECK da caixa usa a longitude e a latitude do desenho, sem inverter eixos', () => {
    expect(geocodePoint).toContain(
      'extensions.st_x(exact_point::extensions.geometry) between -74.0 and -34.0',
    );
    expect(geocodePoint).toContain(
      'extensions.st_y(exact_point::extensions.geometry) between -34.0 and 6.0',
    );
  });

  it('o ponto e geografia WGS84 no schema extensions', () => {
    expect(geocodePoint).toContain('exact_point extensions.geography(point, 4326)');
  });
});

describe('T-H021-04c teto por pedido no proprio banco (G-04 por SQL)', () => {
  it('o orcamento por assunto recusa mais de 3 chamadas para um pedido', () => {
    expect(geocodeBudget).toContain(
      "constraint geocode_budget_teto_pedido check (subject_kind <> 'request' or calls <= 3)",
    );
    expect(geocodeBudget).toContain('calls smallint not null default 0 check (calls >= 0)');
  });

  it('a unicidade (assunto, texto) garante uma linha por endereco do pedido', () => {
    expect(geocodePoint).toContain(
      'constraint geocode_point_subject_hash_key unique (subject_kind, subject_id, address_hash)',
    );
  });
});

describe('T-H021-06 proveniencia e ausencia de coordenada fora da tabela (I-28, CA-6 estatico)', () => {
  it('a migracao cria exatamente as duas tabelas e nenhuma outra', () => {
    const criadas = lower(sql).match(/create table if not exists [a-z_.]+/g) ?? [];
    expect(criadas.sort()).toEqual([
      'create table if not exists app.geocode_budget',
      'create table if not exists app.geocode_point',
    ]);
  });

  it('nenhuma coluna de latitude, longitude ou identificador do provedor existe nas tabelas', () => {
    for (const corpo of [geocodePoint, geocodeBudget]) {
      expect(corpo).not.toMatch(/\b(lat|lon|latitude|longitude|mapbox_id|geom)\b/);
    }
  });

  it('nao ha grant de DML nem de leitura direta para papel nenhum nestas tabelas', () => {
    expect(lower(sql)).not.toMatch(/grant\s[^;]*app\.geocode_(point|budget)/);
    // O papel de servico do Supabase e o quarto da lista (nome omitido aqui de proposito: ver check:secrets).
    expect(lower(sql)).toMatch(
      /revoke all on app\.geocode_point, app\.geocode_budget\s+from public, anon, authenticated, \w+, app_api, app_system/,
    );
  });

  it('RLS habilitada e forcada nas duas tabelas, sem politicas', () => {
    for (const t of ['app.geocode_point', 'app.geocode_budget']) {
      expect(lower(sql)).toContain(`alter table ${t} enable row level security;`);
      expect(lower(sql)).toContain(`alter table ${t} force row level security;`);
    }
    expect(lower(sql)).not.toMatch(/create policy/);
  });
});

describe('T-H021-07 rollback e nome da migracao', () => {
  it('o nome segue o padrao de versao e o desfazer remove as duas tabelas e o registro', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z_]+\.sql$/);
    const d = lower(down);
    expect(d).toContain('drop table if exists app.geocode_budget;');
    expect(d).toContain('drop table if exists app.geocode_point;');
    expect(d).toContain("delete from ops.schema_migration where version = '20261111370000';");
    expect(d.startsWith('-- desfaz') || d.includes('begin;')).toBe(true);
  });
});
