// H-009/H-019/H-093 | Ponto de montagem das integracoes (apps/api/src/composicao.ts), em memoria. Sem banco, sem rede
// e sem variavel real: todos os valores sao sinteticos (placeholders de repeticao). fetch global bloqueado;
// nenhum envio e feito.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de composicao');
};

import { describe, expect, it } from 'vitest';
import { montarIntegracoes } from '../src/composicao.js';
import {
  CATALOG_DATABASE_URL_ENV,
  CATALOG_RATE_KEY_ENV,
  CATALOG_SITE_URL_ENV,
} from '../src/catalog/compose.js';
import { criarFabricaCatalogo, type CatalogPool } from '../src/catalog/fabrica-pg.js';

/** Marca usada para provar que nenhum valor de credencial sai no resultado (placeholder, nao segredo). */
const MARCA_CHAVE = 'x'.repeat(40);
const URL_SINTETICA = 'postgres://app_api_sintetico@db.example.test:5432/exemplo';

const EMAIL_COMPLETO = {
  APP_ENV: 'test',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'onboarding@resend.dev',
  RESEND_API_KEY: 'x'.repeat(40),
  RESEND_ACCOUNT_RECIPIENT: 'conta@example.test',
};

const CATALOGO_COMPLETO = {
  [CATALOG_DATABASE_URL_ENV]: URL_SINTETICA,
  [CATALOG_RATE_KEY_ENV]: 'h'.repeat(40),
  [CATALOG_SITE_URL_ENV]: 'https://fastpro.example.test',
};

/** Pool que nao deve ser usado nestes testes: qualquer consulta falha de forma explicita. */
const POOL_PROIBIDO: CatalogPool = {
  connect: async () => {
    throw new Error('pool nao deveria ser usado na montagem');
  },
  query: async () => {
    throw new Error('pool nao deveria ser usado na montagem');
  },
};

describe('H-009/H-019/H-093 montagem das integracoes', () => {
  it('ambiente vazio: nada liga e as pendencias sao so nomes de variaveis', () => {
    const r = montarIntegracoes({});
    expect(r.catalog).toBeUndefined();
    expect(r.email).toBeUndefined();
    expect(r.pendencias).toEqual([
      CATALOG_DATABASE_URL_ENV,
      CATALOG_RATE_KEY_ENV,
      CATALOG_SITE_URL_ENV,
      'APP_ENV',
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'RESEND_API_KEY',
      'RESEND_ACCOUNT_RECIPIENT',
    ]);
  });

  it('caso atual do ambiente local (so a chave do Resend): e-mail segue desligado e a chave nao aparece', () => {
    const r = montarIntegracoes({ RESEND_API_KEY: 'x'.repeat(40) });
    expect(r.email).toBeUndefined();
    expect(r.pendencias).not.toContain('RESEND_API_KEY');
    expect(r.pendencias).toEqual(
      expect.arrayContaining([
        'APP_ENV',
        'EMAIL_PROVIDER',
        'EMAIL_FROM',
        'RESEND_ACCOUNT_RECIPIENT',
      ]),
    );
    expect(JSON.stringify(r)).not.toContain(MARCA_CHAVE);
  });

  it('e-mail com as variaveis completas: provedor montado, sem nenhum envio', () => {
    const r = montarIntegracoes(EMAIL_COMPLETO);
    expect(r.email).toBeDefined();
    expect(r.email?.name).toBe('resend');
    expect(r.pendencias).not.toContain('RESEND_ACCOUNT_RECIPIENT');
    expect(JSON.stringify(r)).not.toContain(MARCA_CHAVE);
  });

  it('APP_ENV fora da lista fechada: e-mail nao monta, pendencia generica sem detalhe', () => {
    const r = montarIntegracoes({ ...EMAIL_COMPLETO, APP_ENV: 'desenvolvimento' });
    expect(r.email).toBeUndefined();
    expect(r.pendencias).toContain('EMAIL (configuracao recusada pelo adaptador)');
    expect(r.pendencias).not.toContain('APP_ENV');
    expect(JSON.stringify(r)).not.toContain('desenvolvimento');
  });

  it('busca de servico: com as tres variaveis e a fabrica, a opcao da rota existe', () => {
    const r = montarIntegracoes(CATALOGO_COMPLETO, {
      fabricaCatalogo: criarFabricaCatalogo(() => POOL_PROIBIDO),
    });
    expect(r.catalog).toBeDefined();
    expect(r.catalog?.siteUrl).toBe('https://fastpro.example.test');
    expect(r.pendencias).not.toContain(CATALOG_DATABASE_URL_ENV);
    expect(r.pendencias).not.toContain(CATALOG_RATE_KEY_ENV);
    expect(r.pendencias).not.toContain(CATALOG_SITE_URL_ENV);
    expect(r.pendencias.some((p) => p.includes('fabrica do pool'))).toBe(false);
  });

  it('busca de servico: variaveis completas sem fabrica do pool continua desligada e pendente', () => {
    const r = montarIntegracoes(CATALOGO_COMPLETO);
    expect(r.catalog).toBeUndefined();
    expect(r.pendencias).toEqual([
      'fabrica do pool da busca (ainda nao montada na funcao)',
      'APP_ENV',
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'RESEND_API_KEY',
      'RESEND_ACCOUNT_RECIPIENT',
    ]);
  });

  it('valores de credenciais nunca aparecem no resultado nem nas pendencias', () => {
    const r = montarIntegracoes({
      [CATALOG_DATABASE_URL_ENV]: URL_SINTETICA,
      RESEND_API_KEY: 'x'.repeat(40),
    });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(MARCA_CHAVE);
    expect(texto).not.toContain(URL_SINTETICA);
  });
});
