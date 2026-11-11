// Testes offline da semente do catalogo (H-018, 53-DESENHO-H018 §6.1: T-H018-01 a 09). Sem banco e sem rede.
// Executar: pnpm test (vitest). As contagens medidas abaixo sao o registro do DEV (relato da #31).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogNorm, validateSeed, parseReg, buildSeed } from '../scripts/lib/catalog-seed.mjs';
import { generate, SEED_PATH, SOURCE_PATH } from '../scripts/catalog-build-seed.mjs';
import { ROLE_PERMISSIONS } from '../../access-matrix/src/index.ts';

// Contagens medidas em docs/factory/06-CATALOGO-PROPOSTO.md (nao estimadas).
export const MEASURED = Object.freeze({
  rows_read: 580,
  cross_refs_discarded: 1,
  repeated_names: 5,
  services_total: 575,
  services_active: 504,
  council_inactive: 71,
  regulated: 196,
  sensitive: 26,
  synonyms_total: 1253,
});

const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
const markdown = readFileSync(SOURCE_PATH, 'utf8');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('T-H018-01 estrutura da semente', () => {
  it('tem 25 grupos g01..g25, posicoes 1..25, nomes unicos e na ordem do 06', () => {
    expect(seed.groups).toHaveLength(25);
    expect(seed.groups.map((g) => g.key)).toEqual(
      Array.from({ length: 25 }, (_, i) => `g${String(i + 1).padStart(2, '0')}`),
    );
    expect(seed.groups.map((g) => g.position)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const names = seed.groups.map((g) => g.name);
    expect(new Set(names.map(catalogNorm)).size).toBe(25);
    const headers = [...markdown.matchAll(/^## G\d{2}\. (.+)$/gm)].map((m) => m[1].trim());
    expect(names).toEqual(headers);
  });

  it('servicos apontam para grupo existente, com modalidade valida, nome unico por grupo e regulated booleano', () => {
    const groupKeys = new Set(seed.groups.map((g) => g.key));
    const perGroup = new Map();
    for (const s of seed.services) {
      expect(groupKeys.has(s.group_key)).toBe(true);
      expect(['presencial', 'online', 'ambos']).toContain(s.modality);
      expect(typeof s.regulated).toBe('boolean');
      const set = perGroup.get(s.group_key) ?? new Set();
      expect(set.has(catalogNorm(s.name))).toBe(false);
      set.add(catalogNorm(s.name));
      perGroup.set(s.group_key, set);
    }
  });
});

describe('T-H018-02 conversao e contagens medidas', () => {
  it('converte PR/ON/HI em modalidade, descarta a referencia cruzada e trata nomes repetidos', () => {
    const { stats } = buildSeed(markdown);
    expect(stats.rows_read).toBe(MEASURED.rows_read);
    expect(stats.cross_refs_discarded).toBe(MEASURED.cross_refs_discarded);
    expect(stats.repeated_names).toHaveLength(MEASURED.repeated_names);
    expect(seed.services).toHaveLength(MEASURED.services_total);
    expect(seed.services.some((s) => s.synonyms.some((t) => /^ver G\d{2}$/.test(t)))).toBe(false);
    for (const name of ['Despachante veicular', 'Nutricionista', 'Corretor de imóveis', 'Fotografia imobiliária', 'Cuidador de idosos']) {
      const hits = seed.services.filter((s) => catalogNorm(s.name) === catalogNorm(name));
      expect(hits).toHaveLength(1);
    }
    const veterinario = seed.services.filter((s) => catalogNorm(s.name) === 'veterinario');
    expect(veterinario).toHaveLength(1);
    expect(veterinario[0].group_key).toBe('g12');
  });

  it('marca REG e REG? como regulado, SENS como sensivel, e conta sensiveis e regulados medidos', () => {
    expect(parseReg('REG? (SENS)')).toEqual({ regulated: true, sensitive: true, council_body: null });
    expect(parseReg('— (SENS)')).toEqual({ regulated: false, sensitive: true, council_body: null });
    expect(parseReg('REG (autorização/CNH D, SENS)')).toEqual({
      regulated: true,
      sensitive: true,
      council_body: null,
    });
    expect(seed.services.filter((s) => s.sensitive)).toHaveLength(MEASURED.sensitive);
    expect(seed.services.filter((s) => s.regulated)).toHaveLength(MEASURED.regulated);
    expect(seed.services.reduce((n, s) => n + s.synonyms.length, 0)).toBe(MEASURED.synonyms_total);
  });

  it('registra as contagens medidas de servicos e de inativos por conselho', () => {
    expect(seed.services.filter((s) => s.active)).toHaveLength(MEASURED.services_active);
    expect(seed.services.filter((s) => s.council_body !== null)).toHaveLength(MEASURED.council_inactive);
  });
});

describe('T-H018-03 regra do conselho', () => {
  it('todo item com orgao de conselho esta inativo; nenhum sem orgao esta inativo; todo grupo tem servico ativo', () => {
    for (const s of seed.services) {
      if (s.council_body !== null) {
        expect(s.active, s.key).toBe(false);
        expect(s.regulated, s.key).toBe(true);
      } else {
        expect(s.active, s.key).toBe(true);
      }
    }
    for (const g of seed.groups) {
      expect(seed.services.some((s) => s.group_key === g.key && s.active), g.key).toBe(true);
    }
  });

  it('conselhos profissionais acrescentados pelo Orquestrador (CFP, CFTA, CORE) ficam inativos; reguladores ficam ativos', () => {
    const tags = seed.services.filter((s) => s.council_body !== null).map((s) => s.council_body);
    for (const t of ['CFP', 'CFTA', 'CORE']) {
      expect(tags.some((x) => x.split(/[\s/]+/).includes(t)), t).toBe(true);
    }
    for (const t of ['CVM', 'SUSEP', 'DRT']) {
      expect(tags.some((x) => x.split(/[\s/]+/).includes(t)), t).toBe(false);
    }
  });
});

describe('T-H018-04 reexecucao reproduzivel', () => {
  it('regenerar a partir do 06 produz o mesmo texto (mesmo checksum) do JSON versionado', () => {
    const { text, errors } = generate();
    expect(errors).toEqual([]);
    expect(text).toBe(readFileSync(SEED_PATH, 'utf8'));
  });
});

describe('T-H018-05 normalizacao (paridade com private.catalog_norm)', () => {
  it('produz os mesmos resultados fixos da funcao SQL (acento, caixa, espacos)', () => {
    const pairs = [
      ['  Reformas   e  Construção ', 'reformas e construcao'],
      ['ÁGUA', 'agua'],
      ['Pé de Moleque', 'pe de moleque'],
      ['Ação', 'acao'],
      ['Lâmpada  LED', 'lampada led'],
      ['Ç', 'c'],
    ];
    for (const [input, expected] of pairs) {
      expect(catalogNorm(input), input).toBe(expected);
    }
  });
});

describe('T-H018-07 estatico das migracoes do catalogo', () => {
  const m1 = readFileSync(
    new URL('../../../supabase/migrations/20261111200000_catalog_create_service_catalog.sql', import.meta.url),
    'utf8',
  );
  const m2 = readFileSync(
    new URL('../../../supabase/migrations/20261111210000_catalog_create_seed_apply.sql', import.meta.url),
    'utf8',
  );
  // Somente codigo: comentarios (linhas com --) sao ignorados nas verificacoes.
  const code = (text) =>
    text
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
  const sql = code(`${m1}\n${m2}`);

  it('cada tabela do catalogo habilita e forca RLS', () => {
    const c1 = code(m1);
    for (const t of ['service_group', 'service', 'service_synonym', 'catalog_revision', 'catalog_seed_run']) {
      expect(c1).toMatch(new RegExp(`alter table app\\.${t}\\s+enable row level security`));
      expect(c1).toMatch(new RegExp(`alter table app\\.${t}\\s+force row level security`));
    }
  });

  it('nenhum grant a anon, authenticated ou PUBLIC; nenhum grant de escrita a app_api; nenhum delete concedido', () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bto\b[^;]*app_api/i);
    expect(sql).not.toMatch(/grant[^;]*\bdelete\b/i);
  });

  it('funcoes security definer usam set search_path = empty', () => {
    const blocks = sql.split(/create or replace function /i).slice(1);
    const definers = blocks.filter((b) => /security definer/i.test(b.split('$$')[0]));
    expect(definers.length).toBeGreaterThan(0);
    for (const b of definers) {
      expect(b.split('$$')[0]).toMatch(/set search_path = ''/);
    }
  });

  it('a aplicacao da semente nunca usa on conflict do update', () => {
    expect(code(m2)).not.toMatch(/on conflict[^;]*do update/i);
  });
});

describe('T-H018-08 matriz de acesso', () => {
  it('catalog.manage existe somente no papel superadmin', () => {
    const withPerm = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) => perms.includes('catalog.manage'))
      .map(([role]) => role);
    expect(withPerm).toEqual(['superadmin']);
  });
});

