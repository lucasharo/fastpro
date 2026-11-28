// H-014 | Testes unitarios do codigo de step-up (docs/factory/52-DESENHO-H014.md §4.2, §4.3): pedido
// (requestStepUpCode) e prova (CodeProof). Cliente falso, sem banco e sem rede. E-mail e segredos
// sinteticos. Confere o que vai ao SQL (sem e-mail nem codigo em claro) e o mapeamento de resultados.
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_DEFAULTS, type SessionRecord } from '@fastpro/domain';
import { CodeProof, PgStepUpStore, requestStepUpCode, type StepUpSecrets } from '../src/session.js';
import { challengeAad, challengeHmacHex, openChallengeBlob } from '../src/challenges-crypto.js';

type Call = { text: string; params: unknown[] };

/** Cliente falso: a resposta vem da primeira chave de `respostas` que aparece no SQL. */
function fakeClient(respostas: Record<string, Record<string, unknown>[]>) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        const chave = Object.keys(respostas).find((k) => text.includes(k));
        return { rows: chave === undefined ? [] : respostas[chave] };
      },
    },
  };
}

const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const CH = '33333333-3333-4333-8333-333333333333';
const OB = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'pessoa@example.test';
const HEX64 = /^[0-9a-f]{64}$/;

const secrets: StepUpSecrets = {
  key: Buffer.alloc(32, 7),
  pepperEmail: 'example-pepper-email',
  pepperCode: 'example-pepper-code',
  pepperIp: 'example-pepper-ip',
};
const clock = { nowMs: () => NOW };
const sessao: SessionRecord = { sessionId: SID, userId: UID, recentAuthAtMs: NOW, authMethod: 'link' };

function deps(respostas: Record<string, Record<string, unknown>[]>) {
  const f = fakeClient(respostas);
  const store = new PgStepUpStore(f.client);
  return { f, deps: { store, secrets, clock, limits: RATE_LIMIT_DEFAULTS } };
}

const pedidoOk = { out_resultado: 'criado', out_challenge_id: CH, out_outbox_id: OB, out_retry_after: null, out_motivo: null };

describe('requestStepUpCode (pedido do codigo)', () => {
  it('criado: devolve a saida, manda 14 parametros e nao leva e-mail nem codigo em claro', async () => {
    const { f, deps: d } = deps({
      app_user: [{ email: EMAIL }],
      step_up_request: [pedidoOk],
    });
    const r = await requestStepUpCode(d, sessao, '203.0.113.9');
    expect(r).toEqual({ resultado: 'criado', outboxId: OB });

    const chamada = f.calls.find((c) => c.text.includes('step_up_request'));
    expect(chamada?.params).toHaveLength(15);
    const params = chamada!.params;
    expect(params[2]).toBe(challengeHmacHex(secrets.pepperEmail, EMAIL));
    expect(params[3]).toMatch(HEX64); // digest do link (token descartado)
    expect(params[4]).toMatch(HEX64); // HMAC do codigo
    expect(Buffer.isBuffer(params[5])).toBe(true);
    expect((params[5] as Buffer).toString('latin1')).not.toContain(EMAIL);
    // secrets_enc: so {code}, cifrado com o AAD do desafio (sem token de link).
    const aberto = openChallengeBlob(secrets.key, params[6] as Buffer, challengeAad(String(params[1]), 'secrets_enc'));
    expect(Object.keys(JSON.parse(aberto))).toEqual(['code']);
    expect(JSON.parse(aberto).code).toMatch(/^\d{6}$/);
    expect(params.some((p) => p === EMAIL)).toBe(false);
    expect(params.some((p) => typeof p === 'string' && /^\d{6}$/.test(p))).toBe(false);
  });

  it('espera: repassa o tempo de espera do banco', async () => {
    const { deps: d } = deps({
      app_user: [{ email: EMAIL }],
      step_up_request: [{ out_resultado: 'espera', out_challenge_id: null, out_outbox_id: null, out_retry_after: 42, out_motivo: null }],
    });
    expect(await requestStepUpCode(d, sessao, null)).toEqual({ resultado: 'espera', retryAfterSeconds: 42 });
  });

  it('conta sem e-mail: negado e nenhuma chamada ao pedido', async () => {
    const { f, deps: d } = deps({ app_user: [] });
    expect(await requestStepUpCode(d, sessao, null)).toEqual({ resultado: 'negado', retryAfterSeconds: null });
    expect(f.calls.some((c) => c.text.includes('step_up_request'))).toBe(false);
  });

  it('resultado fora do conjunto conhecido falha (nao inventa estado)', async () => {
    const { deps: d } = deps({
      app_user: [{ email: EMAIL }],
      step_up_request: [{ out_resultado: 'ok', out_challenge_id: null, out_outbox_id: null, out_retry_after: null, out_motivo: null }],
    });
    await expect(requestStepUpCode(d, sessao, null)).rejects.toThrow('step_up_request_resultado_inesperado');
  });
});

