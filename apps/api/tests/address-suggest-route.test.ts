// H-020 | Rota POST /v1/geo/address-suggest com provedor simulado (docs/factory/56-DESENHO-H020.md, §6).
// Servidor de loopback e cliente node:http; fetch global bloqueado. Dados sinteticos (@example.test).
// Testes da tabela do desenho: 1 (rascunho/403), 2 (so label), 7 (limite), 9 (falhas sem retentativa),
// 10 (canario fora dos logs), 12 (porta nao ligada = 503). Teste 3 no bloco do adaptador.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-020');
};

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ADDRESS_SUGGEST_PATH, type ProviderErrorCode } from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import {
  suggestAddress,
  type AddressSuggestDeps,
} from '../src/geo/address-suggest-service.js';
import {
  createMapboxTempAdapter,
  MAPBOX_FORWARD_URL,
  MAPBOX_TIMEOUT_MS,
} from '../src/geo/mapbox-temp-adapter.js';
import {
  unwiredDraftGate,
  type DraftGatePort,
  type GeocodingTempPort,
  type ProviderResult,
  type QuotaPort,
  type RateLimitPort,
} from '../src/geo/ports.js';

const SITE = 'https://fastpro.example.test';
const CANARIO = 'Rua Canario Sintetico 999';
const LAT_SENTINELA = -23.123456;
const FEATURES_BRUTAS = [
  {
    id: 'feature-sintetica-1',
    geometry: { type: 'Point', coordinates: [-46.654321, LAT_SENTINELA] },
    properties: {
      full_address: 'Rua Alfa, 10, Centro, Sao Paulo',
      mapbox_id: 'mbx-sintetico-1',
      coordinates: { latitude: LAT_SENTINELA, longitude: -46.654321 },
    },
  },
  { properties: { name: 'Rua Beta', place_formatted: 'Sao Paulo, Brasil' } },
];

class GateFake implements DraftGatePort {
  calls = 0;
  constructor(private readonly status: 'ok' | 'not_draft' | 'no_principal' | 'indisponivel') {}
  async check() {
    this.calls += 1;
    return this.status === 'ok'
      ? { status: 'ok' as const, principal: 'rascunho-sintetico' }
      : { status: this.status };
  }
}

class RateFake implements RateLimitPort {
  checks = 0;
  hits = 0;
  constructor(private readonly bloqueado = false) {}
  async check() {
    this.checks += 1;
    return this.bloqueado ? { ok: false as const, retryAfterS: 60 } : { ok: true as const };
  }
  async hit() {
    this.hits += 1;
  }
}

class QuotaFake implements QuotaPort {
  takes = 0;
  constructor(private readonly ok = true, private readonly novoAlerta = false, private readonly used = 1) {}
  async take() {
    this.takes += 1;
    return { ok: this.ok, novoAlerta: this.novoAlerta, used: this.used };
  }
}

class ProviderFake implements GeocodingTempPort {
  calls = 0;
  constructor(private result: ProviderResult) {}
  async suggest() {
    this.calls += 1;
    return this.result;
  }
}

const OK_FEATURES: ProviderResult = { ok: true, features: FEATURES_BRUTAS };

function montar(
  over: {
    gate?: DraftGatePort;
    rate?: RateFake;
    quota?: QuotaFake;
    provider?: ProviderFake;
    alerta?: ReturnType<typeof vi.fn>;
    enabled?: boolean;
  } = {},
) {
  const gate = over.gate ?? new GateFake('ok');
  const rate = over.rate ?? new RateFake();
  const quota = over.quota ?? new QuotaFake();
  const provider = over.provider ?? new ProviderFake(OK_FEATURES);
  const alerta = over.alerta ?? vi.fn();
  const deps: AddressSuggestDeps = {
    gate,
    rate,
    quota,
    provider,
    clock: { nowMs: () => Date.UTC(2099, 0, 1, 12) },
    onQuotaAlert: alerta,
  };
  return { gate, rate, quota, provider, alerta, deps, enabled: over.enabled ?? true };
}

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

