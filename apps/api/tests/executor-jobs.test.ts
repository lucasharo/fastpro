// Executor dos avisos | Tick oportunista: no maximo uma rodada por minuto por instancia, ignora /health e nunca propaga erro.
import { describe, expect, it } from 'vitest';
import { montarExecutorJobs, montarTickOportunista } from '../src/jobs/executor-composicao.js';

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

describe('montarExecutorJobs', () => {
  it('sem banco, SITE_URL ou conexao dedicada, nao monta', () => {
    expect(montarExecutorJobs({})).toBeUndefined();
    expect(montarExecutorJobs({ DATABASE_URL_APP_SYSTEM: 'postgres://x', SITE_URL: 'https://x.test' })).toBeUndefined();
  });
});
