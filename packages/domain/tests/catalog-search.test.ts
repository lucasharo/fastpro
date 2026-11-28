// H-019 | Busca de servico com sinonimos (docs/factory/64-DESENHO-H019.md, §1.2, §3, §5.1 T-H019-02/03).
// Logica pura, sem banco e sem rede. Dados sinteticos.
import { describe, it, expect } from 'vitest';
import {
  buildCatalogSearchResponse,
  CATALOG_SEARCH_BODY_LIMIT_BYTES,
  CATALOG_SEARCH_DB_TIMEOUT_MS,
  CATALOG_SEARCH_FIELDS,
  CATALOG_SEARCH_PATH,
  CATALOG_SEARCH_QUERY_MAX,
  CATALOG_SEARCH_QUERY_MIN,
  CATALOG_SEARCH_RATE,
  CATALOG_SEARCH_RESULTS_MAX,
  catalogSearchError,
  normalizeCatalogQuery,
  parseCatalogSearchBody,
  projectCatalogSearchRows,
} from '../src/catalog/index.js';

const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 2,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Servico sintetico',
  modality: 'presencial',
  regulated: false,
};

describe('catalog search: constantes do desenho', () => {
  it('caminho, limites e limite de taxa batem com o desenho §3.1 e §1.2', () => {
    expect(CATALOG_SEARCH_PATH).toBe('/v1/catalog/service-search');
    expect(CATALOG_SEARCH_BODY_LIMIT_BYTES).toBe(1024);
    expect(CATALOG_SEARCH_QUERY_MIN).toBe(2);
    expect(CATALOG_SEARCH_QUERY_MAX).toBe(80);
    expect(CATALOG_SEARCH_RESULTS_MAX).toBe(10);
    expect(CATALOG_SEARCH_DB_TIMEOUT_MS).toBe(2000);
    expect(CATALOG_SEARCH_RATE).toEqual({ spanS: 60, bucketS: 10, limit: 90 });
  });

  it('lista publica tem exatamente os 7 campos da lista de permissao (T-H018-06)', () => {
    expect([...CATALOG_SEARCH_FIELDS]).toEqual([
      'group_id',
      'group_name',
      'group_position',
      'service_id',
      'service_name',
      'modality',
      'regulated',
    ]);
  });
});

describe('normalizeCatalogQuery (CA-06: termo curto nunca vai ao banco)', () => {
  it('aceita 2 caracteres e 80 caracteres', () => {
    expect(normalizeCatalogQuery('ao')).toEqual({ ok: true, q: 'ao' });
    expect(normalizeCatalogQuery('a'.repeat(80))).toEqual({ ok: true, q: 'a'.repeat(80) });
  });

  it('recusa vazio, 1 caractere, 81 caracteres, so espacos e nao-string', () => {
    for (const bruto of ['', 'a', ' a ', 'a'.repeat(81), '   ', null, 12, undefined, ['ab']]) {
      expect(normalizeCatalogQuery(bruto)).toEqual({ ok: false, code: 'entrada_invalida' });
    }
  });

  it('recusa termo so de pontuacao, mas aceita o que tem letra ou digito', () => {
    expect(normalizeCatalogQuery('%%')).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeCatalogQuery('--')).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeCatalogQuery('"\'')).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeCatalogQuery('1a')).toEqual({ ok: true, q: '1a' });
  });

  it('normaliza NFC, remove controles e colapsa espacos sem mudar acento nem caixa', () => {
    expect(normalizeCatalogQuery('  Pedreiro\u0000\t  Ampliação  ')).toEqual({
      ok: true,
      q: 'Pedreiro Ampliação',
    });
    // NFD (e + acento combinante) vira NFC: mesmo comprimento de caracteres visiveis.
    expect(normalizeCatalogQuery('Ampliação')).toEqual({ ok: true, q: 'Ampliação' });
  });

  it('conta codepoints, nao unidades de codigo (emoji de 2 unidades)', () => {
    expect(normalizeCatalogQuery('a😀')).toEqual({ ok: true, q: 'a😀' });
  });
});

