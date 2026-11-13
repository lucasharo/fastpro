// H-110 (Issue 119) | Composicao do expurgo operacional (montarExpurgoOperacional), em memoria. Sem banco e sem rede:
// valores sinteticos (placeholders de repeticao), fetch global bloqueado e cliente SQL falso.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de composicao');
};

import { describe, expect, it } from 'vitest';
import { JobRegistry, type SqlClient } from '@fastpro/db';
import { montarExpurgoOperacional } from '../src/composicao.js';

const URL_SINTETICA = 'postgres://app_system_sintetico@db.example.test:5432/exemplo';
const BASE_SINTETICA = 'https://projeto-sintetico.example.test';
const CHAVE_SINTETICA = 'y'.repeat(40);

const ENV_COMPLETO = {
  DATABASE_URL_APP_SYSTEM: URL_SINTETICA,
  SUPABASE_URL: BASE_SINTETICA,
};

const PENDENCIA_CLIENTE = 'fabrica do cliente SQL do expurgo (ainda nao montada na funcao)';
const PENDENCIA_CAMINHO = 'caminho do objeto da quarentena (formato da Issue 141, ainda nao definido)';
const PENDENCIA_CHAVE = 'chave do Storage da quarentena (lida pelo modulo de midia, decisao 152)';

const caminho = (id: string): string => `${id}/original`;

function clienteFalso(): SqlClient {
  return { query: async () => ({ rows: [] }) } as unknown as SqlClient;
}

describe('montarExpurgoOperacional (H-110, Issue 119)', () => {
  it('sem ambiente e sem portas, lista todas as pendencias, sem registro e sem abrir cliente', () => {
    const abertos: string[] = [];
    const resultado = montarExpurgoOperacional({}, { abrirCliente: (url) => (abertos.push(url), clienteFalso()) });
    expect(resultado.registrar).toBeUndefined();
    expect(resultado.pendencias).toEqual([
      'DATABASE_URL_APP_SYSTEM',
      'SUPABASE_URL',
      PENDENCIA_CAMINHO,
      PENDENCIA_CHAVE,
    ]);
    expect(abertos).toEqual([]);
  });

  it('sem a fabrica do cliente e sem o caminho da quarentena, as duas portas aparecem como pendencia', () => {
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, { chaveDoStorage: CHAVE_SINTETICA });
    expect(resultado.registrar).toBeUndefined();
    expect(resultado.pendencias).toEqual([PENDENCIA_CLIENTE, PENDENCIA_CAMINHO]);
  });

  it('chave do Storage vazia conta como ausente', () => {
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, {
      abrirCliente: () => clienteFalso(),
      caminhoDoObjeto: caminho,
      chaveDoStorage: '   ',
    });
    expect(resultado.registrar).toBeUndefined();
    expect(resultado.pendencias).toEqual([PENDENCIA_CHAVE]);
  });

  it('pendencias so trazem nomes e descricoes: nenhum valor de URL, endereco ou chave aparece no resultado', () => {
    const resultado = montarExpurgoOperacional(
      { DATABASE_URL_APP_SYSTEM: URL_SINTETICA, SUPABASE_URL: BASE_SINTETICA },
      { chaveDoStorage: CHAVE_SINTETICA, abrirCliente: () => clienteFalso() },
    );
    const texto = JSON.stringify(resultado);
    expect(resultado.pendencias).toEqual([PENDENCIA_CAMINHO]);
    expect(texto).not.toContain(URL_SINTETICA);
    expect(texto).not.toContain(BASE_SINTETICA);
    expect(texto).not.toContain(CHAVE_SINTETICA);
  });

  it('com tudo completo, monta sem abrir conexao; o cliente so nasce ao registrar', () => {
    const abertos: string[] = [];
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, {
      abrirCliente: (url) => (abertos.push(url), clienteFalso()),
      caminhoDoObjeto: caminho,
      chaveDoStorage: CHAVE_SINTETICA,
    });
    expect(resultado.pendencias).toEqual([]);
    expect(resultado.registrar).toBeDefined();
    expect(abertos).toEqual([]);
  });

  it('registrar() coloca o handler ops.purge no JobRegistry e abre o cliente uma vez pela URL do papel app_system', () => {
    const abertos: string[] = [];
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, {
      abrirCliente: (url) => (abertos.push(url), clienteFalso()),
      caminhoDoObjeto: caminho,
      chaveDoStorage: CHAVE_SINTETICA,
      relogio: { nowMs: () => 0 },
    });
    const registro = new JobRegistry();
    resultado.registrar?.(registro);
    expect(registro.get('ops.purge')).toBeDefined();
    expect(abertos).toEqual([URL_SINTETICA]);
  });
});