describe('CodeProof (prova por codigo)', () => {
  const codigo = { ok: true, method: 'code', code: '123456' } as const;

  it('corpo de outro metodo: 422 metodo_invalido, sem consultar o banco', async () => {
    const { f, deps: d } = deps({});
    const prova = new CodeProof(d);
    expect(await prova.verify(sessao, { ok: false }, NOW)).toEqual({ ok: false, status: 422, code: 'metodo_invalido' });
    expect(await prova.verify(sessao, { ok: true, method: 'password', password: 'x' }, NOW)).toEqual({
      ok: false,
      status: 422,
      code: 'metodo_invalido',
    });
    expect(f.calls).toHaveLength(0);
  });

  it('codigo certo: ok, com o desafio vivo da sessao', async () => {
    const { f, deps: d } = deps({
      app_user: [{ email: EMAIL }],
      auth_challenge_ativo_id: [{ id: CH }],
      step_up_verify: [{ out_resultado: 'ok', out_attempts_restantes: 0, out_retry_after: null }],
    });
    expect(await new CodeProof(d).verify(sessao, codigo, NOW, '203.0.113.9')).toEqual({ ok: true });
    const v = f.calls.find((c) => c.text.includes('step_up_verify'))!;
    expect(v.params[0]).toBe(SID);
    expect(v.params[1]).toBe(CH);
    expect(v.params[3]).toMatch(HEX64);
  });

  it('sem desafio vivo: segue o caminho com challengeId nulo (conta erro, nao revela)', async () => {
    const { f, deps: d } = deps({
      app_user: [{ email: EMAIL }],
      auth_challenge_ativo_id: [{ id: null }],
      step_up_verify: [{ out_resultado: 'invalido', out_attempts_restantes: 0, out_retry_after: null }],
    });
    expect(await new CodeProof(d).verify(sessao, codigo, NOW, null)).toEqual({ ok: false, status: 422, code: 'codigo_invalido' });
    expect(f.calls.find((c) => c.text.includes('step_up_verify'))!.params[1]).toBeNull();
  });

  it.each([
    ['errado', { ok: false, status: 422, code: 'codigo_invalido' }],
    ['invalido', { ok: false, status: 422, code: 'codigo_invalido' }],
    ['negado', { ok: false, status: 401, code: 'nao_autenticado' }],
  ])('resultado %s do banco vira resposta fixa', async (resultado, esperado) => {
    const { deps: d } = deps({
      app_user: [{ email: EMAIL }],
      auth_challenge_ativo_id: [{ id: CH }],
      step_up_verify: [{ out_resultado: resultado, out_attempts_restantes: 1, out_retry_after: null }],
    });
    expect(await new CodeProof(d).verify(sessao, codigo, NOW, null)).toEqual(esperado);
  });

  it('bloqueio por tentativas: 429 muitas_tentativas', async () => {
    const { deps: d } = deps({
      app_user: [{ email: EMAIL }],
      auth_challenge_ativo_id: [{ id: CH }],
      step_up_verify: [{ out_resultado: 'bloqueado_codigo', out_attempts_restantes: 0, out_retry_after: 900 }],
    });
    expect(await new CodeProof(d).verify(sessao, codigo, NOW, null)).toEqual({
      ok: false,
      status: 429,
      code: 'muitas_tentativas',
    });
  });
});
