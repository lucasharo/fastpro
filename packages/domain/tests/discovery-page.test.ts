// Issue 68 (H-055) | Contrato puro da lista (docs/factory/153-DESENHO-H055.md, §3.2 a §3.4; T-H055-04, T-H055-05, T-H055-22).
import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_ITEM_KEYS,
  buildDiscoveryItem,
  parseDiscoveryQuery,
  type RequestDiscoveryItem,
} from '../src/discovery/index.js';

const ITEM: RequestDiscoveryItem = {
  id: '7f0c2d1e-3a4b-4c5d-8e6f-9a0b1c2d3e4f',
  service_id: 'a1b2c3d4-0000-4000-8000-000000000001',
  service_name: 'Encanador',
  urgency: 'imediato',
  description: 'Vazamento na pia da cozinha.',
  public_label: 'Campinas - SP',
  distance_km: 1.5,
  modality: 'presencial',
  published_at: '2026-11-19T10:00:00.000Z',
  acceptance_deadline_at: '2026-11-20T10:00:00.000Z',
  has_photos: false,
};

describe('lista fechada do item (T-H055-22)', () => {
  it('tem exatamente as 11 chaves, nesta ordem', () => {
    expect([...DISCOVERY_ITEM_KEYS]).toEqual([
      'id',
      'service_id',
      'service_name',
      'urgency',
      'description',
      'public_label',
      'distance_km',
      'modality',
      'published_at',
      'acceptance_deadline_at',
      'has_photos',
    ]);
    expect(DISCOVERY_ITEM_KEYS).toHaveLength(11);
  });

  it('buildDiscoveryItem copia so as chaves fechadas e descarta campos extras da origem', () => {
    const origem = {
      ...ITEM,
      client_name: 'Nome do cliente',
      email: 'x@example.com',
      exact_point: 'POINT(-47.0 -22.9)',
      match_cell: 'cell-1',
      distance_m: 1500,
    } as unknown as RequestDiscoveryItem;
    const item = buildDiscoveryItem(origem);
    expect(Object.keys(item)).toEqual([...DISCOVERY_ITEM_KEYS]);
    expect(item).toEqual(ITEM);
    expect(item).not.toBe(origem);
  });

  it('preserva null em public_label e distance_km do item online', () => {
    const online = buildDiscoveryItem({ ...ITEM, modality: 'online', distance_km: null, public_label: null });
    expect(online.distance_km).toBeNull();
    expect(online.public_label).toBeNull();
    expect(Object.keys(online)).toHaveLength(11);
  });
});

describe('query da rota (T-H055-04, T-H055-05, T-H055-06)', () => {
  it('sem parametros usa limit 50 e cursor nulo', () => {
    expect(parseDiscoveryQuery([])).toEqual({ ok: true, limit: 50, cursor: null });
  });

  it('aceita limit 1, 50 e 200', () => {
    for (const limit of ['1', '50', '200']) {
      expect(parseDiscoveryQuery([['limit', limit]])).toEqual({ ok: true, limit: Number(limit), cursor: null });
    }
  });

  it('recusa limit 0, 201, abc, 1.5, vazio, negativo, sinal, espaco e notacao cientifica', () => {
    for (const limit of ['0', '201', '999', 'abc', '1.5', '', '-1', '+1', ' 1', '1e2', '0x10']) {
      expect(parseDiscoveryQuery([['limit', limit]])).toEqual({ ok: false, code: 'parametro_invalido' });
    }
  });

  it('recusa limit repetido e cursor repetido', () => {
    expect(parseDiscoveryQuery([['limit', '10'], ['limit', '20']])).toEqual({ ok: false, code: 'parametro_invalido' });
    expect(parseDiscoveryQuery([['cursor', 'a'], ['cursor', 'b']])).toEqual({ ok: false, code: 'parametro_invalido' });
  });

  it('recusa parametro desconhecido, inclusive com outra grafia de caixa', () => {
    for (const nome of ['sort', 'filter', 'LIMIT', 'Cursor', 'page']) {
      expect(parseDiscoveryQuery([[nome, '1']])).toEqual({ ok: false, code: 'parametro_invalido' });
    }
  });

  it('cursor vazio ou longo passa para o decifrador (que responde cursor_invalido), nao parametro_invalido', () => {
    expect(parseDiscoveryQuery([['cursor', '']])).toEqual({ ok: true, limit: 50, cursor: '' });
    expect(parseDiscoveryQuery([['cursor', 'A'.repeat(513)]])).toEqual({ ok: true, limit: 50, cursor: 'A'.repeat(513) });
  });

  it('aceita limit e cursor juntos', () => {
    expect(parseDiscoveryQuery([['limit', '10'], ['cursor', 'abc']])).toEqual({ ok: true, limit: 10, cursor: 'abc' });
  });
});
