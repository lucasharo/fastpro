// Issue 68 (H-055) | Servico da descoberta (docs/factory/153-DESENHO-H055.md, §7: T-12, T-13, T-16 a T-21, T-27, T-33).
// Portas falsas em memoria: sem banco, sem rede. As regras de fronteira no banco (T-14, T-15, T-21) e o casamento
// real ficam para a fatia 5, no DEV com dados sinteticos. Aqui se prova o que o servico faz com o que recebe.
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_ITEM_KEYS,
  DISCOVERY_CURSOR_TTL_MS,
  createDiscoveryCursorCodec,
  type DiscoveryCursor,
} from '@fastpro/domain';
import type { ProfessionalRequestRow } from '@fastpro/db';
import {
  CURSOR_INVALIDO_BODY,
  DESCOBERTA_INDISPONIVEL_BODY,
  discoverRequests,
  type DiscoveryServiceDeps,
} from '../src/requests/discovery-service.js';

const PRO = '44444444-4444-4444-8444-444444444444';
const OUTRO_PRO = '55555555-5555-4555-8555-555555555555';
const AGORA = Date.UTC(2026, 10, 19, 12, 0, 0);
// Chave de teste montada por concatenacao (check:secrets): nunca um segredo real.
const CHAVE = ['chave', 'descoberta', 'h055', 'teste'].join('-') + '-0123456789abcdef0123';

const id = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function linha(n: number, extra: Partial<ProfessionalRequestRow> = {}): ProfessionalRequestRow {
  return {
    id: id(n),
    serviceId: '88888888-8888-4888-8888-888888888888',
    serviceName: 'Eletricista',
    urgency: 'imediato',
    description: `Pedido ${n}`,
    publicLabel: 'Campinas - SP',
    distanceKm: 1.5,
    modality: 'presencial',
    publishedAt: '2026-11-19T11:00:00.000Z',
    acceptanceDeadlineAt: '2026-11-26T11:00:00.000Z',
    ...extra,
  };
}

function descoberto(n: number, group: 0 | 1 = 0, key = 1500): DiscoveryCursor {
  return { group, key, requestId: id(n) };
}

interface Fake {
  readonly deps: DiscoveryServiceDeps;
  readonly chamadas: { store: unknown[]; projection: unknown[]; photos: unknown[] };
  readonly relogio: { leituras: number; agora: number };
  descobertos: DiscoveryCursor[];
  projetadas: ProfessionalRequestRow[];
  comFoto: Set<string>;
  falha: { store: boolean; projection: boolean; photos: boolean };
}

function fabrica(): Fake {
  const chamadas = { store: [] as unknown[], projection: [] as unknown[], photos: [] as unknown[] };
  const relogio = { leituras: 0, agora: AGORA };
  const fake: Fake = {
    chamadas,
    relogio,
    descobertos: [],
    projetadas: [],
    comFoto: new Set<string>(),
    falha: { store: false, projection: false, photos: false },
    deps: undefined as unknown as DiscoveryServiceDeps,
  };
  const deps: DiscoveryServiceDeps = {
    cursor: createDiscoveryCursorCodec(CHAVE),
    clock: {
      nowMs: () => {
        relogio.leituras += 1;
        return relogio.agora;
      },
    },
    store: {
      discover: async (entrada) => {
        chamadas.store.push(entrada);
        if (fake.falha.store) throw new Error('falha simulada');
        return fake.descobertos;
      },
    },
    projection: {
      project: async (prof, ids, at) => {
        chamadas.projection.push({ prof, ids, at });
        if (fake.falha.projection) throw new Error('falha simulada');
        const porId = new Map(fake.projetadas.map((l) => [l.id, l]));
        return ids.map((i) => porId.get(i)).filter((l): l is ProfessionalRequestRow => l !== undefined);
      },
    },
    photos: {
      withPhotos: async (ids) => {
        chamadas.photos.push(ids);
        if (fake.falha.photos) throw new Error('falha simulada');
        return new Set(ids.filter((i) => fake.comFoto.has(i)));
      },
    },
  };
  fake.deps = deps;
  return fake;
}

