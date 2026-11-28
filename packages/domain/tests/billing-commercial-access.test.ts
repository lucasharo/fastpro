// H-045 (Issue 58) | Testes unitarios do dominio do acesso comercial derivado (114-DESENHO-H045 §4, §6, T-20).
// Sem rede, sem banco. Relogio e porta falsos. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  CARENCIA_HORAS,
  CommercialAccessError,
  ESTADOS_ACESSO_COMERCIAL,
  TRIAL_DIAS,
  aceitarEstado,
  lerAcessoComercial,
  type AcessoComercial,
  type Clock,
  type CommercialAccessPort,
} from '../src/billing/index.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const AGORA = new Date('2030-03-01T10:00:00.000Z');

function relogioFixo(instante: Date): Clock {
  return { now: () => instante };
}

function portaFalsa(resposta: AcessoComercial): CommercialAccessPort & { chamadas: Array<[string, Date]> } {
  const chamadas: Array<[string, Date]> = [];
  return {
    chamadas,
    read: async (professionalId: string, at: Date) => {
      chamadas.push([professionalId, at]);
      return resposta;
    },
  };
}

describe('constantes e estados', () => {
  it('carencia de 72 h e trial de 14 dias (decisao 268, RF-059)', () => {
    expect(CARENCIA_HORAS).toBe(72);
    expect(TRIAL_DIAS).toBe(14);
  });

  it('sao exatamente os sete estados da 08 §6', () => {
    expect([...ESTADOS_ACESSO_COMERCIAL].sort()).toEqual(
      [
        'ativa',
        'cancelada_com_acesso_ate_fim_do_periodo',
        'em_carencia',
        'expirada',
        'sem_acesso',
        'trial_ativo',
        'trial_expirado',
      ].sort(),
    );
  });

  it('aceitarEstado aceita os sete e recusa qualquer outro valor', () => {
    for (const estado of ESTADOS_ACESSO_COMERCIAL) {
      expect(aceitarEstado(estado)).toBe(estado);
    }
    for (const invalido of ['', 'ATIVA', 'bloqueada', null, undefined, 3]) {
      expect(() => aceitarEstado(invalido)).toThrow(CommercialAccessError);
    }
  });
});

describe('lerAcessoComercial (relogio injetado)', () => {
  it('passa ao banco exatamente o instante do relogio injetado', async () => {
    const porta = portaFalsa({ estado: 'ativa', accessUntil: new Date('2030-03-31T00:00:00.000Z') });
    const resultado = await lerAcessoComercial(porta, relogioFixo(AGORA), PROFISSIONAL);
    expect(resultado.estado).toBe('ativa');
    expect(porta.chamadas).toEqual([[PROFISSIONAL, AGORA]]);
  });

  it('nao le o relogio mais de uma vez por leitura', async () => {
    let leituras = 0;
    const relogio: Clock = {
      now: () => {
        leituras += 1;
        return AGORA;
      },
    };
    await lerAcessoComercial(portaFalsa({ estado: 'sem_acesso', accessUntil: null }), relogio, PROFISSIONAL);
    expect(leituras).toBe(1);
  });

  it('recusa identificador de profissional que nao e UUID, sem chamar a porta', async () => {
    const porta = portaFalsa({ estado: 'sem_acesso', accessUntil: null });
    await expect(lerAcessoComercial(porta, relogioFixo(AGORA), 'nao-uuid')).rejects.toMatchObject({
      code: 'acesso_comercial_profissional_invalido',
    });
    expect(porta.chamadas).toHaveLength(0);
  });

  it('recusa relogio que devolve data invalida', async () => {
    const porta = portaFalsa({ estado: 'sem_acesso', accessUntil: null });
    await expect(
      lerAcessoComercial(porta, relogioFixo(new Date('x')), PROFISSIONAL),
    ).rejects.toMatchObject({ code: 'acesso_comercial_relogio_invalido' });
    expect(porta.chamadas).toHaveLength(0);
  });

  it('devolve o estado sem decidir o que ele permite (RN-H045-06)', async () => {
    const porta = portaFalsa({ estado: 'expirada', accessUntil: null });
    const r = await lerAcessoComercial(porta, relogioFixo(AGORA), PROFISSIONAL);
    expect(r).toEqual({ estado: 'expirada', accessUntil: null });
  });
});
