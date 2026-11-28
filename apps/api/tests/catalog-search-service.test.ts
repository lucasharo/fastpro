// H-019 | Servico e adaptador da busca de servico, sem banco e sem rede
// (docs/factory/64-DESENHO-H019.md, §3.1, §3.3, §5.1 T-H019-02, T-H019-05).
// Dados sinteticos. Canario: termo unico que nao pode aparecer em erro nem em resposta.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATALOG_SEARCH_FIELDS } from '@fastpro/domain';
import {
  CATALOG_PRINCIPAL_SQL,
  CATALOG_SEARCH_SQL,
  createCatalogSearchAdapter,
  type CatalogSqlRunner,
  type CatalogSqlTx,
} from '../src/catalog/db-adapter.js';
import {
  unwiredCatalogRate,
  unwiredCatalogSearch,
  type CatalogRateCheck,
  type CatalogRateLimitPort,
  type CatalogSearchPort,
  type CatalogSearchPortResult,
} from '../src/catalog/ports.js';
import { searchCatalogService } from '../src/catalog/service-search.js';

const CANARIO = 'empreiteiro-canario-h019';
const LINHA = {
  group_id: '00000000-0000-4000-8000-000000000001',
  group_name: 'Grupo sintetico',
  group_position: 2,
  service_id: '00000000-0000-4000-8000-000000000002',
  service_name: 'Servico sintetico',
  modality: 'presencial',
  regulated: false,
};