describe('descoberta: pagina, instante e cursor (T-12, T-13, T-16 a T-18)', () => {
  it('T-12: devolve itens na ordem da descoberta, envelope completo e has_more falso quando a pagina nao enche', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(3), descoberto(1), descoberto(2)];
    f.projetadas = [linha(3), linha(1), linha(2)];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.items.map((i) => i.id)).toEqual([id(3), id(1), id(2)]);
    expect(r.body.has_more).toBe(false);
    expect(r.body.next_cursor).toBeNull();
  });

  it('T-13: uma unica leitura do relogio e o mesmo instante na guarda, na projecao e no iat do cursor', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1), linha(2)];
    const r = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    expect(f.relogio.leituras).toBe(1);
    expect(f.chamadas.store[0]).toMatchObject({ professionalId: PRO, at: new Date(AGORA), limit: 2, after: null });
    expect((f.chamadas.projection[0] as { at: Date }).at.getTime()).toBe(AGORA);
    if (r.status !== 200 || r.body.next_cursor === null) throw new Error('esperava cursor');
    // O iat e o instante da requisicao: aberto em AGORA + 24 h exatas e aceito; 1 ms depois, recusado.
    expect(f.deps.cursor.open(r.body.next_cursor, PRO, AGORA + DISCOVERY_CURSOR_TTL_MS)).toEqual(descoberto(2));
    expect(() => f.deps.cursor.open(r.body.next_cursor as string, PRO, AGORA + DISCOVERY_CURSOR_TTL_MS + 1)).toThrow();
  });

  it('T-16 (A-4): item que some entre as leituras e descartado; o cursor segue o ultimo id devolvido pela descoberta', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1)]; // o pedido 2 encerrou entre as duas leituras
    const r = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    if (r.status !== 200 || r.body.next_cursor === null) throw new Error('esperava 200 com cursor');
    expect(r.body.items.map((i) => i.id)).toEqual([id(1)]);
    expect(r.body.has_more).toBe(true);
    expect(f.deps.cursor.open(r.body.next_cursor, PRO, AGORA)).toEqual(descoberto(2));
  });

  it('T-17: a ordem da descoberta (grupo presencial por distancia, depois online) e preservada na pagina', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(4, 0, 500), descoberto(2, 0, 1000), descoberto(7, 1, 0)];
    f.projetadas = [
      linha(4, { distanceKm: 0.5 }),
      linha(2, { distanceKm: 1 }),
      linha(7, { modality: 'online', distanceKm: null, publicLabel: null }),
    ];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.items.map((i) => i.id)).toEqual([id(4), id(2), id(7)]);
  });

  it('T-18: a segunda pagina recebe o cursor decifrado como "after", sem repeticao', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1), linha(2)];
    const primeira = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    if (primeira.status !== 200 || primeira.body.next_cursor === null) throw new Error('esperava cursor');

    f.descobertos = [descoberto(3)];
    f.projetadas = [linha(3)];
    const segunda = await discoverRequests(PRO, { limit: 2, cursor: primeira.body.next_cursor }, f.deps);
    expect(f.chamadas.store[1]).toMatchObject({ after: descoberto(2) });
    if (segunda.status !== 200) throw new Error('esperava 200');
    expect(segunda.body.items.map((i) => i.id)).toEqual([id(3)]);
    expect(segunda.body.has_more).toBe(false);
  });
});

