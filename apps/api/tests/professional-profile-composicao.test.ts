// H-035 | Montagem das rotas do perfil profissional a partir do ambiente (sem banco, sem rede).
// As chaves de teste sao geradas aqui, na hora; nenhum valor real. Confere-se que as pendencias trazem so
// nomes e que a fabrica de cliente SQL recebe a URL uma vez.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { SqlClient } from '@fastpro/db';
import { montarPerfilProfissional, PERFIL_PROFISSIONAL_CIFRA_NOME } from '../src/professional-profile-composicao.js';
import { montarIntegracoes } from '../src/composicao.js';

const URL_BANCO = 'postgres://sintetica@localhost:5432/teste';
const cliente: SqlClient = { query: async () => ({ rows: [] }) };

const chaves = () => ({
  DOCUMENT_HMAC_KEY: randomBytes(32).toString('base64'),
  DATA_ENC_KEY_ACTIVE_VERSION: '1',
  DATA_ENC_KEY_V1: randomBytes(32).toString('base64'),
});

describe('montarPerfilProfissional (H-035)', () => {
  it('sem variaveis nem fabrica: nao liga e lista so os nomes', () => {
    const r = montarPerfilProfissional({});
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([
      'DATABASE_URL_APP_SYSTEM',
      'SITE_URL',
      'fabrica do cliente SQL do perfil (ainda nao montada na funcao)',
      PERFIL_PROFISSIONAL_CIFRA_NOME,
    ]);
  });

  it('completo com fabrica: monta as opcoes e abre o cliente uma vez por URL', () => {
    const env = { DATABASE_URL_APP_SYSTEM: URL_BANCO, SITE_URL: 'https://fastpro.example.test', ...chaves() };
    let aberturas = 0;
    const abrir = (url: string): SqlClient => {
      expect(url).toBe(URL_BANCO);
      aberturas += 1;
      return cliente;
    };
    const a = montarPerfilProfissional(env, { abrirCliente: abrir });
    const b = montarPerfilProfissional(env, { abrirCliente: abrir });
    expect(a.pendencias).toEqual([]);
    expect(a.options).toBeDefined();
    expect(a.options!.siteUrl).toBe('https://fastpro.example.test');
    expect(a.options!.sessions).toBeDefined();
    expect(a.options!.profiles).toBeDefined();
    expect(typeof a.options!.secrets.encrypt).toBe('function');
    expect(b.options).toBeDefined();
    expect(aberturas).toBe(1);
  });

  it('chave de cifra invalida: pendencia so com o nome, sem o valor', () => {
    const invalida = 'segredo-curto-sintetico';
    const env = {
      DATABASE_URL_APP_SYSTEM: URL_BANCO,
      SITE_URL: 'https://fastpro.example.test',
      ...chaves(),
      DOCUMENT_HMAC_KEY: invalida,
    };
    const r = montarPerfilProfissional(env, { abrirCliente: () => cliente });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([PERFIL_PROFISSIONAL_CIFRA_NOME]);
    expect(JSON.stringify(r)).not.toContain(invalida);
  });

  it('montarIntegracoes expoe o perfil e as pendencias proprias sem mudar as da busca', () => {
    const r = montarIntegracoes({});
    expect(r.professionalProfile).toBeUndefined();
    expect(r.pendenciasPerfil).toContain('DATABASE_URL_APP_SYSTEM');
    expect(r.pendenciasPerfil).toContain('SITE_URL');
    expect(r.pendenciasPerfil).not.toContain('DATABASE_URL_APP_SYSTEM (curta)');
  });
});