class SearchFake implements CatalogSearchPort {
  calls: string[] = [];
  constructor(private readonly result: CatalogSearchPortResult | Error) {}
  async search(q: string): Promise<CatalogSearchPortResult> {
    this.calls.push(q);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class RateFake implements CatalogRateLimitPort {
  checks = 0;
  hits = 0;
  constructor(private readonly verdict: CatalogRateCheck) {}
  async check(): Promise<CatalogRateCheck> {
    this.checks += 1;
    return this.verdict;
  }
  async hit(): Promise<void> {
    this.hits += 1;
  }
}

const OK_RATE = { ok: true } as const;

describe('searchCatalogService (desenho §3.1 passos 4 a 6)', () => {
  it('ok: projeta so os 7 campos e nao repassa campos extras da linha (T-H019-02)', async () => {
    const search = new SearchFake({
      ok: true,
      rows: [{ ...LINHA, term: CANARIO, term_norm: CANARIO, rnk: 4, council_body: 'x' }],
    });
    const rate = new RateFake(OK_RATE);
    const r = await searchCatalogService({ q: 'empreit', ip: '203.0.113.9' }, { search, rate });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', items: [LINHA] });
    expect(JSON.stringify(r.body)).not.toContain(CANARIO);
    expect(search.calls).toEqual(['empreit']);
    expect(rate.checks).toBe(1);
    expect(rate.hits).toBe(1);
  });

  it('vazio: 200 com sem_resultado, separado de erro (CA-06)', async () => {
    const search = new SearchFake({ ok: true, rows: [] });
    const r = await searchCatalogService(
      { q: 'xyzw', ip: '203.0.113.9' },
      { search, rate: new RateFake(OK_RATE) },
    );
    expect(r).toMatchObject({ status: 200, body: { status: 'vazio', code: 'sem_resultado' } });
  });

  it('limite: 429 com Retry-After, sem chamar a busca nem contar (CA-07 e R-2)', async () => {
    const search = new SearchFake({ ok: true, rows: [LINHA] });
    const rate = new RateFake({ ok: false, retryAfterS: 60 });
    const r = await searchCatalogService({ q: 'pedr', ip: '203.0.113.9' }, { search, rate });
    expect(r).toEqual({
      status: 429,
      body: { status: 'erro', code: 'limite' },
      retryAfterS: 60,
      errorCode: 'rate_limited',
    });
    expect(search.calls).toEqual([]);
    expect(rate.hits).toBe(0);
  });

  it('falha da porta: 503 falha com codigo fixo, sem mensagem e sem "nenhum resultado"', async () => {
    const search = new SearchFake({ ok: false, code: 'db_timeout' });
    const r = await searchCatalogService(
      { q: 'pedr', ip: '203.0.113.9' },
      { search, rate: new RateFake(OK_RATE) },
    );
    expect(r).toEqual({
      status: 503,
      body: { status: 'erro', code: 'falha' },
      errorCode: 'db_timeout',
    });
  });

  it('forma inesperada do banco: 503 falha, nunca repasse da linha crua', async () => {
    const search = new SearchFake({ ok: true, rows: [{ ...LINHA, regulated: 'sim' }] });
    const r = await searchCatalogService(
      { q: 'pedr', ip: '203.0.113.9' },
      { search, rate: new RateFake(OK_RATE) },
    );
    expect(r).toEqual({ status: 503, body: { status: 'erro', code: 'falha' }, errorCode: 'db_shape' });
  });

  it('porta nao ligada: 503 falha sem consultar nada', async () => {
    const r = await searchCatalogService(
      { q: 'pedr', ip: '203.0.113.9' },
      { search: unwiredCatalogSearch, rate: unwiredCatalogRate },
    );
    expect(r).toMatchObject({ status: 503, body: { code: 'falha' }, errorCode: 'db_error' });
  });
});

describe('createCatalogSearchAdapter (desenho §3.3, T-H019-05)', () => {
  function runnerComTx(
    query: (text: string, params: readonly unknown[]) => Promise<readonly unknown[]>,
  ): { runner: CatalogSqlRunner; chamadas: Array<{ text: string; params: readonly unknown[] }> } {
    const chamadas: Array<{ text: string; params: readonly unknown[] }> = [];
    const tx: CatalogSqlTx = {
      query: async (text, params) => {
        chamadas.push({ text, params });
        return query(text, params);
      },
    };
    return {
      chamadas,
      runner: { transaction: async (fn) => fn(tx) },
    };
  }

  it('marca o principal como anonimo e so depois chama a funcao com o termo ligado ($1)', async () => {
    const { runner, chamadas } = runnerComTx(async (text) =>
      text === CATALOG_SEARCH_SQL ? [LINHA] : [],
    );
    const r = await createCatalogSearchAdapter(runner).search('pedr');
    expect(r).toEqual({ ok: true, rows: [LINHA] });
    expect(chamadas.map((c) => c.text)).toEqual([CATALOG_PRINCIPAL_SQL, CATALOG_SEARCH_SQL]);
    expect(chamadas[1]?.params).toEqual(['pedr']);
  });

  it('o SQL da busca nao contem o termo e usa so colunas da lista publica (sem select *)', () => {
    expect(CATALOG_SEARCH_SQL).toContain('$1');
    expect(CATALOG_SEARCH_SQL).not.toContain('*');
    expect(CATALOG_SEARCH_SQL).not.toContain(CANARIO);
    expect(CATALOG_PRINCIPAL_SQL).toContain("'anonymous'");
    for (const campo of CATALOG_SEARCH_FIELDS) expect(CATALOG_SEARCH_SQL).toContain(campo);
  });

  it('excecao do banco vira db_error e a mensagem nao sai', async () => {
    const { runner } = runnerComTx(async () => {
      throw new Error(`erro do banco com ${CANARIO}`);
    });
    const r = await createCatalogSearchAdapter(runner).search('pedr');
    expect(r).toEqual({ ok: false, code: 'db_error' });
    expect(JSON.stringify(r)).not.toContain(CANARIO);
  });

  it('tempo esgotado vira db_timeout, sem esperar a consulta', async () => {
    const runner: CatalogSqlRunner = { transaction: () => new Promise<never>(() => {}) };
    const r = await createCatalogSearchAdapter(runner, 5).search('pedr');
    expect(r).toEqual({ ok: false, code: 'db_timeout' });
  });

  it('usa o tempo padrao de 2 s quando nenhum e informado', async () => {
    vi.useFakeTimers();
    try {
      const runner: CatalogSqlRunner = { transaction: () => new Promise<never>(() => {}) };
      const pendente = createCatalogSearchAdapter(runner).search('pedr');
      await vi.advanceTimersByTimeAsync(1999);
      let resolvido = false;
      void pendente.then(() => {
        resolvido = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolvido).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pendente).toEqual({ ok: false, code: 'db_timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('paridade com a lista publica do contrato (T-H018-06)', () => {
  it('CATALOG_SEARCH_FIELDS e igual a CATALOG_PUBLIC_FIELDS de packages/contracts', () => {
    const fonte = readFileSync(
      new URL('../../../packages/contracts/src/catalog.ts', import.meta.url),
      'utf8',
    );
    const bloco = /CATALOG_PUBLIC_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(fonte)?.[1] ?? '';
    const campos = [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(campos).toEqual([...CATALOG_SEARCH_FIELDS]);
  });
});
