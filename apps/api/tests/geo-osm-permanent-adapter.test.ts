// Geocodificacao permanente pelo OpenStreetMap (Nominatim), com fetch simulado.
// Fetch global bloqueado: nenhum teste chama servico real.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes do geocodificador OpenStreetMap');
};

import { describe, expect, it } from 'vitest';
import {
  GEOCODER_USER_AGENT,
  NOMINATIM_SEARCH_URL,
  createOsmPermanentAdapter,
  escolherCandidato,
  separarEndereco,
} from '../src/geo/osm-permanent-adapter.js';
import { montarPublicacaoPedido, provedorPermanenteDoAmbiente } from '../src/requests/publish-composicao.js';

type Resposta = { status: number; corpo?: unknown } | 'rede';

function fetchFalso(resposta: Resposta) {
  const chamadas: { url: URL; init: RequestInit }[] = [];
  const impl = (async (entrada: URL | string, init?: RequestInit) => {
    chamadas.push({ url: new URL(String(entrada)), init: init ?? {} });
    if (resposta === 'rede') throw new Error('falha de rede sintetica');
    return new Response(resposta.corpo === undefined ? '' : JSON.stringify(resposta.corpo), { status: resposta.status });
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
  it('descarta homonimo de outra cidade e prefere o mesmo CEP', () => {
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

describe('createOsmPermanentAdapter', () => {
  it('uma consulta estruturada com numero, cidade e estado; sem cookie e com identificacao', async () => {
    const f = fetchFalso({ status: 200, corpo: [candidato(-23.5648, -46.6519, 30, 'São Paulo', '01310-100')] });
    const r = await createOsmPermanentAdapter({ fetchImpl: f.impl }).geocode(
      'Avenida Paulista 1000, São Paulo - São Paulo, 01310-100, Brasil',
    );
    expect(r).toEqual({ status: 'ponto', point: { lon: -46.6519, lat: -23.5648, precision: 'endereco' } });
    expect(f.chamadas).toHaveLength(1);
    const url = f.chamadas[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe(NOMINATIM_SEARCH_URL);
    expect(url?.searchParams.get('street')).toBe('1000 Avenida Paulista');
    expect(url?.searchParams.get('city')).toBe('São Paulo');
    expect(url?.searchParams.get('countrycodes')).toBe('br');
    expect(f.chamadas[0]?.init.credentials).toBe('omit');
    expect((f.chamadas[0]?.init.headers as Record<string, string>)['User-Agent']).toBe(GEOCODER_USER_AGENT);
  });

  it('sem cidade no texto: consulta livre', async () => {
    const f = fetchFalso({ status: 200, corpo: [] });
    expect(await createOsmPermanentAdapter({ fetchImpl: f.impl }).geocode('Rua das Flores, 10')).toEqual({
      status: 'sem_resultado',
    });
    expect(f.chamadas[0]?.url.searchParams.get('q')).toBe('Rua das Flores, 10');
  });

  it('fora do ar ou com limite: falha com codigo fixo, nunca lanca', async () => {
    const rede = fetchFalso('rede');
    expect(await createOsmPermanentAdapter({ fetchImpl: rede.impl }).geocode('Rua X 1, São Paulo - SP')).toEqual({
      status: 'falha',
      code: 'provider_timeout',
    });
    const limite = fetchFalso({ status: 429 });
    expect(await createOsmPermanentAdapter({ fetchImpl: limite.impl }).geocode('Rua X 1')).toEqual({
      status: 'falha',
      code: 'provider_429',
    });
  });
});

describe('provedorPermanenteDoAmbiente com GEOCODER_PROVIDER=osm', () => {
  it('liga sem chave da Mapbox em DEV e no preview', () => {
    expect(provedorPermanenteDoAmbiente({ APP_ENV: 'development', GEOCODER_PROVIDER: 'osm' })).toBeDefined();
    expect(
      provedorPermanenteDoAmbiente({ APP_ENV: 'preview', VERCEL_ENV: 'preview', GEOCODER_PROVIDER: 'osm' }),
    ).toBeDefined();
  });
  it('producao continua sem provedor', () => {
    expect(provedorPermanenteDoAmbiente({ APP_ENV: 'production', GEOCODER_PROVIDER: 'osm' })).toBeUndefined();
    expect(
      provedorPermanenteDoAmbiente({ APP_ENV: 'preview', VERCEL_ENV: 'production', GEOCODER_PROVIDER: 'osm' }),
    ).toBeUndefined();
  });
  it('montarPublicacaoPedido liga o servico sem pendencia de provedor', () => {
    const r = montarPublicacaoPedido(
      {
        APP_ENV: 'development',
        GEOCODER_PROVIDER: 'osm',
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
