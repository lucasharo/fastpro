// H-016 | Montagem do profissional (professional-composicao.ts) sem rede e sem banco: cliente falso, transporte
// HTTP falso e variaveis sinteticas. Confere que sem as variaveis nada monta (so nomes nas pendencias), que com
// elas as quatro opcoes existem e que a montagem nao chama o provedor nem o banco.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-016');
};

import { describe, expect, it } from 'vitest';
import { montarProfissional, PROFISSIONAL_ENV_OBRIGATORIAS } from '../src/professional-composicao.js';

const SEGREDO_SINTETICO = 'segredo-sintetico-nao-real-0123456789';

const ENV_COMPLETO: Record<string, string> = {
  DATABASE_URL_APP_SYSTEM: 'postgres://app_system:senha@127.0.0.1:1/teste',
  SUPABASE_URL: 'https://projeto-sintetico.example.test',
  SUPABASE_SECRET_KEY: SEGREDO_SINTETICO,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publicavel-sintetica',
  PEPPER_EMAIL_HMAC: 'p'.repeat(32),
  PEPPER_IP_HMAC: 'i'.repeat(32),
  SITE_URL: 'https://app.example.test',
  APP_ENV: 'test',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'onboarding@resend.dev',
  RESEND_API_KEY: 'chave-sintetica-nao-real',
  RESEND_ACCOUNT_RECIPIENT: 'conta.sintetica@example.test',
  RESEND_VERIFIED_DOMAIN: '',
};

function opcoesFalsas() {
  const chamadas = { banco: 0, http: 0 };
  return {
    chamadas,
    opcoes: {
      abrirCliente: () => {
        chamadas.banco += 1;
        return { query: async () => ({ rows: [] }) } as never;
      },
      relogio: { nowMs: () => Date.UTC(2099, 0, 1) },
      http: {
        async post() {
          chamadas.http += 1;
          return { status: 200, headers: {}, body: '{}' };
        },
      },
    },
  };
}

describe('montarProfissional sem variaveis (404 e so nomes nas pendencias)', () => {
  it('lista todos os nomes obrigatorios que faltam e nao monta nada', () => {
    const { opcoes, chamadas } = opcoesFalsas();
    const r = montarProfissional({}, opcoes);
    expect(r.professional).toBeUndefined();
    expect(r.professionalAccount).toBeUndefined();
    expect(r.professionalRecovery).toBeUndefined();
    expect(r.professionalPassword).toBeUndefined();
    expect([...r.pendencias].sort()).toEqual([...PROFISSIONAL_ENV_OBRIGATORIAS].sort());
    expect(chamadas).toEqual({ banco: 0, http: 0 });
  });

  it('pendencias nunca trazem valor de segredo', () => {
    const { opcoes } = opcoesFalsas();
    const env = { ...ENV_COMPLETO, SITE_URL: undefined, PEPPER_IP_HMAC: undefined };
    const r = montarProfissional(env, opcoes);
    expect(r.pendencias.join(' ')).not.toContain(SEGREDO_SINTETICO);
    expect(r.pendencias).toEqual(expect.arrayContaining(['SITE_URL', 'PEPPER_IP_HMAC']));
  });

  it('origem com barra final: recusada pelo adaptador de e-mail e apontada pelo nome', () => {
    const { opcoes } = opcoesFalsas();
    const r = montarProfissional({ ...ENV_COMPLETO, SITE_URL: 'https://app.example.test/' }, opcoes);
    expect(r.professional).toBeUndefined();
    expect(r.pendencias.join(' ')).toContain('SITE_URL');
  });

  it('configuracao de e-mail recusada: nada monta e a pendencia diz so o nome do bloco', () => {
    const { opcoes } = opcoesFalsas();
    const r = montarProfissional({ ...ENV_COMPLETO, EMAIL_PROVIDER: 'inexistente' }, opcoes);
    expect(r.professional).toBeUndefined();
    expect(r.pendencias).toEqual(['EMAIL (configuracao recusada pelo adaptador)']);
  });
});

describe('montarProfissional com variaveis completas', () => {
  it('monta as quatro opcoes sem chamar provedor nem banco na montagem', () => {
    const { opcoes, chamadas } = opcoesFalsas();
    const r = montarProfissional(ENV_COMPLETO, opcoes);
    expect(r.pendencias).toEqual([]);
    expect(r.professional).toBeDefined();
    expect(r.professional?.port).toBeDefined();
    expect(r.professional?.limits).toBeDefined();
    expect(r.professionalAccount?.port).toBeDefined();
    expect(r.professionalRecovery?.port).toBeDefined();
    expect(r.professionalPassword?.port).toBeDefined();
    expect(chamadas.http).toBe(0);
  });

  it('o relogio informado e o das opcoes (sem sleep real ao montar)', () => {
    const { opcoes } = opcoesFalsas();
    const r = montarProfissional(ENV_COMPLETO, opcoes);
    expect(r.professional?.clock.nowMs()).toBe(Date.UTC(2099, 0, 1));
  });
});