describe('parseCatalogSearchBody (desenho §3.1)', () => {
  it('aceita {q} e devolve o termo normalizado', () => {
    const t = '{"q":"  empreit  "}';
    expect(parseCatalogSearchBody(t, Buffer.byteLength(t))).toEqual({ ok: true, q: 'empreit' });
  });

  it('recusa chave extra, corpo fora de objeto, JSON invalido, q ausente e corpo acima de 1 KB', () => {
    const casos = [
      '{"q":"ab","x":1}',
      '["ab"]',
      'null',
      '"ab"',
      '{"q":"ab"',
      '{}',
      '{"q":1}',
    ];
    for (const t of casos) {
      expect(parseCatalogSearchBody(t, Buffer.byteLength(t))).toEqual({
        ok: false,
        code: 'entrada_invalida',
      });
    }
    const grande = `{"q":"${'a'.repeat(1100)}"}`;
    expect(parseCatalogSearchBody(grande, Buffer.byteLength(grande))).toEqual({
      ok: false,
      code: 'entrada_invalida',
    });
    // Mesmo que o texto caiba, o tamanho lido acima do limite recusa.
    expect(parseCatalogSearchBody('{"q":"ab"}', 1025)).toEqual({ ok: false, code: 'entrada_invalida' });
  });

  it('nao interpreta % _ \\ como padrao: o texto volta como digitado', () => {
    const t = '{"q":"a_b%c\\\\d"}';
    expect(parseCatalogSearchBody(t, Buffer.byteLength(t))).toEqual({
      ok: true,
      q: 'a_b%c\\d',
    });
  });
});

describe('projectCatalogSearchRows (T-H019-02: so os 7 campos, sem termo nem sinonimo)', () => {
  it('projeta uma linha com campos extras e devolve so os 7 campos, na ordem fixa', () => {
    const r = projectCatalogSearchRows([
      { ...LINHA, term: 'empreiteiro', term_norm: 'empreiteiro', rnk: 4, council_body: 'x' },
    ]);
    expect(r).toEqual({ ok: true, items: [LINHA] });
    if (!r.ok) throw new Error('esperado ok');
    expect(Object.keys(r.items[0] ?? {})).toEqual([...CATALOG_SEARCH_FIELDS]);
  });

  it('falha com tipo errado, campo ausente, linha nao-objeto ou mais de 10 linhas', () => {
    expect(projectCatalogSearchRows([{ ...LINHA, group_position: '2' }])).toEqual({ ok: false });
    expect(projectCatalogSearchRows([{ ...LINHA, group_position: 2.5 }])).toEqual({ ok: false });
    expect(projectCatalogSearchRows([{ ...LINHA, regulated: 'nao' }])).toEqual({ ok: false });
    const sem = { ...LINHA } as Record<string, unknown>;
    delete sem['service_name'];
    expect(projectCatalogSearchRows([sem])).toEqual({ ok: false });
    expect(projectCatalogSearchRows([null])).toEqual({ ok: false });
    expect(projectCatalogSearchRows('x' as unknown as unknown[])).toEqual({ ok: false });
    expect(projectCatalogSearchRows(Array.from({ length: 11 }, () => LINHA))).toEqual({ ok: false });
  });

  it('aceita exatamente 10 linhas', () => {
    const r = projectCatalogSearchRows(Array.from({ length: 10 }, () => LINHA));
    expect(r.ok && r.items.length).toBe(10);
  });
});

describe('buildCatalogSearchResponse e erro (CA-06, CA-07)', () => {
  it('lista vazia vira "vazio/sem_resultado", separado de erro', () => {
    expect(buildCatalogSearchResponse([])).toEqual({
      status: 'vazio',
      code: 'sem_resultado',
      items: [],
    });
  });

  it('lista com itens vira "ok"', () => {
    expect(buildCatalogSearchResponse([LINHA])).toEqual({ status: 'ok', items: [LINHA] });
  });

  it('erro so carrega o codigo fixo, sem mensagem', () => {
    expect(catalogSearchError('limite')).toEqual({ status: 'erro', code: 'limite' });
    expect(Object.keys(catalogSearchError('falha'))).toEqual(['status', 'code']);
  });
});
