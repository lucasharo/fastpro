// Issue 156 | Montagem do rascunho e da sugestao de endereco: ligam so com as variaveis completas.
// Nenhum valor real: a chave e o token sao de teste, e as URLs nunca sao abertas (so montagem).
import { describe, expect, it } from 'vitest';
import { montarRascunho, type DraftPortsFactory } from '../src/drafts/compose.js';
import { montarSugestaoEndereco } from '../src/geo/composicao-sugestao.js';

const fabrica = { criar: () => ({ store: {}, rate: {} }) } as unknown as DraftPortsFactory;
const ambienteRascunho = {
  DATABASE_URL_APP_API: 'postgres://app-api.invalid/db',
  DRAFT_IP_HMAC_KEY: 'k'.repeat(32),
  SITE_URL: 'http://127.0.0.1:3014',
};
const ambienteSugestao = {
  ...ambienteRascunho,
  DATABASE_URL_APP_SYSTEM: 'postgres://app-system.invalid/db',
  MAPBOX_ACCESS_TOKEN: 'token-de-teste',
  MAPBOX_TEMP_SOFT_LIMIT: '900',
  MAPBOX_TEMP_HARD_LIMIT: '1000',
};

describe('montagem do rascunho e da sugestao de endereco (Issue 156)', () => {
  it('montarRascunho liga com as tres variaveis e a fabrica', () => {
    expect(montarRascunho(ambienteRascunho, fabrica)).toBeDefined();
  });

  it('montarRascunho nao liga sem a chave do IP', () => {
    const sem: Record<string, string | undefined> = { ...ambienteRascunho };
    delete sem.DRAFT_IP_HMAC_KEY;
    expect(montarRascunho(sem, fabrica)).toBeUndefined();
  });

  it('montarSugestaoEndereco liga com rascunho e variaveis completas', () => {
    const rascunho = montarRascunho(ambienteRascunho, fabrica);
    expect(montarSugestaoEndereco(ambienteSugestao, { rascunho, abrirCliente: () => ({ query: async () => ({ rows: [] }) }) } as never)).toBeDefined();
  });

  it('montarSugestaoEndereco nao liga sem o token do Mapbox', () => {
    const sem: Record<string, string | undefined> = { ...ambienteSugestao };
    delete sem.MAPBOX_ACCESS_TOKEN;
    const rascunho = montarRascunho(ambienteRascunho, fabrica);
    expect(montarSugestaoEndereco(sem, { rascunho })).toBeUndefined();
  });
});