async function subir(
  geo: ReturnType<typeof montar> | undefined,
): Promise<number> {
  const server = createServer((req, res) =>
    handleRequest(req, res, {
      tickSecret: undefined,
      geo: geo ? { deps: geo.deps, enabled: geo.enabled, siteUrl: SITE } : undefined,
    }).catch(() => {
      res.statusCode = 500;
      res.end();
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
}

function post(
  porta: number,
  corpo: string,
  cabecalhos: Record<string, string> = {},
  caminho = ADDRESS_SUGGEST_PATH,
  metodo = 'POST',
): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        path: caminho,
        method: metodo,
        headers: {
          Origin: SITE,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
          ...cabecalhos,
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(partes).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(corpo);
  });
}

const corpoOk = (q = 'Rua Alfa') => JSON.stringify({ q, context: 'request_draft' });

describe('T-H020-R1 rascunho recebe itens (CA-01)', () => {
  it('rascunho: 200 com itens; uma consulta ao provedor; cota e taxa contadas', async () => {
    const m = montar();
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({
      mode: 'ok',
      items: [{ label: 'Rua Alfa, 10, Centro, Sao Paulo' }, { label: 'Rua Beta, Sao Paulo, Brasil' }],
    });
    expect(m.provider.calls).toBe(1);
    expect(m.quota.takes).toBe(1);
    expect(m.rate.hits).toBe(1);
  });
});

describe('T-H020-R2 resposta so com mode e label (CA-03, CA-04)', () => {
  it('nenhuma chave, coordenada ou identificador do provedor chega ao navegador', async () => {
    const porta = await subir(montar());
    const r = await post(porta, corpoOk());
    const json = JSON.parse(r.text) as { mode: string; items: Array<Record<string, unknown>> };
    expect(Object.keys(json).sort()).toEqual(['items', 'mode']);
    for (const item of json.items) expect(Object.keys(item)).toEqual(['label']);
    expect(r.text).not.toMatch(/latitude|longitude|coordinates|mapbox_id|feature-sintetica|mbx-sintetico/);
    expect(r.text).not.toContain(String(LAT_SENTINELA));
  });
});

describe('T-H020-R3 fora de rascunho: 403 e zero chamadas (CA-02)', () => {
  it.each(['not_draft', 'no_principal'] as const)('%s responde 403 sem tocar taxa, cota ou provedor', async (status) => {
    const m = montar({ gate: new GateFake(status) });
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual({ code: 'not_draft' });
    expect([m.provider.calls, m.quota.takes, m.rate.checks]).toEqual([0, 0, 0]);
  });
});

describe('T-H020-R7 limite de taxa: 429 sem provedor e sem cota (CA-09)', () => {
  it('excedente responde 429 com Retry-After e texto livre por limite', async () => {
    const m = montar({ rate: new RateFake(true) });
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('60');
    expect(JSON.parse(r.text)).toEqual({ mode: 'texto_livre', reason: 'limite', retry_after_s: 60 });
    expect([m.provider.calls, m.quota.takes, m.rate.hits]).toEqual([0, 0, 0]);
  });
});

describe('T-H020-R8 cota no teto: texto livre sem erro e sem provedor (CA-08)', () => {
  it('cota recusada responde 200 texto_livre/cota e nao chama o provedor', async () => {
    const m = montar({ quota: new QuotaFake(false, false, 2000) });
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ mode: 'texto_livre', reason: 'cota' });
    expect(m.provider.calls).toBe(0);
  });

  it('alerta sai so quando a reserva marca novo alerta', async () => {
    const alerta = vi.fn();
    const porta = await subir(montar({ quota: new QuotaFake(true, true, 1500), alerta }));
    await post(porta, corpoOk());
    expect(alerta).toHaveBeenCalledTimes(1);
    expect(alerta).toHaveBeenCalledWith({ used: 1500 });
    const alerta2 = vi.fn();
    const porta2 = await subir(montar({ quota: new QuotaFake(true, false), alerta: alerta2 }));
    await post(porta2, corpoOk());
    expect(alerta2).not.toHaveBeenCalled();
  });
});

describe('T-H020-R9 falha do provedor: texto livre, sem retentativa (CA-10, CA-11)', () => {
  const falhas: ProviderErrorCode[] = [
    'provider_timeout',
    'provider_5xx',
    'provider_auth',
    'provider_429',
    'provider_shape',
  ];
  it.each(falhas)('%s responde texto_livre/indisponivel com uma unica chamada', async (code) => {
    const m = montar({ provider: new ProviderFake({ ok: false, code }) });
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ mode: 'texto_livre', reason: 'indisponivel' });
    expect(m.provider.calls).toBe(1);
  });
});

describe('T-H020-R10 canario nunca aparece em log nem em erro (CA-12, CA-13)', () => {
  it('endereco sintetico em fluxo de sucesso e de erro nao sai em console, stdout nem stderr', async () => {
    const saidas: string[] = [];
    const espias = [
      vi.spyOn(console, 'log').mockImplementation((...a) => void saidas.push(a.join(' '))),
      vi.spyOn(console, 'info').mockImplementation((...a) => void saidas.push(a.join(' '))),
      vi.spyOn(console, 'warn').mockImplementation((...a) => void saidas.push(a.join(' '))),
      vi.spyOn(console, 'error').mockImplementation((...a) => void saidas.push(a.join(' '))),
    ];
    try {
      const sucesso = await subir(montar());
      const r1 = await post(sucesso, JSON.stringify({ q: CANARIO, context: 'request_draft' }));
      const falha = await subir(montar({ provider: new ProviderFake({ ok: false, code: 'provider_5xx' }) }));
      const r2 = await post(falha, JSON.stringify({ q: CANARIO, context: 'request_draft' }));
      expect(r1.text).not.toContain('Canario');
      expect(r2.text).not.toContain('Canario');
      expect(saidas.join('\n')).not.toContain('Canario');
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });
});

describe('T-H020-R12 porta de rascunho nao ligada: 503 e sem provedor (§2.3)', () => {
  it('a porta simulada responde 503 indisponivel', async () => {
    const m = montar({ gate: unwiredDraftGate as DraftGatePort });
    const porta = await subir(m);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text)).toEqual({ code: 'indisponivel' });
    expect(m.provider.calls).toBe(0);
  });
});

