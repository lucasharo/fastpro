// H-031 (Issue 44) | Montagem da publicacao: quando o provedor real da Mapbox liga (decisao 239, Rodada 66).
// Sem chamadas reais: abrirCliente falso, provedor falso e nenhuma consulta ao banco.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import type { GeocodingPermanentPort } from '../src/geo/permanent-ports.js';
import { montarPublicacaoPedido, type PublicacaoPedidoOpcoes } from '../src/requests/publish-composicao.js';

// Sentinelas montadas por concatenacao: nunca aparecem como texto literal de segredo no codigo.
const TOKEN_SENTINELA = ['mbtk', 'sentinela', 'nao-registrar', '0123456789'].join('-');
const CHAVE_HMAC_SENTINELA = ['hmac', 'sentinela', 'nao-registrar', 'abcdefghij'].join('-');
const CHAVE_ENDERECO_SENTINELA = ['endereco', 'sentinela', 'nao-registrar', 'klmnopqrst'].join('-');
// Abaixo do minimo de 32 caracteres: a pendencia de tamanho nao pode ecoar o valor.
const CHAVE_CURTA_SENTINELA = ['curta', 'sentinela', 'nao-registrar'].join('-');
// Issue 45: chave de cifra do endereco, so em memoria e so como sentinela (nunca .env.local).
const CHAVE_CIFRA_SENTINELA = ['cifra', 'sentinela', 'nao-registrar', 'uvwxyzabcdefghijkl'].join('-');

const AMBIENTE_BASE: Readonly<Record<string, string>> = {
  DATABASE_URL_APP_SYSTEM: 'postgres://app-system-fake/teste',
  SITE_URL: 'https://site-teste.invalid',
  ADDRESS_HASH_KEY: CHAVE_ENDERECO_SENTINELA,
  ADDRESS_ENC_KEY: CHAVE_CIFRA_SENTINELA,
  REQUEST_PUBLISH_HMAC_KEY: CHAVE_HMAC_SENTINELA,
  MAPBOX_PERMANENT_SOFT_LIMIT: '10',
  MAPBOX_PERMANENT_HARD_LIMIT: '20',
};

const NOME_TOKEN = 'MAPBOX_ACCESS_TOKEN';

function clienteFalso(consultas: string[]): SqlClient {
  return {
    query: (texto: string) => {
      consultas.push(texto);
      return Promise.reject(new Error('a montagem nao deve consultar o banco'));
    },
  };
}

function opcoesComFabrica(consultas: string[] = []): PublicacaoPedidoOpcoes {
  return { abrirCliente: () => clienteFalso(consultas) };
}

function ambiente(extra: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...AMBIENTE_BASE, ...extra };
}

// Issue 45 (T-13): sem chave de cifra do endereco, a rota nao liga; a pendencia so leva o nome da variavel.
describe('montarPublicacaoPedido: chave de cifra do endereco (Issue 45, T-13)', () => {
  it('ADDRESS_ENC_KEY ausente ou curta: nao monta a rota e lista so o nome', () => {
    const sem = { ...AMBIENTE_BASE, APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA };
    delete (sem as Record<string, string | undefined>).ADDRESS_ENC_KEY;
    const curta = { ...sem, ADDRESS_ENC_KEY: CHAVE_CURTA_SENTINELA };
    for (const cenario of [sem, curta]) {
      const r = montarPublicacaoPedido(cenario, opcoesComFabrica());
      expect(r.options).toBeUndefined();
      expect(r.pendencias.some((p) => p.startsWith('ADDRESS_ENC_KEY'))).toBe(true);
      expect(r.pendencias.join('|')).not.toContain(CHAVE_CURTA_SENTINELA);
    }
  });

  it('com chave de cifra de tamanho minimo, a montagem nao acusa pendencia de cifra', () => {
    const r = montarPublicacaoPedido(
      ambiente({ APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA }),
      opcoesComFabrica(),
    );
    expect(r.pendencias.some((p) => p.includes('ADDRESS_ENC_KEY'))).toBe(false);
  });
});

