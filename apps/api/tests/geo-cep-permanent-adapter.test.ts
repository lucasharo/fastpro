// Geocodificacao permanente por CEP (BrasilAPI) e OpenStreetMap (Nominatim), com fetch simulado.
// Fetch global bloqueado: nenhum teste chama servico real.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes do geocodificador por CEP');
};

import { describe, expect, it } from 'vitest';
import {
  BRASILAPI_CEP_URL,
  VIACEP_URL,
  GEOCODER_USER_AGENT,
  NOMINATIM_SEARCH_URL,
  createCepPermanentAdapter,
  escolherCandidato,
  separarEndereco,
} from '../src/geo/cep-permanent-adapter.js';
import { montarPublicacaoPedido, provedorPermanenteDoAmbiente } from '../src/requests/publish-composicao.js';

type Resposta = { status: number; corpo?: unknown } | 'rede';

function fetchFalso(rotas: (url: URL) => Resposta) {
  const chamadas: { url: URL; init: RequestInit }[] = [];
  const impl = (async (entrada: URL | string, init?: RequestInit) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, init: init ?? {} });
    const r = rotas(url);
    if (r === 'rede') throw new Error('falha de rede sintetica');
    return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status });
  }) as typeof fetch;
  return { impl, chamadas };
}

const candidato = (lat: number, lon: number, rank: number, cidade: string, cep = '') => ({
  lat: String(lat),
  lon: String(lon),
  place_rank: rank,
  address: { city: cidade, postcode: cep },
});

describe('separarEndereco', () => {
  it('rotulo do autocompletar: rua, numero, cidade, estado e CEP', () => {
    expect(separarEndereco('Avenida Paulista 1000, São Paulo - São Paulo, 01310-100, Brasil')).toEqual({
      rua: 'Avenida Paulista',
      numero: '1000',
      cidade: 'São Paulo',
      estado: 'São Paulo',
      cep: '01310100',
    });
  });
  it('com bairro e CEP de 5 digitos (CEP curto e ignorado)', () => {
    expect(separarEndereco('Rua Augusta 500, Jacintinho, Maceió - Alagoas, 57040, Brasil')).toEqual({
      rua: 'Rua Augusta',
      numero: '500',
      cidade: 'Maceió',
      estado: 'Alagoas',
    });
  });
  it('texto digitado com virgula antes do numero e UF', () => {
    expect(separarEndereco('Rua Augusta, 500, São Paulo, SP')).toEqual({
      rua: 'Rua Augusta',
      numero: '500',
      cidade: 'São Paulo',
      estado: 'SP',
    });
  });
  it('rua sem cidade', () => {
    expect(separarEndereco('Rua das Flores, 10')).toEqual({ rua: 'Rua das Flores', numero: '10' });
  });
});

describe('escolherCandidato', () => {
  it('descarta candidato de outra cidade (homonimo) e prefere o mesmo CEP', () => {
    const r = escolherCandidato(
      [
        candidato(-22.85, -47.18, 30, 'Sumaré'),
        candidato(-23.56, -46.66, 26, 'São Paulo', '01305-000'),
        candidato(-23.55, -46.65, 26, 'Sao Paulo', '01310-100'),
      ],
      { rua: 'Rua Augusta', cidade: 'São Paulo', cep: '01310100' },
    );
    expect(r).toEqual({ status: 'ponto', point: { lon: -46.65, lat: -23.55, precision: 'rua' } });
  });
  it('so candidatos de outras cidades: sem resultado', () => {
    expect(escolherCandidato([candidato(-22.85, -47.18, 30, 'Sumaré')], { cidade: 'São Paulo' })).toEqual({
      status: 'sem_resultado',
    });
  });
  it('fora do Brasil ou resposta sem lista', () => {
    expect(escolherCandidato([candidato(40.7, -74, 30, 'New York')], {})).toEqual({ status: 'sem_resultado' });
    expect(escolherCandidato({ erro: 1 }, {})).toBeNull();
  });
});

