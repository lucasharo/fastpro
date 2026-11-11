// H-092 | Mapeamento de classe e cortes de cota (QA: aceite e mensagem = digest 85/2.550; lembrete = 70/2.100).
import { describe, it, expect } from 'vitest';
import { classFor, decideQuota, QUOTA_CUTS } from '../src/index.js';

describe('aceite e mensagem usam a classe digest (corte 85/dia e 2.550/mes)', () => {
  it('avisos e resumos de aceite e de mensagem sao digest', () => {
    for (const emailType of [
      'aceite_aviso',
      'aceite_resumo',
      'mensagem_aviso',
      'mensagem_resumo',
    ]) {
      expect(classFor(emailType)).toBe('digest');
    }
  });

  it('o corte digest e 85 por dia e 2.550 por mes, e a decisao respeita os dois', () => {
    expect(QUOTA_CUTS.digest).toEqual({ dia: 85, mes: 2550 });
    expect(decideQuota('digest', 84, 2549)).toEqual({ allow: true, blockedBy: null });
    expect(decideQuota('digest', 85, 0)).toEqual({ allow: false, blockedBy: 'dia' });
    expect(decideQuota('digest', 0, 2550)).toEqual({ allow: false, blockedBy: 'mes' });
  });
});

describe('lembrete usa 70 por dia e 2.100 por mes', () => {
  it('prazo (T-24h, T0) e acesso de trial e ciclo sao lembrete', () => {
    for (const emailType of ['prazo_t24', 'prazo_t0', 'acesso_trial', 'acesso_ciclo']) {
      expect(classFor(emailType)).toBe('lembrete');
    }
  });

  it('o corte lembrete e 70 por dia e 2.100 por mes', () => {
    expect(QUOTA_CUTS.lembrete).toEqual({ dia: 70, mes: 2100 });
    expect(decideQuota('lembrete', 69, 2099)).toEqual({ allow: true, blockedBy: null });
    expect(decideQuota('lembrete', 70, 0)).toEqual({ allow: false, blockedBy: 'dia' });
    expect(decideQuota('lembrete', 0, 2100)).toEqual({ allow: false, blockedBy: 'mes' });
  });
});