describe('T-H020-R13 validacao, origem e interruptor antes de qualquer custo (§2.2)', () => {
  it('entrada invalida responde 400 e nao toca a porta de rascunho', async () => {
    const m = montar();
    const porta = await subir(m);
    const curta = await post(porta, JSON.stringify({ q: 'ab', context: 'request_draft' }));
    const extra = await post(porta, JSON.stringify({ q: 'Rua Alfa', context: 'request_draft', lat: 1 }));
    expect([curta.status, extra.status]).toEqual([400, 400]);
    expect(JSON.parse(curta.text)).toEqual({ code: 'entrada_invalida' });
    expect(m.gate.calls).toBe(0);
  });

  it('origem diferente responde 403 antes do corpo; interruptor desligado responde texto livre sem gate', async () => {
    const m = montar();
    const porta = await subir(m);
    const origem = await post(porta, corpoOk(), { Origin: 'https://outro.example.test' });
    expect(origem.status).toBe(403);
    expect(m.gate.calls).toBe(0);

    const desligado = montar({ enabled: false });
    const porta2 = await subir(desligado);
    const r = await post(porta2, corpoOk());
    expect(JSON.parse(r.text)).toEqual({ mode: 'texto_livre', reason: 'desligado' });
    expect(desligado.gate.calls).toBe(0);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('sem a opcao geo a rota nao existe (404)', async () => {
    const porta = await subir(undefined);
    const r = await post(porta, corpoOk());
    expect(r.status).toBe(404);
  });
});

describe('T-H020-R-SERVICO fluxo do servico sem HTTP', () => {
  it('um pedido de rascunho com provedor de lista vazia devolve ok com zero itens', async () => {
    const m = montar({ provider: new ProviderFake({ ok: true, features: [] }) });
    const out = await suggestAddress(
      { q: 'Rua Alfa', context: 'request_draft', cookie: undefined, ip: '127.0.0.1' },
      m.deps,
    );
    expect(out).toEqual({ status: 200, body: { mode: 'ok', items: [] } });
  });
});

describe('T-H020-A adaptador Mapbox temporario (teste 3, §6)', () => {
  it('nunca envia permanent; usa no-store; nao repassa cookie nem IP; token so na URL do servidor', async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ features: FEATURES_BRUTAS }), { status: 200 });
    }) as typeof fetch;
    const adapter = createMapboxTempAdapter({ token: 'example-token-sintetico', fetchImpl });
    const r = await adapter.suggest('Rua Alfa');
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0]!;
    expect(url.startsWith(MAPBOX_FORWARD_URL + '?')).toBe(true);
    expect(url).not.toMatch(/permanent/);
    expect(url).toContain('autocomplete=true');
    expect(url).toContain('country=br');
    expect(url).toContain('limit=5');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(MAPBOX_TIMEOUT_MS).toBe(2_500);
    const cabecalhos = JSON.stringify(init.headers ?? {});
    expect(cabecalhos).not.toMatch(/cookie|x-forwarded|authorization/i);
  });

  it('falhas viram codigo fixo, sem mensagem nem URL da biblioteca', async () => {
    const lancado = createMapboxTempAdapter({
      token: 'example-token-sintetico',
      fetchImpl: (async () => {
        throw new Error('falha com example-token-sintetico e ' + CANARIO);
      }) as typeof fetch,
    });
    const r1 = await lancado.suggest('Rua Alfa');
    expect(r1).toEqual({ ok: false, code: 'provider_timeout' });
    expect(JSON.stringify(r1)).not.toMatch(/example-token|Canario/);

    const http = (status: number) =>
      createMapboxTempAdapter({
        token: 'example-token-sintetico',
        fetchImpl: (async () => new Response('corpo', { status })) as typeof fetch,
      }).suggest('Rua Alfa');
    expect(await http(429)).toEqual({ ok: false, code: 'provider_429' });
    expect(await http(502)).toEqual({ ok: false, code: 'provider_5xx' });
    expect(await http(401)).toEqual({ ok: false, code: 'provider_auth' });

    const malformado = createMapboxTempAdapter({
      token: 'example-token-sintetico',
      fetchImpl: (async () => new Response('{nao-json', { status: 200 })) as typeof fetch,
    });
    expect(await malformado.suggest('Rua Alfa')).toEqual({ ok: false, code: 'provider_shape' });
  });
});
