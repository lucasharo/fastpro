// H-016 | PgProfessionalSendLimit com cliente falso (sem banco): confere o uso de private.rl_check e
// private.rl_hit sobre ops.rate_counter, a ordem dos parametros e a traducao para barrado/permitido.
import { describe, expect, it } from 'vitest';
import { PgProfessionalSendLimit } from '../src/professional-send-limit.js';
import { professionalSendRules } from '@fastpro/domain';

type Call = { text: string; params: unknown[] };

function fakeClient(linhas: Record<string, unknown>[]) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        return { rows: linhas, rowCount: linhas.length };
      },
    },
  };
}

const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const regras = professionalSendRules('pessoa.sintetica@example.test', '203.0.113.7');
const chave = (spec: { rule: string; value: string }) => `chave:${spec.rule}`;

describe('PgProfessionalSendLimit (CA-H016-09)', () => {
  it('check chama rl_check com chave HMAC, janela, balde, limite e instante', async () => {
    const { calls, client } = fakeClient([{ out_ok: true, out_retry_after: null }]);
    const porta = new PgProfessionalSendLimit({ client, chave });
    const decisao = await porta.check(regras[1]!, NOW);
    expect(decisao).toEqual({ decision: 'permitido' });
    expect(calls[0]!.text).toContain('private.rl_check');
    expect(calls[0]!.params).toEqual(['chave:email_hora', 3600, 60, 5, new Date(NOW).toISOString()]);
  });

  it('check traduz out_ok falso em barrado com Retry-After limitado', async () => {
    const { client } = fakeClient([{ out_ok: false, out_retry_after: 3295 }]);
    const porta = new PgProfessionalSendLimit({ client, chave });
    expect(await porta.check(regras[1]!, NOW)).toEqual({ decision: 'barrado', retryAfterSeconds: 3295 });
  });

  it('resposta sem booleano lanca erro (falha fechada)', async () => {
    const { client } = fakeClient([{}]);
    const porta = new PgProfessionalSendLimit({ client, chave });
    await expect(porta.check(regras[0]!, NOW)).rejects.toThrow('rate_limit_resposta_invalida');
  });

  it('record chama rl_hit com chave, balde e instante, sem e-mail em claro', async () => {
    const { calls, client } = fakeClient([]);
    const porta = new PgProfessionalSendLimit({ client, chave });
    await porta.record(regras[2]!, NOW);
    expect(calls[0]!.text).toContain('private.rl_hit');
    expect(calls[0]!.params).toEqual(['chave:ip_hora', 60, new Date(NOW).toISOString()]);
    expect(JSON.stringify(calls)).not.toContain('pessoa.sintetica');
  });
});
