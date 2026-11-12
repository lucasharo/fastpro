// H-073 (Issue 83) | Ligacao das rotas do caso de acesso no ponto de montagem (src/composicao.ts). Em memoria:
// fabrica SQL falsa, sem banco e sem rede. Pendencias sao so nomes de variaveis; nenhum valor sai.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';
import { ADMIN_CONFIRMACAO_PORTAS_FALTANTES } from '../src/admin-composicao.js';

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
    expect(integracoes.pendenciasCaso).toEqual([
      'DATABASE_URL_APP_SYSTEM',
      'ADMIN_BASE_URL',
      ...ADMIN_CONFIRMACAO_PORTAS_FALTANTES,
    ]);
    expect(integracoes.pendencias.join('|')).not.toContain('ADMIN_BASE_URL');
  });

  it('nomes presentes sem a fabrica da borda: nao liga e a pendencia e a fabrica', () => {
    const integracoes = montarIntegracoes({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE });
    expect(integracoes.accessCase).toBeUndefined();
    expect(integracoes.pendenciasCaso).toEqual([
      'fabrica do cliente SQL do caso de acesso (ainda nao montada na funcao)',
      ...ADMIN_CONFIRMACAO_PORTAS_FALTANTES,
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
    // Caso ligado: a unica pendencia que sobra e a confirmacao (step-up), que nao tem adaptador ainda.
    expect(integracoes.pendenciasCaso).toEqual([...ADMIN_CONFIRMACAO_PORTAS_FALTANTES]);
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

describe('montarIntegracoes: confirmacao recente do segundo fator (step-up, H-073 60 §4)', () => {
  const ambiente = { DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE };
  const porta = {
    auth: { enrollUser: async () => null, confirmEnrollment: async () => false, signInWithPasswordAndTotp: async () => null },
    limits: { counts: async () => ({ email: 0, ip: 0 }), recordFailure: async () => undefined },
    log: () => undefined,
  };

  it('sem o provedor de login e os limites: nao liga e as pendencias citam as duas portas pelo nome', () => {
    const integracoes = montarIntegracoes(ambiente, { abrirClienteSql: () => clienteFalso() });
    expect(integracoes.adminStepUp).toBeUndefined();
    expect(integracoes.pendenciasCaso.join('|')).toContain('AdminAuthPort');
    expect(integracoes.pendenciasCaso.join('|')).toContain('AdminLoginLimits');
  });

  it('com provedor parcial (so auth): ainda nao liga', () => {
    const integracoes = montarIntegracoes(ambiente, {
      abrirClienteSql: () => clienteFalso(),
      confirmacaoAdmin: { auth: porta.auth },
    });
    expect(integracoes.adminStepUp).toBeUndefined();
  });

  it('com nomes, fabrica e as tres portas: liga o step-up com a base e o repositorio', () => {
    const integracoes = montarIntegracoes(ambiente, {
      abrirClienteSql: () => clienteFalso(),
      confirmacaoAdmin: porta,
    });
    expect(integracoes.adminStepUp).toBeDefined();
    expect(integracoes.adminStepUp?.baseUrl).toBe(BASE);
    expect(typeof integracoes.adminStepUp?.repo.guard).toBe('function');
    expect(integracoes.pendenciasCaso.join('|')).not.toContain('AdminAuthPort');
  });
});
