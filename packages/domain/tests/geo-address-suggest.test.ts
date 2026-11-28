// H-020 | Autocomplete de endereco temporario (docs/factory/56-DESENHO-H020.md, §1, §2, §4, §5).
// Logica pura, sem I/O e sem rede. Cobre normalizacao da consulta, corpo, rotulos, limites,
// decisao de cota e codigos de falha do provedor.
import { describe, it, expect } from 'vitest';
import {
  ADDRESS_BODY_LIMIT_BYTES,
  ADDRESS_ITEMS_MAX,
  ADDRESS_LABEL_MAX,
  ADDRESS_QUERY_MAX,
  ADDRESS_QUERY_MIN,
  ADDRESS_SUGGEST_PATH,
  MAPBOX_TEMP_CAPS,
  MAPBOX_TEMP_HARD_MAX,
  SUGGEST_RATE_IP,
  SUGGEST_RATE_PRINCIPAL,
  SUGGEST_RETRY_AFTER_S,
  decideQuotaTake,
  labelFromProperties,
  mapSuggestFeatures,
  normalizeAddressQuery,
  parseAddressSuggestBody,
  providerErrorCode,
  validateQuotaCaps,
} from '../src/geo/index.js';

describe('T-H020-01 normalizacao da consulta (CA-07, CA-12)', () => {
  it('colapsa espacos, remove controles e aplica NFC', () => {
    expect(normalizeAddressQuery('  Rua   das\tFlores\n 10 ')).toEqual({
      ok: true,
      q: 'Rua das Flores 10',
    });
    // "e" + combinacao aguda vira "é" composto (NFC).
    expect(normalizeAddressQuery('Rua José')).toEqual({ ok: true, q: 'Rua José' });
  });

  it('remove caracteres de formatacao invisiveis', () => {
    expect(normalizeAddressQuery('Av​ Brasil 1')).toEqual({ ok: true, q: 'Av Brasil 1' });
  });

  it('recusa menos de 3 e mais de 120 caracteres (contando caracteres, nao bytes)', () => {
    expect(normalizeAddressQuery('ab')).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeAddressQuery('   a  ')).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeAddressQuery('a'.repeat(ADDRESS_QUERY_MAX + 1))).toEqual({
      ok: false,
      code: 'entrada_invalida',
    });
    expect(normalizeAddressQuery('a'.repeat(ADDRESS_QUERY_MAX))).toMatchObject({ ok: true });
    expect(normalizeAddressQuery('a'.repeat(ADDRESS_QUERY_MIN))).toMatchObject({ ok: true });
  });

  it('recusa valor que nao e texto', () => {
    expect(normalizeAddressQuery(42)).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(normalizeAddressQuery(undefined)).toEqual({ ok: false, code: 'entrada_invalida' });
  });
});

describe('T-H020-02 corpo do pedido (CA-01, §2.1)', () => {
  it('aceita so q e context conhecidos', () => {
    const body = JSON.stringify({ q: 'Rua Alfa', context: 'request_draft' });
    expect(parseAddressSuggestBody(body, body.length)).toEqual({
      ok: true,
      q: 'Rua Alfa',
      context: 'request_draft',
    });
  });

  it('recusa campos extras, context desconhecido, JSON invalido e corpo acima de 1 KB', () => {
    const extra = JSON.stringify({ q: 'Rua Alfa', context: 'request_draft', lat: 1 });
    expect(parseAddressSuggestBody(extra, extra.length)).toEqual({
      ok: false,
      code: 'entrada_invalida',
    });
    const ctx = JSON.stringify({ q: 'Rua Alfa', context: 'outro' });
    expect(parseAddressSuggestBody(ctx, ctx.length)).toEqual({
      ok: false,
      code: 'entrada_invalida',
    });
    expect(parseAddressSuggestBody('{nao-json', 9)).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(parseAddressSuggestBody('[]', 2)).toEqual({ ok: false, code: 'entrada_invalida' });
    expect(parseAddressSuggestBody(ctx, ADDRESS_BODY_LIMIT_BYTES + 1)).toEqual({
      ok: false,
      code: 'entrada_invalida',
    });
  });

  it('usa o caminho da rota do desenho', () => {
    expect(ADDRESS_SUGGEST_PATH).toBe('/v1/geo/address-suggest');
  });
});

describe('T-H020-03 rotulo textual, sem coordenada nem identificador (CA-03, CA-04)', () => {
  it('prefere full_address', () => {
    expect(
      labelFromProperties({ full_address: 'Rua Alfa, 10, Centro, Sao Paulo', name: 'X' }),
    ).toBe('Rua Alfa, 10, Centro, Sao Paulo');
  });

  it('sem full_address, junta name e place_formatted', () => {
    expect(labelFromProperties({ name: 'Rua Alfa', place_formatted: 'Sao Paulo, Brasil' })).toBe(
      'Rua Alfa, Sao Paulo, Brasil',
    );
    expect(labelFromProperties({ name: 'Rua Alfa' })).toBe('Rua Alfa');
  });

  it('sem texto utilizavel devolve null; rotulo acima de 200 caracteres e descartado', () => {
    expect(labelFromProperties({ full_address: '   ' })).toBeNull();
    expect(labelFromProperties({})).toBeNull();
    expect(labelFromProperties({ full_address: 'a'.repeat(ADDRESS_LABEL_MAX + 1) })).toBeNull();
  });
});

