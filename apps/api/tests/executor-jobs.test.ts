// Executor dos avisos | Tick oportunista: no maximo uma rodada por minuto por instancia, ignora /health e nunca propaga erro.
import { describe, expect, it } from 'vitest';
import { avisaNaHora, montarExecutorJobs, montarTickOportunista } from '../src/jobs/executor-composicao.js';

describe('montarTickOportunista', () => {
  it('sem executor, nao monta nada', () => {
    expect(montarTickOportunista(undefined)).toBeUndefined();
  });

  it('roda uma vez e ignora chamadas seguintes dentro do mesmo minuto', async () => {
    let rodadas = 0;
    const tick = montarTickOportunista({ rodar: async () => (rodadas++, []) });
    await tick?.('/v1/conversations');
    await tick?.('/v1/conversations');
    expect(rodadas).toBe(1);
  });

  it('nao roda para /health e engole falhas do executor', async () => {
    let rodadas = 0;
    const tick = montarTickOportunista({
      rodar: async () => {
        rodadas++;
        throw new Error('banco fora');
      },
    });
    await tick?.('/health');
    expect(rodadas).toBe(0);
    await expect(tick?.('/v1/requests')).resolves.toBeUndefined();
    expect(rodadas).toBe(1);
  });
});

describe('aviso na hora', () => {
  it('so publicacao, onda, aceite e cancelamento que deram certo', () => {
    expect(avisaNaHora('POST', '/v1/requests/abc/acceptances', 201)).toBe(true);
    expect(avisaNaHora('POST', '/v1/requests/abc/cancel', 200)).toBe(true);
    expect(avisaNaHora('POST', '/v1/requests/abc/acceptances', 409)).toBe(false);
    expect(avisaNaHora('GET', '/v1/requests/abc/cancel', 200)).toBe(false);
    expect(avisaNaHora('POST', '/v1/requests', 201)).toBe(true);
    expect(avisaNaHora('POST', '/v1/requests/abc/more-professionals', 200)).toBe(true);
    expect(avisaNaHora('POST', '/v1/requests/abc/republish', 201)).toBe(false);
  });

  it('ignora a janela de um minuto', async () => {
    let rodadas = 0;
    const tick = montarTickOportunista({ rodar: async () => (rodadas++, []) });
    await tick?.('/v1/requests');
    await tick?.('/v1/requests/abc/acceptances', true);
    expect(rodadas).toBe(2);
  });
});

describe('montarExecutorJobs', () => {
  it('sem banco, SITE_URL ou conexao dedicada, nao monta', () => {
    expect(montarExecutorJobs({})).toBeUndefined();
    expect(montarExecutorJobs({ DATABASE_URL_APP_SYSTEM: 'postgres://x', SITE_URL: 'https://x.test' })).toBeUndefined();
  });
});
