// Issue 68 (H-055) | Limite de taxa da descoberta com cliente falso (docs/factory/153-DESENHO-H055.md, §2 A-3;
// T-H055-10, base). Sem banco: chave com prefixo discovery:, parametros na ordem de rl_check/rl_hit e
// Retry-After limitado. O id do profissional nunca aparece na chave enviada.
import { describe, it, expect } from 'vitest';
import { DISCOVERY_RATE_LIMIT, PgDiscoveryRateLimit } from '../src/discovery-rate-limit.js';

type Chamada = { sql: string; params: unknown[] | undefined };

const PROF = '00000000-0000-4000-8000-000000000001';
const HMAC = 'a'.repeat(64);
const NOW = Date.parse('2099-08-15T12:00:00.000Z');

function clienteFalso(linha: Record<string, unknown> | undefined) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        chamadas.push({ sql, params });
        return { rows: linha === undefined ? [] : [linha] };
      },
    },
  };
}

function limitador(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) {
  return new PgDiscoveryRateLimit({ client, chaveDoProfissional: () => HMAC });
}

describe('PgDiscoveryRateLimit (Issue 68)', () => {
  it('limite de 60 por minuto com janela e bucket de 60 s', () => {
    expect(DISCOVERY_RATE_LIMIT).toEqual({ limit: 60, spanSeconds: 60, bucketSeconds: 60 });
  });

  it('check chama rl_check com chave discovery: + HMAC e os parametros na ordem', async () => {
    const f = clienteFalso({ out_ok: true, out_retry_after: 0 });
    const decisao = await limitador(f.client).check(PROF, NOW);
    expect(decisao).toEqual({ decision: 'permitido' });
    expect(f.chamadas[0].sql).toContain('private.rl_check');
    expect(f.chamadas[0].params).toEqual([`discovery:${HMAC}`, 60, 60, 60, new Date(NOW).toISOString()]);
  });

  it('barrado devolve Retry-After vindo do banco, limitado pelo dominio', async () => {
    const f = clienteFalso({ out_ok: false, out_retry_after: 17 });
    expect(await limitador(f.client).check(PROF, NOW)).toEqual({ decision: 'barrado', retryAfterSeconds: 17 });
  });

  it('resposta sem booleano de out_ok falha com codigo fixo', async () => {
    const f = clienteFalso({ out_ok: 'sim' });
    await expect(limitador(f.client).check(PROF, NOW)).rejects.toThrow('rate_limit_resposta_invalida');
  });

  it('sem linha de resposta falha com codigo fixo', async () => {
    const f = clienteFalso(undefined);
    await expect(limitador(f.client).check(PROF, NOW)).rejects.toThrow('rate_limit_resposta_invalida');
  });

  it('record chama rl_hit com chave discovery: e o instante', async () => {
    const f = clienteFalso(undefined);
    await limitador(f.client).record(PROF, NOW);
    expect(f.chamadas[0].sql).toContain('private.rl_hit');
    expect(f.chamadas[0].params).toEqual([`discovery:${HMAC}`, 60, new Date(NOW).toISOString()]);
  });

  it('o id do profissional nunca aparece na chave enviada ao banco', async () => {
    const f = clienteFalso({ out_ok: true, out_retry_after: 0 });
    await limitador(f.client).check(PROF, NOW);
    await limitador(f.client).record(PROF, NOW);
    for (const c of f.chamadas) {
      expect(JSON.stringify(c.params)).not.toContain(PROF);
    }
  });
});