describe('createCepPermanentAdapter', () => {
  const ROTULO = 'Avenida Paulista 1000, São Paulo - São Paulo, 01310-100, Brasil';

  it('CEP na BrasilAPI e Nominatim estruturado com numero: precisao de endereco', async () => {
    const f = fetchFalso((url) => {
      if (url.href.startsWith(BRASILAPI_CEP_URL))
        return {
          status: 200,
          corpo: { city: 'São Paulo', state: 'SP', street: 'Avenida Paulista', location: { coordinates: { longitude: '-46.63', latitude: '-23.54' } } },
        };
      return { status: 200, corpo: [candidato(-23.5648, -46.6519, 30, 'São Paulo', '01310-100')] };
    });
    const r = await createCepPermanentAdapter({ fetchImpl: f.impl }).geocode(ROTULO);
    expect(r).toEqual({ status: 'ponto', point: { lon: -46.6519, lat: -23.5648, precision: 'endereco' } });
    expect(f.chamadas[0]?.url.href).toBe(`${BRASILAPI_CEP_URL}01310100`);
    const nominatim = f.chamadas[1]?.url;
    expect(nominatim?.origin + (nominatim?.pathname ?? '')).toBe(NOMINATIM_SEARCH_URL);
    expect(nominatim?.searchParams.get('street')).toBe('1000 Avenida Paulista');
    expect(nominatim?.searchParams.get('city')).toBe('São Paulo');
    expect(nominatim?.searchParams.get('countrycodes')).toBe('br');
    for (const c of f.chamadas) {
      expect(c.init.credentials).toBe('omit');
      expect((c.init.headers as Record<string, string>)['User-Agent']).toBe(GEOCODER_USER_AGENT);
    }
  });

  it('numero nao encontrado: tenta a rua sem numero', async () => {
    const f = fetchFalso((url) => {
      if (url.href.startsWith(BRASILAPI_CEP_URL)) return { status: 404 };
      if (url.href.startsWith(VIACEP_URL)) return { status: 200, corpo: { erro: true } };
      const rua = url.searchParams.get('street') ?? '';
      return { status: 200, corpo: rua.startsWith('1000 ') ? [] : [candidato(-23.56, -46.65, 26, 'São Paulo')] };
    });
    const r = await createCepPermanentAdapter({ fetchImpl: f.impl }).geocode(ROTULO);
    expect(r).toEqual({ status: 'ponto', point: { lon: -46.65, lat: -23.56, precision: 'rua' } });
    expect(f.chamadas).toHaveLength(4);
  });

  it('BrasilAPI fora do ar: o ViaCEP corrige a cidade pelo CEP', async () => {
    const f = fetchFalso((url) => {
      if (url.href.startsWith(BRASILAPI_CEP_URL)) return { status: 503 };
      if (url.href.startsWith(VIACEP_URL))
        return { status: 200, corpo: { logradouro: 'Avenida Paulista', localidade: 'São Paulo', uf: 'SP' } };
      return { status: 200, corpo: [candidato(-23.5648, -46.6519, 30, 'São Paulo', '01310-100')] };
    });
    const r = await createCepPermanentAdapter({ fetchImpl: f.impl }).geocode('Avenida Paulista 1000, 01310-100');
    expect(r).toEqual({ status: 'ponto', point: { lon: -46.6519, lat: -23.5648, precision: 'endereco' } });
    expect(f.chamadas[1]?.url.href).toBe(`${VIACEP_URL}01310100/json/`);
    expect(f.chamadas[2]?.url.searchParams.get('city')).toBe('São Paulo');
    expect(f.chamadas[2]?.url.searchParams.get('state')).toBe('SP');
  });

  it('nada no OpenStreetMap: usa o centro do CEP como localidade', async () => {
    const f = fetchFalso((url) =>
      url.href.startsWith(BRASILAPI_CEP_URL)
        ? { status: 200, corpo: { city: 'São Paulo', location: { coordinates: { longitude: '-46.63611', latitude: '-23.5475' } } } }
        : { status: 200, corpo: [] },
    );
    expect(await createCepPermanentAdapter({ fetchImpl: f.impl }).geocode(ROTULO)).toEqual({
      status: 'ponto',
      point: { lon: -46.63611, lat: -23.5475, precision: 'localidade' },
    });
  });

  it('sem CEP e sem resultado: sem_resultado', async () => {
    const f = fetchFalso(() => ({ status: 200, corpo: [] }));
    expect(await createCepPermanentAdapter({ fetchImpl: f.impl }).geocode('Rua Zzz 9, São Paulo - São Paulo, Brasil')).toEqual({
      status: 'sem_resultado',
    });
    expect(f.chamadas.every((c) => !c.url.href.startsWith(BRASILAPI_CEP_URL))).toBe(true);
  });

  it('Nominatim fora do ar ou com limite: falha com codigo fixo, nunca lanca', async () => {
    const rede = fetchFalso(() => 'rede');
    expect(await createCepPermanentAdapter({ fetchImpl: rede.impl }).geocode('Rua X 1, São Paulo - SP, Brasil')).toEqual({
      status: 'falha',
      code: 'provider_timeout',
    });
    const limite = fetchFalso(() => ({ status: 429 }));
    expect(await createCepPermanentAdapter({ fetchImpl: limite.impl }).geocode('Rua X 1')).toEqual({
      status: 'falha',
      code: 'provider_429',
    });
  });
});

describe('provedorPermanenteDoAmbiente com GEOCODER_PROVIDER=cep', () => {
  it('liga sem chave da Mapbox em DEV e no preview', () => {
    expect(provedorPermanenteDoAmbiente({ APP_ENV: 'development', GEOCODER_PROVIDER: 'cep' })).toBeDefined();
    expect(
      provedorPermanenteDoAmbiente({ APP_ENV: 'preview', VERCEL_ENV: 'preview', GEOCODER_PROVIDER: 'cep' }),
    ).toBeDefined();
  });
  it('producao continua sem provedor', () => {
    expect(provedorPermanenteDoAmbiente({ APP_ENV: 'production', GEOCODER_PROVIDER: 'cep' })).toBeUndefined();
    expect(
      provedorPermanenteDoAmbiente({ APP_ENV: 'preview', VERCEL_ENV: 'production', GEOCODER_PROVIDER: 'cep' }),
    ).toBeUndefined();
  });
  it('montarPublicacaoPedido liga o servico sem pendencia de provedor', () => {
    const r = montarPublicacaoPedido(
      {
        APP_ENV: 'development',
        GEOCODER_PROVIDER: 'cep',
        DATABASE_URL_APP_SYSTEM: 'postgres://sintetico',
        SITE_URL: 'https://example.test',
        ['ADDRESS_HASH_KEY']: ['endereco', 'sentinela', 'nao-registrar', 'klmnopqrst'].join('-'),
        ['ADDRESS_ENC_KEY']: ['cifra', 'sentinela', 'nao-registrar', 'uvwxyzabcdefghijkl'].join('-'),
        ['REQUEST_PUBLISH_HMAC_KEY']: ['hmac', 'sentinela', 'nao-registrar', 'abcdefghij'].join('-'),
      },
      { abrirCliente: () => ({ query: async () => ({ rows: [] }) }) as never },
    );
    expect(r.options?.service).toBeDefined();
    expect(r.pendencias.some((p) => p.includes('provedor'))).toBe(false);
  });
});