describe('montarPublicacaoPedido: provedor real da Mapbox', () => {
  describe('liga com chave e APP_ENV de desenvolvimento', () => {
    const casos = ['development', 'dev', 'test', ' Development ', 'DEV', '  test  '];
    for (const appEnv of casos) {
      it(`APP_ENV "${appEnv}" sem VERCEL_ENV liga o provedor`, () => {
        const r = montarPublicacaoPedido(ambiente({ APP_ENV: appEnv, [NOME_TOKEN]: TOKEN_SENTINELA }), opcoesComFabrica());
        expect(r.options?.service).toBeDefined();
        expect(r.pendencias).toEqual([]);
      });
    }

    it('VERCEL_ENV development (ou vazio, so espacos) continua ligando', () => {
      for (const vercel of ['development', ' Development ', '   ']) {
        const r = montarPublicacaoPedido(
          ambiente({ APP_ENV: 'development', VERCEL_ENV: vercel, [NOME_TOKEN]: TOKEN_SENTINELA }),
          opcoesComFabrica(),
        );
        expect(r.options?.service).toBeDefined();
        expect(r.pendencias).toEqual([]);
      }
    });
  });

  describe('nao liga (service undefined e pendencia com o nome da variavel)', () => {
    const casosSemLigar: Array<[string, Record<string, string | undefined>]> = [
      ['APP_ENV production', { APP_ENV: 'production', [NOME_TOKEN]: TOKEN_SENTINELA }],
      ['APP_ENV ausente', { [NOME_TOKEN]: TOKEN_SENTINELA }],
      ['APP_ENV staging', { APP_ENV: 'staging', [NOME_TOKEN]: TOKEN_SENTINELA }],
      ['APP_ENV preview', { APP_ENV: 'preview', [NOME_TOKEN]: TOKEN_SENTINELA }],
      ['APP_ENV desconhecido', { APP_ENV: 'desenvolvimento', [NOME_TOKEN]: TOKEN_SENTINELA }],
      ['chave vazia', { APP_ENV: 'development', [NOME_TOKEN]: '' }],
      ['chave so espacos', { APP_ENV: 'development', [NOME_TOKEN]: '     ' }],
      ['chave ausente', { APP_ENV: 'development' }],
      [
        'APP_ENV development com VERCEL_ENV production',
        { APP_ENV: 'development', VERCEL_ENV: 'production', [NOME_TOKEN]: TOKEN_SENTINELA },
      ],
      [
        'APP_ENV development com VERCEL_ENV preview',
        { APP_ENV: 'development', VERCEL_ENV: 'preview', [NOME_TOKEN]: TOKEN_SENTINELA },
      ],
      [
        'APP_ENV test com VERCEL_ENV preview',
        { APP_ENV: 'test', VERCEL_ENV: 'preview', [NOME_TOKEN]: TOKEN_SENTINELA },
      ],
    ];

    for (const [descricao, extra] of casosSemLigar) {
      it(`${descricao}: options definido, service undefined e pendencia com o nome`, () => {
        const r = montarPublicacaoPedido(ambiente(extra), opcoesComFabrica());
        expect(r.options).toBeDefined();
        expect(r.options?.service).toBeUndefined();
        expect(r.pendencias.some((p) => p.includes(NOME_TOKEN))).toBe(true);
      });
    }
  });

  it('options definido mesmo sem provedor, com as variaveis fixas completas', () => {
    const r = montarPublicacaoPedido(ambiente({ APP_ENV: 'production' }), opcoesComFabrica());
    expect(r.options).toBeDefined();
    expect(r.options?.siteUrl).toBe(AMBIENTE_BASE.SITE_URL);
    expect(r.options?.service).toBeUndefined();
  });

  it('nenhuma pendencia contem o valor do token, da chave HMAC ou da chave de endereco', () => {
    const cenarios: Array<Record<string, string | undefined>> = [
      ambiente({ APP_ENV: 'production', [NOME_TOKEN]: TOKEN_SENTINELA }),
      ambiente({ APP_ENV: 'development', VERCEL_ENV: 'preview', [NOME_TOKEN]: TOKEN_SENTINELA }),
      ambiente({ APP_ENV: 'development', [NOME_TOKEN]: '   ' }),
      ambiente({ APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA, REQUEST_PUBLISH_HMAC_KEY: CHAVE_CURTA_SENTINELA }),
      ambiente({ APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA, ADDRESS_HASH_KEY: CHAVE_CURTA_SENTINELA }),
    ];
    const segredos = [TOKEN_SENTINELA, CHAVE_HMAC_SENTINELA, CHAVE_ENDERECO_SENTINELA, CHAVE_CURTA_SENTINELA];
    for (const cenario of cenarios) {
      const r = montarPublicacaoPedido(cenario, opcoesComFabrica());
      for (const pendencia of r.pendencias) {
        for (const segredo of segredos) {
          expect(pendencia.includes(segredo)).toBe(false);
        }
      }
    }
  });

  it('provedor injetado em opcoes.provedor prevalece sobre o ambiente', () => {
    const provedorFalso: GeocodingPermanentPort = {
      geocode: () => Promise.reject(new Error('o teste nao deve geocodificar')),
    };
    // Ambiente de producao: sem injecao a rota nao ligaria. Com provedor injetado, liga e nao pendencia o token.
    const r = montarPublicacaoPedido(ambiente({ APP_ENV: 'production' }), {
      ...opcoesComFabrica(),
      provedor: provedorFalso,
    });
    expect(r.options?.service).toBeDefined();
    expect(r.pendencias.some((p) => p.includes(NOME_TOKEN))).toBe(false);
    expect(r.pendencias).toEqual([]);
  });

  it('sem abrirCliente nada e montado e a pendencia da fabrica aparece', () => {
    const r = montarPublicacaoPedido(ambiente({ APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA }));
    expect(r.options).toBeUndefined();
    expect(r.pendencias.some((p) => p.includes('fabrica do cliente SQL'))).toBe(true);
  });

  it('a montagem nao consulta o banco', () => {
    const consultas: string[] = [];
    montarPublicacaoPedido(ambiente({ APP_ENV: 'development', [NOME_TOKEN]: TOKEN_SENTINELA }), opcoesComFabrica(consultas));
    expect(consultas).toEqual([]);
  });
});