describe('T-H018-09 validador rejeita entradas invalidas', () => {
  it('aceita a semente valida', () => {
    expect(validateSeed(seed)).toEqual([]);
  });

  it('rejeita nome vazio', () => {
    const s = clone(seed);
    s.services[0].name = '';
    expect(validateSeed(s).length).toBeGreaterThan(0);
  });

  it('rejeita modalidade invalida', () => {
    const s = clone(seed);
    s.services[0].modality = 'remoto';
    expect(validateSeed(s).some((e) => e.includes('modalidade invalida'))).toBe(true);
  });

  it('rejeita group_key inexistente', () => {
    const s = clone(seed);
    s.services[0].group_key = 'g99';
    expect(validateSeed(s).some((e) => e.includes('group_key inexistente'))).toBe(true);
  });

  it('rejeita chave de servico duplicada', () => {
    const s = clone(seed);
    s.services[1].key = s.services[0].key;
    expect(validateSeed(s).some((e) => e.includes('chave de servico duplicada'))).toBe(true);
  });

  it('rejeita grupo ativo sem servico ativo', () => {
    const s = clone(seed);
    s.services = s.services.filter((x) => x.group_key !== 'g25');
    expect(validateSeed(s).some((e) => e.includes('grupo sem servico ativo'))).toBe(true);
  });

  it('rejeita council_body sem regulated', () => {
    const s = clone(seed);
    s.services[0].council_body = 'CRM';
    s.services[0].regulated = false;
    s.services[0].active = false;
    expect(validateSeed(s).some((e) => e.includes('council_body sem regulated'))).toBe(true);
  });
});
