// H-037 (Issue #50) | Trava de producao (T-23; decisoes 171 e 219). Sem IDENTITY_DOCS_ENABLED=1 a rota fica fechada;
// com VERCEL_ENV=production tambem exige IDENTITY_DOCS_L1_PARECER=1. Pendencias saem so com nomes de variaveis.
import { describe, expect, it } from 'vitest';
import { montarDocumentosIdentidade } from '../src/identity-docs/identity-doc-composicao.js';

const portasFalsas = {
  rota: {
    sessions: { authenticate: async () => null } as never,
    perfis: { existe: async () => true },
    deps: {} as never,
  },
  siteUrl: 'https://fastpro.test',
};

describe('H-037 | trava de producao (T-23)', () => {
  it('sem IDENTITY_DOCS_ENABLED: fechado, sem pendencias e sem valor algum', () => {
    expect(montarDocumentosIdentidade({}, portasFalsas)).toEqual({ options: null, pendencias: [] });
    expect(montarDocumentosIdentidade({ IDENTITY_DOCS_ENABLED: '0' }, portasFalsas).options).toBeNull();
    expect(montarDocumentosIdentidade({ IDENTITY_DOCS_ENABLED: 'true' }, portasFalsas).options).toBeNull();
  });

  it('desenvolvimento com ENABLED=1: aberto sem exigir o parecer', () => {
    const r = montarDocumentosIdentidade({ IDENTITY_DOCS_ENABLED: '1', VERCEL_ENV: 'preview' }, portasFalsas);
    expect(r.options).not.toBeNull();
    expect(r.options?.siteUrl).toBe('https://fastpro.test');
    expect(r.pendencias).toEqual([]);
  });

  it('producao com ENABLED=1 e sem parecer L1: continua fechado e aponta so o nome da variavel', () => {
    const r = montarDocumentosIdentidade({ IDENTITY_DOCS_ENABLED: '1', VERCEL_ENV: 'production' }, portasFalsas);
    expect(r.options).toBeNull();
    expect(r.pendencias).toEqual(['IDENTITY_DOCS_L1_PARECER']);
    expect(JSON.stringify(r)).not.toContain('1,');
  });

  it('producao com ENABLED=1 e IDENTITY_DOCS_L1_PARECER=1: abre (parecer registrado)', () => {
    const r = montarDocumentosIdentidade(
      { IDENTITY_DOCS_ENABLED: '1', VERCEL_ENV: 'production', IDENTITY_DOCS_L1_PARECER: '1' },
      portasFalsas,
    );
    expect(r.options).not.toBeNull();
    expect(r.pendencias).toEqual([]);
  });

  it('so o parecer, sem ENABLED, nao abre nada', () => {
    expect(montarDocumentosIdentidade({ IDENTITY_DOCS_L1_PARECER: '1', VERCEL_ENV: 'production' }, portasFalsas).options).toBeNull();
  });
});
