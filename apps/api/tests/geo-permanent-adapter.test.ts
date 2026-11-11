// H-021 | Adaptador do modo permanente com fetch simulado (docs/factory/68-DESENHO-H021.md, §4, §7 G-F, G-I28a).
// Fetch global bloqueado: nenhum teste chama o Mapbox real. Dados sinteticos (@example.test).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-021');
};

import { describe, expect, it } from 'vitest';
import {
  buildPermanentForwardUrl,
  createMapboxPermanentAdapter,
  MAPBOX_FORWARD_URL,
  MAPBOX_PERMANENT_TIMEOUT_MS,
} from '../src/geo/mapbox-permanent-adapter.js';

const TOKEN = 'example-token-sintetico-h021';
const CANARIO = 'Rua Canario Permanente Sintetica 777';
const ENDERECO_OK = [
  {
    geometry: { type: 'Point', coordinates: [-46.6333, -23.5505] },
    properties: { feature_type: 'address', mapbox_id: 'mbx-sintetico-h021', full_address: CANARIO },
  },
];

interface Chamada {
  readonly url: string;
  readonly init: RequestInit;
}

/** fetch simulado: registra cada chamada e responde com o que o teste pedir. */
function fetchSimulado(resposta: () => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(input), init: init ?? {} });
    return resposta();
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('URL do modo permanente (§4)', () => {
  it('envia permanent=true, limit=1, sem autocomplete e com tipos de endereco', () => {
    const url = buildPermanentForwardUrl(CANARIO, TOKEN);
    expect(url.origin + url.pathname).toBe(MAPBOX_FORWARD_URL);
    expect(url.searchParams.get('permanent')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('autocomplete')).toBe('false');
    expect(url.searchParams.get('country')).toBe('br');
    expect(url.searchParams.get('types')).toBe('address,street,neighborhood,locality');
  });

  it('o tempo maximo e de 4 segundos', () => {
    expect(MAPBOX_PERMANENT_TIMEOUT_MS).toBe(4_000);
  });
});

describe('chamada unica e sem retentativa (CA-1, §3.4)', () => {
  it('sucesso: uma chamada, ponto mapeado e so lon, lat e precisao', async () => {
    const { impl, chamadas } = fetchSimulado(() => json({ features: ENDERECO_OK }));
    const adaptador = createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl });
    const r = await adaptador.geocode(CANARIO);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toContain('permanent=true');
    expect(r).toEqual({
      status: 'ponto',
      point: { lon: -46.6333, lat: -23.5505, precision: 'endereco' },
    });
  });

  it('o adaptador nunca devolve rotulo, identificador do provedor nem resposta bruta', async () => {
    const { impl } = fetchSimulado(() => json({ features: ENDERECO_OK }));
    const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('mbx-sintetico-h021');
    expect(texto).not.toContain(CANARIO);
    expect(texto).not.toContain(TOKEN);
  });

  it('cada falha de transporte ou de status gera uma unica chamada e um codigo fixo', async () => {
    const casos: Array<[string, () => Response | Promise<Response>, string]> = [
      ['500', () => new Response('erro', { status: 500 }), 'provider_5xx'],
      ['429', () => new Response('cheio', { status: 429 }), 'provider_429'],
      ['401', () => new Response('nao', { status: 401 }), 'provider_auth'],
      ['403', () => new Response('nao', { status: 403 }), 'provider_auth'],
      ['400', () => new Response('ruim', { status: 400 }), 'provider_shape'],
    ];
    for (const [nome, resposta, codigo] of casos) {
      const { impl, chamadas } = fetchSimulado(resposta);
      const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
      expect(chamadas, nome).toHaveLength(1);
      expect(r, nome).toEqual({ status: 'falha', code: codigo });
    }
  });

  it('tempo esgotado (rejeicao do fetch) vira provider_timeout, sem nova tentativa', async () => {
    const { impl, chamadas } = fetchSimulado(() => {
      throw Object.assign(new Error(`timeout em ${CANARIO} com token ${TOKEN}`), {
        name: 'TimeoutError',
      });
    });
    const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
    expect(chamadas).toHaveLength(1);
    expect(r).toEqual({ status: 'falha', code: 'provider_timeout' });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(CANARIO);
  });

  it('JSON malformado vira provider_shape, sem repetir a chamada', async () => {
    const { impl, chamadas } = fetchSimulado(() => new Response('{nao-e-json', { status: 200 }));
    const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
    expect(chamadas).toHaveLength(1);
    expect(r).toEqual({ status: 'falha', code: 'provider_shape' });
  });
});

describe('leitura defensiva da resposta (§4, dúvida 8)', () => {
  it('lista vazia e sem resultado, sem custo extra', async () => {
    const { impl, chamadas } = fetchSimulado(() => json({ features: [] }));
    const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
    expect(chamadas).toHaveLength(1);
    expect(r).toEqual({ status: 'sem_resultado' });
  });

  it('forma inesperada, coordenada invertida ou fora do Brasil e provider_shape', async () => {
    const formasRuins: unknown[] = [
      { nada: true },
      { features: 'nao-lista' },
      { features: [{ geometry: { type: 'Polygon', coordinates: [] }, properties: { feature_type: 'address' } }] },
      // Latitude e longitude invertidas: a segunda posicao (-46) cai fora da caixa de latitude.
      { features: [{ geometry: { type: 'Point', coordinates: [-23.5505, -46.6333] }, properties: { feature_type: 'address' } }] },
      // Ponto fora do Brasil (Nova York, aproximado).
      { features: [{ geometry: { type: 'Point', coordinates: [-74.006, 40.7128] }, properties: { feature_type: 'address' } }] },
      // Tipo mais grosseiro que o aceito (cidade): recusado.
      { features: [{ geometry: { type: 'Point', coordinates: [-46.6333, -23.5505] }, properties: { feature_type: 'place' } }] },
    ];
    for (const corpo of formasRuins) {
      const { impl } = fetchSimulado(() => json(corpo));
      const r = await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
      expect(r, JSON.stringify(corpo)).toEqual({ status: 'falha', code: 'provider_shape' });
    }
  });
});

describe('configuracao da chamada (§4)', () => {
  it('sem cookies, sem cache, sem redirecionamento e sem cabecalhos de autenticacao do cliente', async () => {
    const { impl, chamadas } = fetchSimulado(() => json({ features: ENDERECO_OK }));
    await createMapboxPermanentAdapter({ token: TOKEN, fetchImpl: impl }).geocode(CANARIO);
    const init = chamadas[0]?.init as RequestInit & { cache?: string };
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
    const cabecalhos = JSON.stringify(init.headers ?? {}).toLowerCase();
    expect(cabecalhos).not.toContain('cookie');
    expect(cabecalhos).not.toContain('authorization');
  });
});
