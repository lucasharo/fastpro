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

  it('um cliente por montagem: dois registros reaproveitam a mesma conexao (chave e rotulo fixo, nao a URL)', () => {
    const abertos: string[] = [];
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, {
      abrirCliente: (url) => (abertos.push(url), clienteFalso()),
      caminhoDoObjeto: caminho,
      chaveDoStorage: CHAVE_SINTETICA,
      relogio: { nowMs: () => 0 },
    });
    resultado.registrar?.(new JobRegistry());
    resultado.registrar?.(new JobRegistry());
    expect(abertos).toEqual([URL_SINTETICA]);
  });

  it('fetchImpl da montagem e repassado ao Storage da quarentena: o handler usa so o fetch injetado', async () => {
    const chamadas: string[] = [];
    const fetchInjetado = (async (entrada: string | URL | Request) => {
      chamadas.push(String(entrada));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const cliente = {
      query: async (sql: string) => {
        if (sql.includes('ops_purge_media_orfaos')) {
          return { rows: [{ out_estado: 'ok', out_nomes: ['orfa/original.jpg'], out_retidos: 0 }] };
        }
        if (sql.includes('ops_purge_audit')) return { rows: [{ id: 'audit-1' }] };
        return { rows: [{ out_estado: 'desligado', out_removidos: 0, out_retidos: 0, out_falhos: 0, ids: [] }] };
      },
    } as unknown as SqlClient;
    const resultado = montarExpurgoOperacional(ENV_COMPLETO, {
      abrirCliente: () => cliente,
      caminhoDoObjeto: caminho,
      chaveDoStorage: CHAVE_SINTETICA,
      relogio: { nowMs: () => 0 },
      fetchImpl: fetchInjetado,
    });
    const registro = new JobRegistry();
    resultado.registrar?.(registro);
    await registro.get('ops.purge')!.run({ id: 'job-1' } as never);
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas[0]).toContain(BASE_SINTETICA);
  });
});
