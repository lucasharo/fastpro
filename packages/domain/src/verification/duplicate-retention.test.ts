// Issue 53 (H-040) | Testes unitarios da retencao por duplicidade (CA-H040-05, 06, 16). Sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import { motivoCombina, validarDecisao } from './reasons.js';
import {
  ehOriginalStatus,
  podeAprovarRetido,
  visaoDuplicidade,
  type DuplicateView,
} from './duplicate-retention.js';

describe('visao da duplicidade (CA-H040-16; vocabulario fixo)', () => {
  it('aceita so vivo, recusado e nenhum', () => {
    expect(ehOriginalStatus('vivo')).toBe(true);
    expect(ehOriginalStatus('recusado')).toBe(true);
    expect(ehOriginalStatus('nenhum')).toBe(true);
    expect(ehOriginalStatus('retida_duplicidade')).toBe(false);
    expect(ehOriginalStatus('aprovada')).toBe(false);
  });

  it('mapeia a linha do banco para a visao publica da rota', () => {
    expect(
      visaoDuplicidade({ duplicada: true, originalShortId: 'a1b2c3d4', originalStatus: 'vivo', canApprove: false }),
    ).toEqual({ duplicada: true, originalId: 'a1b2c3d4', originalStatus: 'vivo', podeAprovar: false });
  });

  it('falha fechado para vocabulario fora da lista', () => {
    expect(() =>
      visaoDuplicidade({ duplicada: true, originalShortId: null, originalStatus: 'aprovada', canApprove: true }),
    ).toThrow('vocabulario_duplicidade_invalido');
  });
});

describe('aprovacao de retido (CA-H040-05; dec. 477)', () => {
  const base: DuplicateView = { duplicada: true, originalId: null, originalStatus: 'nenhum', podeAprovar: true };

  it('nao aprova com original vivo, mesmo se o banco disser que pode', () => {
    expect(podeAprovarRetido({ ...base, originalStatus: 'vivo', originalId: 'a1b2c3d4', podeAprovar: true })).toBe(false);
  });

  it('aprova com original recusado ou sem original', () => {
    expect(podeAprovarRetido({ ...base, originalStatus: 'recusado', originalId: 'a1b2c3d4' })).toBe(true);
    expect(podeAprovarRetido(base)).toBe(true);
  });

  it('nao aprova quando a visao diz que nao pode', () => {
    expect(podeAprovarRetido({ ...base, podeAprovar: false })).toBe(false);
  });
});

describe('recusa com duplicidade_suspeita depende de cadastro retido (dec. 526)', () => {
  it('aceita so com perfil retido', () => {
    expect(motivoCombina('recusada', 'duplicidade_suspeita', true)).toBe(true);
    expect(motivoCombina('recusada', 'duplicidade_suspeita', false)).toBe(false);
    expect(motivoCombina('recusada', 'documento_ilegivel', false)).toBe(true);
  });

  it('sem contexto, o dominio deixa a regra para o banco (VRF02)', () => {
    expect(validarDecisao({ decisao: 'recusada', motivo: 'duplicidade_suspeita' }).ok).toBe(true);
    expect(validarDecisao({ decisao: 'recusada', motivo: 'duplicidade_suspeita', retido: false })).toEqual({
      ok: false,
      codigo: 'motivo_invalido',
    });
    expect(validarDecisao({ decisao: 'recusada', motivo: 'duplicidade_suspeita', retido: true }).ok).toBe(true);
  });
});
