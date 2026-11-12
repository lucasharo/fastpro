// H-073 (Issue 83) | Ligacao das rotas do caso de acesso no ponto de montagem (src/composicao.ts). Em memoria:
// fabrica SQL falsa, sem banco e sem rede. Pendencias sao so nomes de variaveis; nenhum valor sai.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';

const SENHA_SINTETICA_CASO = ['senha', 'sintetica', 'caso'].join('-');
const URL_SINTETICA = `postgres://papel-sintetico-caso:${SENHA_SINTETICA_CASO}@127.0.0.1:1/banco-sintetico`;
const BASE = 'https://admin.fastpro.example.test';

function clienteFalso(): SqlClient {
  return { async query() { return { rows: [] }; } };
}

describe('montarIntegracoes: rotas do caso de acesso (H-073)', () => {
  it('sem as variaveis: caso nao liga, pendencias sao so os nomes que faltam', () => {
    const integracoes = montarIntegracoes({}, { abrirClienteSql: () => clienteFalso() });
    expect(integracoes.accessCase).toBeUndefined();
    expect(integracoes.pendenciasCaso).toEqual(['DATABASE_URL_APP_SYSTEM', 'ADMIN_BASE_URL']);
    expect(integracoes.pendencias.join('|')).not.toContain('ADMIN_BASE_URL');
  });

  it('nomes presentes sem a fabrica da borda: nao liga e a pendencia e a fabrica', () => {
    const integracoes = montarIntegracoes({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE });
    expect(integracoes.accessCase).toBeUndefined();
    expect(integracoes.pendenciasCaso).toEqual([
      'fabrica do cliente SQL do caso de acesso (ainda nao montada na funcao)',
    ]);
  });

  it('nomes presentes e fabrica: liga as rotas; a fabrica recebe a string e nada e consultado na montagem', () => {
    const recebidas: string[] = [];
    const integracoes = montarIntegracoes(
      { DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE },
      {
        abrirClienteSql: (url) => {
          recebidas.push(url);
          return clienteFalso();
        },
      },
    );
    expect(integracoes.accessCase).toBeDefined();
    expect(integracoes.accessCase?.baseUrl).toBe(BASE);
    expect(integracoes.pendenciasCaso).toEqual([]);
    expect(recebidas).toEqual([URL_SINTETICA]);
  });

  it('a URL de conexao nunca aparece nas pendencias nem nas opcoes montadas', () => {
    const integracoes = montarIntegracoes({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE }, {
      abrirClienteSql: () => clienteFalso(),
    });
    expect(JSON.stringify(integracoes.pendenciasCaso)).not.toContain(SENHA_SINTETICA_CASO);
    expect(JSON.stringify(integracoes.accessCase)).not.toContain(URL_SINTETICA);
  });
});
