// H-073 (Issue 83) | Ligacao das rotas do caso de acesso e da confirmacao recente no ponto de montagem
// (src/composicao.ts). Em memoria: fabrica SQL falsa, fetch falso, sem banco e sem rede. Pendencias sao so nomes de
// variaveis; nenhum valor sai. Valores sinteticos montados em tempo de execucao.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';
import { ADMIN_AUTH_ENV_OBRIGATORIAS, ADMIN_LIMITES_ENV_OBRIGATORIAS } from '../src/admin-composicao.js';

const SENHA_SINTETICA_CASO = ['senha', 'sintetica', 'caso'].join('-');
const URL_SINTETICA = `postgres://papel-sintetico-caso:${SENHA_SINTETICA_CASO}@127.0.0.1:1/banco-sintetico`;
const BASE = 'https://admin.fastpro.example.test';
const SUPABASE = 'https://projeto-sintetico.example.test';
const CHAVE_PUBLICA = ['chave', 'publica', 'sintetica'].join('-');
const PEPPER_E = ['pepper', 'email', 'sintetico'].join('-');
const PEPPER_I = ['pepper', 'ip', 'sintetico'].join('-');

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
      ...ADMIN_AUTH_ENV_OBRIGATORIAS,
      ...ADMIN_LIMITES_ENV_OBRIGATORIAS,
    ]);
    expect(integracoes.pendencias.join('|')).not.toContain('ADMIN_BASE_URL');
  });

  it('nomes presentes sem a fabrica da borda: nao liga e a pendencia e a fabrica', () => {
    const integracoes = montarIntegracoes({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE });
    expect(integracoes.accessCase).toBeUndefined();
    expect(integracoes.pendenciasCaso).toEqual([
      'fabrica do cliente SQL do caso de acesso (ainda nao montada na funcao)',
      ...ADMIN_AUTH_ENV_OBRIGATORIAS,
      ...ADMIN_LIMITES_ENV_OBRIGATORIAS,
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
    expect(integracoes.pendenciasCaso).toEqual([...ADMIN_AUTH_ENV_OBRIGATORIAS, ...ADMIN_LIMITES_ENV_OBRIGATORIAS]);
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
    auth: { signInWithPasswordAndTotp: async () => null },
    limits: { counts: async () => ({ email: 0, ip: 0 }), recordFailure: async () => undefined },
    log: () => undefined,
  };

  it('sem provedor e limites no ambiente: nao liga e as pendencias citam os nomes que faltam', () => {
    const integracoes = montarIntegracoes(ambiente, { abrirClienteSql: () => clienteFalso() });
    expect(integracoes.adminStepUp).toBeUndefined();
    expect(integracoes.pendenciasCaso).toContain('SUPABASE_URL');
    expect(integracoes.pendenciasCaso).toContain('PEPPER_EMAIL_HMAC');
  });

  it('com provedor parcial (so auth injetado): ainda nao liga; limites seguem pendentes pelo nome', () => {
    const integracoes = montarIntegracoes(ambiente, {
      abrirClienteSql: () => clienteFalso(),
      confirmacaoAdmin: { auth: porta.auth },
    });
    expect(integracoes.adminStepUp).toBeUndefined();
    expect(integracoes.pendenciasCaso).toEqual(['PEPPER_EMAIL_HMAC', 'PEPPER_IP_HMAC']);
  });

  it('com nomes, fabrica e as tres portas injetadas: liga o step-up com a base e o repositorio', () => {
    const integracoes = montarIntegracoes(ambiente, {
      abrirClienteSql: () => clienteFalso(),
      confirmacaoAdmin: porta,
    });
    expect(integracoes.adminStepUp).toBeDefined();
    expect(integracoes.adminStepUp?.baseUrl).toBe(BASE);
    expect(typeof integracoes.adminStepUp?.repo.guard).toBe('function');
    expect(integracoes.pendenciasCaso).toEqual([]);
  });

  it('com os nomes do provedor e dos limites no ambiente: monta sozinho, sem chamar o fetch na montagem', () => {
    let chamadasFetch = 0;
    const fetchFalso = (async () => {
      chamadasFetch += 1;
      throw new Error('nao deve haver rede na montagem');
    }) as typeof fetch;
    // Pares [nome, valor] montados em tempo de execucao (valores sinteticos, nunca reais).
    const ambienteCompleto = Object.fromEntries([
      ['DATABASE_URL_APP_SYSTEM', URL_SINTETICA],
      ['ADMIN_BASE_URL', BASE],
      ['SUPABASE_URL', SUPABASE],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', CHAVE_PUBLICA],
      ['PEPPER_EMAIL_HMAC', PEPPER_E],
      ['PEPPER_IP_HMAC', PEPPER_I],
    ]);
    const integracoes = montarIntegracoes(ambienteCompleto, {
      abrirClienteSql: () => clienteFalso(),
      fetchAuth: fetchFalso,
    });
    expect(integracoes.adminStepUp).toBeDefined();
    expect(integracoes.adminStepUp?.baseUrl).toBe(BASE);
    expect(integracoes.pendenciasCaso).toEqual([]);
    expect(chamadasFetch).toBe(0);
    expect(JSON.stringify(integracoes.adminStepUp)).not.toContain(CHAVE_PUBLICA);
    expect(JSON.stringify(integracoes.adminStepUp)).not.toContain(PEPPER_E);
  });
});
