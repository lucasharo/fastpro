// H-093 | Transporte fetch: so e chamado depois das travas do Resend (desenho 37 §3). Sem rede:
// o fetch global e bloqueado e o fetch injetado conta as chamadas.
import { FakeClock } from '@fastpro/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEmailProvider,
  createFetchHttpTransport,
  createMinimalRenderer,
  HttpTransportError,
  RESEND_ENDPOINT,
} from '../src/index.js';
import type { EmailEnv } from '../src/index.js';
import { FakeSmtp } from './doubles.js';

const CHAVE_T = 'chave-ficticia-0002';
const CHAVE_IDEM = 'chave-transporte-1';
const realFetch = globalThis.fetch;
const CONTA = 'conta.titular@fastpro.test';
const CLIENTE = 'cliente.exemplo@fastpro.test';

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('rede bloqueada nos testes (H-093)');
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function fakeFetch(calls: unknown[], status = 200) {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 're_transporte' }), { status });
  }) as unknown as typeof fetch;
}

function resendWith(env: EmailEnv, fetchImpl: typeof fetch) {
  return createEmailProvider(env, {
    smtp: new FakeSmtp(),
    http: createFetchHttpTransport(fetchImpl),
    renderer: createMinimalRenderer(),
    clock: new FakeClock(),
  });
}

const msg = (to: string) => ({
  to,
  templateKey: 'aviso_teste',
  params: {},
  idempotencyKey: CHAVE_IDEM,
});

describe('fetch so depois das travas', () => {
  it.each([
    ['marcador vazio', { RESEND_VERIFIED_DOMAIN: '' }, CLIENTE],
    [
      'remetente de teste, destino que nao e a conta',
      { EMAIL_FROM: 'onboarding@resend.dev', RESEND_ACCOUNT_RECIPIENT: CONTA },
      CLIENTE,
    ],
    ['chave ausente', { RESEND_API_KEY: '' }, CLIENTE],
  ])('%s: fetch nao e chamado', async (_label, change, to) => {
    const calls: unknown[] = [];
    const env: EmailEnv = {
      APP_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'Equipe <avisos@fastpro.test>',
      RESEND_VERIFIED_DOMAIN: 'fastpro.test',
      RESEND_API_KEY: CHAVE_T,
      ...change,
    };
    const res = await resendWith(env, fakeFetch(calls)).send(msg(to));
    expect(res.kind).not.toBe('aceito');
    expect(calls).toHaveLength(0);
  });

  it('com as travas cumpridas, fetch e chamado uma vez no endereco e metodo do Resend', async () => {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const env: EmailEnv = {
      APP_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'onboarding@resend.dev',
      RESEND_API_KEY: CHAVE_T,
      RESEND_ACCOUNT_RECIPIENT: CONTA,
    };
    const res = await resendWith(env, fakeFetch(calls)).send(msg(CONTA));
    expect(res).toEqual({ kind: 'aceito', providerMessageId: 're_transporte' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(RESEND_ENDPOINT);
    expect((calls[0]?.init as { method?: string }).method).toBe('POST');
  });

  it('abort por tempo limite vira HttpTransportError timeout', async () => {
    const abortFetch = (async () => {
      const err = new Error('tempo esgotado');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;
    const transport = createFetchHttpTransport(abortFetch);
    await expect(
      transport.post({ url: RESEND_ENDPOINT, headers: {}, body: '{}', timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await expect(
      transport.post({ url: RESEND_ENDPOINT, headers: {}, body: '{}', timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(HttpTransportError);
  });
});