describe('cursor recusado nunca chega ao banco (T-07, T-08, T-09)', () => {
  it('cursor adulterado, vazio ou de outro profissional: 400 cursor_invalido e nenhuma consulta', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1), linha(2)];
    const emitida = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    if (emitida.status !== 200 || emitida.body.next_cursor === null) throw new Error('esperava cursor');
    const token = emitida.body.next_cursor;

    const trocado = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    for (const cursor of [trocado, '', 'lixo', token.slice(0, 20)]) {
      const r = await discoverRequests(PRO, { limit: 2, cursor }, f.deps);
      expect(r).toEqual({ status: 400, body: CURSOR_INVALIDO_BODY });
    }
    const deOutro = await discoverRequests(OUTRO_PRO, { limit: 2, cursor: token }, f.deps);
    expect(deOutro).toEqual({ status: 400, body: CURSOR_INVALIDO_BODY });
    expect(f.chamadas.store.length).toBe(1); // so a primeira pagina consultou o banco
  });

  it('cursor com mais de 24 h: 400 cursor_invalido', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1), linha(2)];
    const emitida = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    if (emitida.status !== 200 || emitida.body.next_cursor === null) throw new Error('esperava cursor');
    f.relogio.agora = AGORA + DISCOVERY_CURSOR_TTL_MS + 1000;
    const r = await discoverRequests(PRO, { limit: 2, cursor: emitida.body.next_cursor }, f.deps);
    expect(r).toEqual({ status: 400, body: CURSOR_INVALIDO_BODY });
  });
});

describe('itens, distancia e descricao (T-19, T-20, T-22, T-27)', () => {
  it('T-19: online sem base sai com distancia nula e modalidade online', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(9, 1, 0)];
    f.projetadas = [linha(9, { modality: 'online', distanceKm: null, publicLabel: null })];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.items[0]).toMatchObject({ modality: 'online', distance_km: null, public_label: null });
  });

  it('T-20: mesma celula da base chega como 0,5 km', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(5, 0, 500)];
    f.projetadas = [linha(5, { distanceKm: 0.5 })];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.items[0]?.distance_km).toBe(0.5);
  });

  it('T-22 (parcial): cada item tem exatamente as chaves da lista fechada, nesta ordem', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1)];
    f.projetadas = [linha(1)];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(Object.keys(r.body.items[0] ?? {})).toEqual([...DISCOVERY_ITEM_KEYS]);
  });

  it('T-27: descricao de 2.000 caracteres sai integra', async () => {
    const f = fabrica();
    const texto = 'a'.repeat(2000);
    f.descobertos = [descoberto(1)];
    f.projetadas = [linha(1, { description: texto })];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.items[0]?.description).toBe(texto);
  });
});

describe('has_photos com vinculo seguro (T-33)', () => {
  it('T-33: true so para pedido com foto pronta; a consulta recebe so os ids projetados', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2), descoberto(3)];
    f.projetadas = [linha(1), linha(2)]; // o 3 saiu na projecao
    f.comFoto = new Set([id(1), id(3)]);
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.items.map((i) => [i.id, i.has_photos])).toEqual([
      [id(1), true],
      [id(2), false],
    ]);
    expect(f.chamadas.photos[0]).toEqual([id(1), id(2)]);
  });
});

describe('inelegivel e falhas (decisao 611, §3.2 linhas 7 e 8)', () => {
  it('pagina vazia: 200 com corpo constante, sem chamar a projecao', async () => {
    const f = fabrica();
    f.descobertos = [];
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    expect(r).toEqual({ status: 200, body: { items: [], next_cursor: null, has_more: false } });
    expect(f.chamadas.projection.length).toBe(0);
  });

  it('pagina cheia e has_more: next_cursor presente com o mesmo limite', async () => {
    const f = fabrica();
    f.descobertos = [descoberto(1), descoberto(2)];
    f.projetadas = [linha(1), linha(2)];
    const r = await discoverRequests(PRO, { limit: 2, cursor: null }, f.deps);
    if (r.status !== 200) throw new Error('esperava 200');
    expect(r.body.has_more).toBe(true);
    expect(typeof r.body.next_cursor).toBe('string');
  });

  it.each([
    ['descoberta', 'store'],
    ['projecao', 'projection'],
    ['fotos', 'photos'],
  ] as const)('falha na %s vira 503 com corpo constante', async (_nome, quebra) => {
    const f = fabrica();
    f.descobertos = [descoberto(1)];
    f.projetadas = [linha(1)];
    f.falha[quebra] = true;
    const r = await discoverRequests(PRO, { limit: 50, cursor: null }, f.deps);
    expect(r).toEqual({ status: 503, body: DESCOBERTA_INDISPONIVEL_BODY });
    expect(JSON.stringify(r)).not.toContain('falha simulada');
  });
});
