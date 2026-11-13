// Issue 57 (H-044) | Testes unitarios do dominio da ativacao do trial (docs/factory/135-DESENHO-H044.md, §6, T-20 e T-21).
// Porta falsa em memoria e relogio injetado. Sem banco, sem rede.
import { describe, expect, it } from 'vitest';
import { TRIAL_DIAS } from './types.js';
import type { Clock } from './commercial-access.js';
import {
  CODIGOS_ATIVACAO_TRIAL,
  TEXTO_ATIVACAO_TRIAL,
  TrialActivationError,
  ativarTrial,
  type TrialActivationOutcome,
  type TrialActivationPort,
} from './trial.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const DUAS_SEMANAS_MS = 14 * 24 * 60 * 60 * 1000;

function relogio(ms: number): Clock {
  return { now: () => new Date(ms) };
}

/** Porta falsa: registra as chamadas e devolve o resultado configurado (ou lanca o erro configurado). */
function portaFalsa(resultado: unknown): { porta: TrialActivationPort; chamadas: Array<{ id: string; at: Date }> } {
  const chamadas: Array<{ id: string; at: Date }> = [];
  const porta: TrialActivationPort = {
    activate: async (id: string, at: Date) => {
      chamadas.push({ id, at });
      if (resultado instanceof Error) throw resultado;
      return resultado as TrialActivationOutcome;
    },
  };
  return { porta, chamadas };
}

describe('T-20: texto de ativacao (CA-H044-18)', () => {
  it('diz sem cartao, os 14 dias e que nao vira assinatura sozinho', () => {
    const texto = TEXTO_ATIVACAO_TRIAL.toLowerCase();
    expect(texto).toContain('sem cartão');
    expect(texto).toContain(`${TRIAL_DIAS} dias`);
    expect(texto).toContain('não vira assinatura sozinho');
  });

  it('nao contem termos de cobranca futura nem de pedidos (lista fixa)', () => {
    const texto = TEXTO_ATIVACAO_TRIAL.toLowerCase();
    const proibidos = [
      'cobran',
      'cobrar',
      'cobrado',
      'pagamento',
      'pague',
      'pedido',
      'r$',
      'mercado pago',
      'renovação automática',
      'próxima cobrança',
    ];
    for (const termo of proibidos) {
      expect(texto, `termo proibido: ${termo}`).not.toContain(termo);
    }
  });

  it('a lista de codigos e exatamente os quatro da funcao de banco', () => {
    expect([...CODIGOS_ATIVACAO_TRIAL].sort()).toEqual(
      ['ok', 'not_verified', 'paid_access_active', 'trial_used'].sort(),
    );
  });
});

describe('T-21: dominio da ativacao', () => {
  it('usa o instante do relogio injetado, nunca o do cliente', async () => {
    const { porta, chamadas } = portaFalsa({ code: 'not_verified' });
    await ativarTrial(porta, relogio(T0), PROFISSIONAL);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.id).toBe(PROFISSIONAL);
    expect(chamadas[0]?.at.getTime()).toBe(T0);
  });

  it('ok: devolve inicio e fim com 14 dias exatos', async () => {
    const inicio = new Date(T0);
    const fim = new Date(T0 + DUAS_SEMANAS_MS);
    const { porta } = portaFalsa({ code: 'ok', startsAt: inicio, endsAt: fim });
    const r = await ativarTrial(porta, relogio(T0), PROFISSIONAL);
    expect(r).toEqual({ code: 'ok', startsAt: inicio, endsAt: fim });
  });

  it.each(['not_verified', 'trial_used', 'paid_access_active'] as const)(
    'mapeia o codigo de negacao %s sem campos extras',
    async (codigo) => {
      const { porta } = portaFalsa({ code: codigo });
      const r = await ativarTrial(porta, relogio(T0), PROFISSIONAL);
      expect(r).toEqual({ code: codigo });
    },
  );

  it('codigo fora dos quatro vira trial_indisponivel', async () => {
    const { porta } = portaFalsa({ code: 'desconhecido' });
    await expect(ativarTrial(porta, relogio(T0), PROFISSIONAL)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('ok com duracao diferente de 14 dias vira trial_indisponivel', async () => {
    const { porta } = portaFalsa({
      code: 'ok',
      startsAt: new Date(T0),
      endsAt: new Date(T0 + DUAS_SEMANAS_MS + 1000),
    });
    await expect(ativarTrial(porta, relogio(T0), PROFISSIONAL)).rejects.toBeInstanceOf(TrialActivationError);
    await expect(ativarTrial(porta, relogio(T0), PROFISSIONAL)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('ok com datas que nao sao Date vira trial_indisponivel', async () => {
    const { porta } = portaFalsa({ code: 'ok', startsAt: '2099-01-01', endsAt: '2099-01-15' });
    await expect(ativarTrial(porta, relogio(T0), PROFISSIONAL)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('resultado nulo vira trial_indisponivel', async () => {
    const { porta } = portaFalsa(null);
    await expect(ativarTrial(porta, relogio(T0), PROFISSIONAL)).rejects.toMatchObject({
      code: 'trial_indisponivel',
    });
  });

  it('identificador de profissional invalido recusa antes de chamar a porta', async () => {
    for (const invalido of ['', 'nao-e-uuid', 42 as unknown as string]) {
      const { porta, chamadas } = portaFalsa({ code: 'not_verified' });
      await expect(ativarTrial(porta, relogio(T0), invalido)).rejects.toMatchObject({
        code: 'trial_profissional_invalido',
      });
      expect(chamadas).toHaveLength(0);
    }
  });

  it('relogio invalido recusa antes de chamar a porta', async () => {
    const { porta, chamadas } = portaFalsa({ code: 'not_verified' });
    await expect(ativarTrial(porta, relogio(Number.NaN), PROFISSIONAL)).rejects.toMatchObject({
      code: 'trial_relogio_invalido',
    });
    expect(chamadas).toHaveLength(0);
  });
});
