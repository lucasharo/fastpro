// Issue 71 (H-058) | Montagem da rota de aceite a partir do ambiente (apps/api/src/requests/acceptance-composicao.ts e
// apps/api/src/composicao.ts, padrao dos testes de composicao). Sem banco, sem rede: fabricas falsas e valores
// sinteticos (placeholders de repeticao). fetch global bloqueado; nenhuma consulta e feita na montagem.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de composicao');
};

import { describe, expect, it } from 'vitest';
import { PgAcceptanceStore, type AcceptanceConnection, type SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';
import { montarAceite } from '../src/requests/acceptance-composicao.js';
import { isAcceptanceRoute } from '../src/requests/acceptance-route.js';

/** Valores sinteticos: nenhum segredo real. A marca serve para provar que o valor nunca sai na montagem. */
const URL_SINTETICA = 'postgres://app_system_sintetico@db.example.test:5432/exemplo';
const CHAVE_SINTETICA = 'h'.repeat(40);
const CHAVE_CURTA = 'curta-marca-123';
const SITE = 'https://fastpro.example.test';

const AMBIENTE_COMPLETO = {
  DATABASE_URL_APP_SYSTEM: URL_SINTETICA,
  SITE_URL: SITE,
  DISCOVERY_CURSOR_KEY: 'dummy-' + CHAVE_SINTETICA,
};

const PENDENCIA_CLIENTE = 'fabrica do cliente SQL do aceite (ainda nao montada na funcao)';
const PENDENCIA_CONEXAO = 'fabrica da conexao dedicada do aceite (ainda nao montada na funcao)';

/** Cliente que nao deve ser usado na montagem: qualquer consulta falha de forma explicita. */
const CLIENTE_PROIBIDO: SqlClient = {
  query: async () => {
    throw new Error('consulta nao deveria acontecer na montagem');
  },
};

function fabricasFalsas() {
  const urlsDoCliente: string[] = [];
  const urlsDaConexao: string[] = [];
  let conexoesAbertas = 0;
  const abrirCliente = (url: string): SqlClient => {
    urlsDoCliente.push(url);
    return CLIENTE_PROIBIDO;
  };
  const abrirConexaoDedicada = (url: string) => {
    urlsDaConexao.push(url);
    return async (): Promise<AcceptanceConnection> => {
      conexoesAbertas += 1;
      throw new Error('conexao nao deveria ser aberta na montagem');
    };
  };
  return {
    abrirCliente,
    abrirConexaoDedicada,
    urlsDoCliente,
    urlsDaConexao,
    conexoesAbertas: () => conexoesAbertas,
  };
}

describe('Issue 71 (H-058) montagem da rota de aceite', () => {
  it('ambiente vazio e sem fabricas: a rota nao liga e as pendencias sao so nomes', () => {
    const r = montarAceite({});
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([
      'DATABASE_URL_APP_SYSTEM',
      'SITE_URL',
      'DISCOVERY_CURSOR_KEY',
      PENDENCIA_CLIENTE,
      PENDENCIA_CONEXAO,
    ]);
  });

  it('chave do cursor curta: a pendencia leva so o nome, nunca o valor', () => {
    const f = fabricasFalsas();
    const r = montarAceite(
      { ...AMBIENTE_COMPLETO, DISCOVERY_CURSOR_KEY: 'dummy-' + CHAVE_CURTA },
      { abrirCliente: f.abrirCliente, abrirConexaoDedicada: f.abrirConexaoDedicada },
    );
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual(['DISCOVERY_CURSOR_KEY (tamanho minimo de 32 caracteres)']);
    expect(JSON.stringify(r)).not.toContain(CHAVE_CURTA);
  });

  it('sem a fabrica da conexao dedicada, a rota nao liga mesmo com o ambiente completo', () => {
    const f = fabricasFalsas();
    const r = montarAceite(AMBIENTE_COMPLETO, { abrirCliente: f.abrirCliente });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([PENDENCIA_CONEXAO]);
    expect(f.urlsDaConexao).toEqual([]);
  });

  it('ambiente completo com as duas fabricas: monta as opcoes sem consultar nem abrir conexao', () => {
    const f = fabricasFalsas();
    const r = montarAceite(AMBIENTE_COMPLETO, {
      abrirCliente: f.abrirCliente,
      abrirConexaoDedicada: f.abrirConexaoDedicada,
    });
    expect(r.pendencias).toEqual([]);
    expect(r.options).toBeDefined();
    expect(r.options?.siteUrl).toBe(SITE);
    expect(r.options?.service.store).toBeInstanceOf(PgAcceptanceStore);
    expect(f.urlsDoCliente).toEqual([URL_SINTETICA]);
    expect(f.urlsDaConexao).toEqual([URL_SINTETICA]);
    expect(f.conexoesAbertas()).toBe(0);
    expect(JSON.stringify(r)).not.toContain(CHAVE_SINTETICA);
  });

  it('montarIntegracoes expoe requestAcceptance e pendenciasAceite sem mexer nas demais pendencias', () => {
    const semFabricas = montarIntegracoes({});
    expect(semFabricas.requestAcceptance).toBeUndefined();
    expect(semFabricas.pendenciasAceite).toContain('DATABASE_URL_APP_SYSTEM');
    expect(semFabricas.pendenciasAceite).toContain(PENDENCIA_CONEXAO);

    const f = fabricasFalsas();
    const comFabricas = montarIntegracoes(AMBIENTE_COMPLETO, {
      abrirClienteSistema: f.abrirCliente,
      abrirConexaoDedicada: f.abrirConexaoDedicada,
    });
    expect(comFabricas.requestAcceptance).toBeDefined();
    expect(comFabricas.requestAcceptance?.siteUrl).toBe(SITE);
    expect(comFabricas.pendenciasAceite).toEqual([]);
  });

  it('a rota de aceite e reconhecida apenas por POST no caminho dela', () => {
    expect(isAcceptanceRoute('POST', '/v1/requests/11111111-1111-4111-8111-111111111111/acceptances')).toBe(true);
    expect(isAcceptanceRoute('GET', '/v1/requests/11111111-1111-4111-8111-111111111111/acceptances')).toBe(false);
    expect(isAcceptanceRoute('POST', '/v1/requests/11111111-1111-4111-8111-111111111111')).toBe(false);
  });
});
