// H-073 (Issue 83) / H-015 | PgAdminLoginLimits (src/admin-login-limits.ts): cliente falso, sem banco.
// Confere o uso de private.rl_check e private.rl_hit (limites 5 por e-mail e 20 por IP, janela de 15 min) e que
// as chaves enviadas ao banco sao as HMAC da borda, nunca o e-mail ou o IP em claro.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PgAdminLoginLimits, ADMIN_LOGIN_BUCKET_S, ADMIN_LOGIN_SPAN_S } from '../src/admin-login-limits.js';

type Call = { text: string; params: unknown[] };

/** Cliente falso com respostas em fila (uma por chamada). */
function fakeClient(respostas: Record<string, unknown>[][]) {
  const calls: Call[] = [];
  const fila = [...respostas];
  return {
    calls,
    client: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        return { rows: fila.shift() ?? [] };
      },
    },
  };
}

const EMAIL = 'admin.sintetico@example.test';
const IP = '203.0.113.7';
const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const iso = new Date(NOW).toISOString();
/** Chaves de teste (64 hex, como a HMAC real); o prefixo mostra a origem sem expor o valor. */
const digest = (prefixo: string, valor: string) => createHash('sha256').update(`${prefixo}:${valor}`).digest('hex');
const chaves = {
  email: (e: string) => digest('email', e),
  ip: (i: string) => digest('ip', i),
};

describe('PgAdminLoginLimits: bloqueio por rl_check (5 por e-mail, 20 por IP)', () => {
  it('sem falhas na janela: contagens zero; consulta usa janela de 15 min e balde de 1 min', async () => {
    const { client, calls } = fakeClient([[{ out_ok: true }], [{ out_ok: true }]]);
    const limites = new PgAdminLoginLimits(client, chaves);
    expect(await limites.counts({ email: EMAIL, ip: IP }, NOW)).toEqual({ email: 0, ip: 0 });
    expect(calls[0]?.text).toContain('private.rl_check(');
    expect(calls[0]?.params).toEqual([chaves.email(EMAIL), ADMIN_LOGIN_SPAN_S, ADMIN_LOGIN_BUCKET_S, 5, iso]);
    expect(calls[1]?.params).toEqual([chaves.ip(IP), ADMIN_LOGIN_SPAN_S, ADMIN_LOGIN_BUCKET_S, 20, iso]);
  });

  it('e-mail bloqueado (rl_check recusa): devolve o limite de e-mail; IP livre continua zero', async () => {
    const { client } = fakeClient([[{ out_ok: false }], [{ out_ok: true }]]);
    const r = await new PgAdminLoginLimits(client, chaves).counts({ email: EMAIL, ip: IP }, NOW);
    expect(r).toEqual({ email: 5, ip: 0 });
  });

  it('IP bloqueado: devolve o limite de IP', async () => {
    const { client } = fakeClient([[{ out_ok: true }], [{ out_ok: false }]]);
    const r = await new PgAdminLoginLimits(client, chaves).counts({ email: EMAIL, ip: IP }, NOW);
    expect(r).toEqual({ email: 0, ip: 20 });
  });

  it('resposta sem booleano do banco: erro, sem liberar nem bloquear por suposicao', async () => {
    const { client } = fakeClient([[{ out_ok: null }]]);
    await expect(new PgAdminLoginLimits(client, chaves).counts({ email: EMAIL, ip: IP }, NOW)).rejects.toThrow(
      'rate_limit_resposta_invalida',
    );
  });
});

describe('PgAdminLoginLimits: registro de falha (rl_hit) e privacidade', () => {
  it('recordFailure incrementa o balde de e-mail e o de IP, com as chaves HMAC', async () => {
    const { client, calls } = fakeClient([[], []]);
    await new PgAdminLoginLimits(client, chaves).recordFailure({ email: EMAIL, ip: IP }, NOW);
    expect(calls.map((c) => c.text)).toEqual([expect.stringContaining('private.rl_hit('), expect.stringContaining('private.rl_hit(')]);
    expect(calls[0]?.params).toEqual([chaves.email(EMAIL), ADMIN_LOGIN_BUCKET_S, iso]);
    expect(calls[1]?.params).toEqual([chaves.ip(IP), ADMIN_LOGIN_BUCKET_S, iso]);
  });

  it('nenhum parametro enviado ao banco contem e-mail ou IP em claro', async () => {
    const { client, calls } = fakeClient([[{ out_ok: true }], [{ out_ok: true }], [], []]);
    const limites = new PgAdminLoginLimits(client, chaves);
    await limites.counts({ email: EMAIL, ip: IP }, NOW);
    await limites.recordFailure({ email: EMAIL, ip: IP }, NOW);
    const texto = JSON.stringify(calls);
    expect(texto).not.toContain(EMAIL);
    expect(texto).not.toContain(IP);
  });
});