describe('T-H020-04 mapeamento da resposta do provedor (CA-03, CA-04, §5)', () => {
  it('devolve no maximo 5 itens, so com label, e descarta itens sem rotulo', () => {
    const features = [
      { id: 'a', coordinates: { latitude: -23.5, longitude: -46.6 }, properties: { full_address: 'A 1' } },
      { properties: {} },
      'lixo',
      { properties: { full_address: 'A 2', mapbox_id: 'secreto' } },
      { properties: { full_address: 'A 3' } },
      { properties: { full_address: 'A 4' } },
      { properties: { full_address: 'A 5' } },
      { properties: { full_address: 'A 6' } },
    ];
    const r = mapSuggestFeatures(features);
    expect(r).toEqual({
      ok: true,
      items: [{ label: 'A 1' }, { label: 'A 2' }, { label: 'A 3' }, { label: 'A 4' }, { label: 'A 5' }],
    });
    expect(ADDRESS_ITEMS_MAX).toBe(5);
    // Nenhuma chave alem de label, nem numero com cara de coordenada.
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/latitude|longitude|mapbox_id|coordinates|-23\.5/);
  });

  it('lista vazia e resposta valida; formato fora do esperado vira provider_shape', () => {
    expect(mapSuggestFeatures([])).toEqual({ ok: true, items: [] });
    expect(mapSuggestFeatures({ features: [] })).toEqual({ ok: false, code: 'provider_shape' });
    expect(mapSuggestFeatures(null)).toEqual({ ok: false, code: 'provider_shape' });
  });
});

describe('T-H020-05 limites de taxa (CA-07, CA-09)', () => {
  it('30 consultas por 60 s por principal e 60 por IP, com balde de 10 s e retry de 60 s', () => {
    expect(SUGGEST_RATE_PRINCIPAL).toEqual({ spanS: 60, bucketS: 10, limit: 30 });
    expect(SUGGEST_RATE_IP).toEqual({ spanS: 60, bucketS: 10, limit: 60 });
    expect(SUGGEST_RETRY_AFTER_S).toBe(60);
  });
});

describe('T-H020-06 teto mensal e decisao de cota (CA-08, §4.2)', () => {
  it('tetos do desenho: producao 70.000 alerta / 93.000 desliga; desenvolvimento 1.500 / 2.000', () => {
    expect(MAPBOX_TEMP_CAPS.producao).toEqual({ soft: 70_000, hard: 93_000 });
    expect(MAPBOX_TEMP_CAPS.desenvolvimento).toEqual({ soft: 1_500, hard: 2_000 });
    expect(MAPBOX_TEMP_HARD_MAX).toBe(99_000);
  });

  it('valida tetos: 0 <= alerta <= desliga <= 99.000, inteiros', () => {
    expect(validateQuotaCaps(70_000, 93_000)).toEqual({ ok: true });
    expect(validateQuotaCaps(93_000, 70_000)).toEqual({ ok: false });
    expect(validateQuotaCaps(0, 100_000)).toEqual({ ok: false });
    expect(validateQuotaCaps(1.5, 10)).toEqual({ ok: false });
    expect(validateQuotaCaps(0, 0)).toEqual({ ok: false });
  });

  it('reserva permitida consulta; teto atingido nao consulta e pede alerta so na primeira vez', () => {
    expect(decideQuotaTake({ ok: true, novoAlerta: false })).toEqual({
      permitido: true,
      alerta: false,
    });
    expect(decideQuotaTake({ ok: true, novoAlerta: true })).toEqual({
      permitido: true,
      alerta: true,
    });
    expect(decideQuotaTake({ ok: false, novoAlerta: false })).toEqual({
      permitido: false,
      alerta: false,
    });
  });
});

describe('T-H020-07 codigos fixos de falha do provedor (CA-10, §5)', () => {
  it('cada falha vira um codigo fixo, sem mensagem do provedor', () => {
    expect(providerErrorCode('timeout')).toBe('provider_timeout');
    expect(providerErrorCode(500)).toBe('provider_5xx');
    expect(providerErrorCode(503)).toBe('provider_5xx');
    expect(providerErrorCode(401)).toBe('provider_auth');
    expect(providerErrorCode(403)).toBe('provider_auth');
    expect(providerErrorCode(429)).toBe('provider_429');
    expect(providerErrorCode('shape')).toBe('provider_shape');
    expect(providerErrorCode(404)).toBe('provider_shape');
  });
});
