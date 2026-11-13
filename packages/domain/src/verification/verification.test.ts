// Issue 52 (H-039) | Testes unitarios do dominio da fila de verificacao (124 §6: T-05 em paridade,
// T-07 e T-19 no lado TS). Sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import { podeTransitar, TRANSICOES_CASO } from './transitions.js';
import { motivoCombina, textoTemDadoPessoal, validarDecisao } from './reasons.js';
import { prazoMeta } from './sla.js';
import { VerificationService } from './service.js';
import { VerificacaoErro, type VerificationCasePort } from './ports.js';
import { COMPLEMENTO_MAX, ESTADOS_CASO } from './types.js';

describe('transicoes (CA-H039-03, paridade com o banco)', () => {
  it('aceita exatamente as dez transicoes da tabela', () => {
    expect(TRANSICOES_CASO).toHaveLength(10);
    for (const [de, para] of TRANSICOES_CASO) expect(podeTransitar(de, para)).toBe(true);
  });

  it('recusa todo par fora da tabela, inclusive aprovada e suspensa de saida', () => {
    let aceitos = 0;
    for (const de of ESTADOS_CASO) {
      for (const para of ESTADOS_CASO) {
        if (podeTransitar(de, para)) aceitos += 1;
      }
    }
    expect(aceitos).toBe(10);
    for (const para of ESTADOS_CASO) {
      expect(podeTransitar('aprovada', para)).toBe(false);
      expect(podeTransitar('suspensa', para)).toBe(false);
    }
    expect(podeTransitar('pendente', 'aprovada')).toBe(false);
  });
});

describe('prazo-meta em dias uteis (dec. 384, 397; paridade com private.verification_sla_target)', () => {
  const brasilia = (iso: string) => new Date(`${iso}-03:00`);
  it('sexta 10:00 vira terca 10:00', () => {
    expect(prazoMeta(brasilia('2026-11-13T10:00:00'))).toEqual(brasilia('2026-11-17T10:00:00'));
  });
  it('sabado 10:00 vira quarta 00:00', () => {
    expect(prazoMeta(brasilia('2026-11-14T10:00:00'))).toEqual(brasilia('2026-11-18T00:00:00'));
  });
  it('quinta 10:00 vira segunda 10:00 (cruza o fim de semana)', () => {
    expect(prazoMeta(brasilia('2026-11-12T10:00:00'))).toEqual(brasilia('2026-11-16T10:00:00'));
  });
  it('domingo conta como segunda 00:00', () => {
    expect(prazoMeta(brasilia('2026-11-15T23:59:00'))).toEqual(brasilia('2026-11-18T00:00:00'));
  });
  // Mesma tabela de verification-sla-paridade.dbtest.mjs (T-19): as duas pontas comparam os mesmos casos.
  it.each([
    ['2026-11-12T10:00:00', '2026-11-16T10:00:00'],
    ['2026-11-13T10:00:00', '2026-11-17T10:00:00'],
    ['2026-11-13T23:59:00', '2026-11-17T23:59:00'],
    ['2026-11-14T00:00:00', '2026-11-18T00:00:00'],
    ['2026-11-14T10:00:00', '2026-11-18T00:00:00'],
    ['2026-11-15T23:59:00', '2026-11-18T00:00:00'],
    ['2026-11-16T09:00:00', '2026-11-18T09:00:00'],
  ])('tabela de fronteira T-19: %s vira %s', (entrada, esperado) => {
    expect(prazoMeta(brasilia(entrada))).toEqual(brasilia(esperado));
  });
});

describe('motivos e complemento (dec. 375 a 377; CA-H039-04)', () => {
  it('combina decisao com motivo', () => {
    expect(motivoCombina('aprovada', 'aprovado')).toBe(true);
    expect(motivoCombina('aprovada', 'documento_ilegivel')).toBe(false);
    expect(motivoCombina('retida_duplicidade', 'duplicidade_suspeita')).toBe(true);
    expect(motivoCombina('recusada', 'aprovado')).toBe(false);
    expect(motivoCombina('recusada', 'duplicidade_suspeita', false)).toBe(false);
    expect(motivoCombina('recusada', 'documento_ilegivel')).toBe(true);
  });

  it('recusa complemento com CPF, CNPJ, e-mail ou 10 ou mais digitos', () => {
    expect(textoTemDadoPessoal('CPF 123.456.789-09')).toBe(true);
    expect(textoTemDadoPessoal('CNPJ 12.345.678/0001-95')).toBe(true);
    expect(textoTemDadoPessoal('contato fulano@example.test')).toBe(true);
    expect(textoTemDadoPessoal('telefone 11 98765 4321')).toBe(true);
    expect(textoTemDadoPessoal('imagem sem legibilidade')).toBe(false);
  });

  it('aceita 500 caracteres e recusa 501', () => {
    const ok = validarDecisao({ decisao: 'recusada', motivo: 'documento_ilegivel', complemento: 'a'.repeat(COMPLEMENTO_MAX) });
    expect(ok.ok).toBe(true);
    const grande = validarDecisao({ decisao: 'recusada', motivo: 'documento_ilegivel', complemento: 'a'.repeat(COMPLEMENTO_MAX + 1) });
    expect(grande).toEqual({ ok: false, codigo: 'explicacao_invalida' });
  });

  it('exige complemento nao vazio para o motivo outro', () => {
    expect(validarDecisao({ decisao: 'recusada', motivo: 'outro', complemento: '   ' })).toEqual({ ok: false, codigo: 'explicacao_invalida' });
    expect(validarDecisao({ decisao: 'recusada', motivo: 'outro', complemento: 'frente cortada' }).ok).toBe(true);
  });

  it('recusa motivo fora da lista ou combinacao invalida', () => {
    expect(validarDecisao({ decisao: 'recusada', motivo: 'livre' })).toEqual({ ok: false, codigo: 'motivo_invalido' });
    expect(validarDecisao({ decisao: 'aprovada', motivo: 'documento_ilegivel' })).toEqual({ ok: false, codigo: 'motivo_invalido' });
  });
});

describe('servico (validacao de entrada e delegacao)', () => {
  const relogio = { now: () => new Date('2026-11-13T13:00:00Z') };
  const ctx = { actorId: 'a', sessionHash: 'h' };
  function portaFalsa() {
    const chamadas: unknown[] = [];
    const porta: VerificationCasePort = {
      listar: async (_c, e) => {
        chamadas.push(e);
        return [];
      },
      detalhe: async () => {
        throw new Error('nao_usado_neste_teste');
      },
      duplicateView: async () => ({ duplicada: false, originalId: null, originalStatus: 'nenhum', podeAprovar: true }),
      atribuir: async () => ({ status: 'em_revisao', versao: 2 }),
      reatribuir: async () => ({ status: 'em_revisao', versao: 3 }),
      decidir: async (_c, e) => {
        chamadas.push(e);
        return { status: e.decisao, versao: 3 };
      },
      receberRecurso: async () => 'ok',
    };
    return { porta, chamadas };
  }

  it('rejeita escopo e limite invalidos antes da porta', async () => {
    const { porta } = portaFalsa();
    const svc = new VerificationService(porta, relogio);
    expect(() => svc.listar(ctx, { escopo: 'todos', limite: 10 })).toThrow(VerificacaoErro);
    expect(() => svc.listar(ctx, { escopo: 'pendentes', limite: 51 })).toThrow(VerificacaoErro);
    expect(() => svc.listar(ctx, { escopo: 'pendentes', limite: 0 })).toThrow(VerificacaoErro);
  });

  it('passa o relogio injetado e o escopo validado para a porta', async () => {
    const { porta, chamadas } = portaFalsa();
    const svc = new VerificationService(porta, relogio);
    await svc.listar(ctx, { escopo: 'pendentes', limite: 10 });
    expect(chamadas[0]).toMatchObject({ escopo: 'pendentes', limite: 10, now: new Date('2026-11-13T13:00:00Z') });
  });

  it('valida decisao e motivo antes de chamar o banco', async () => {
    const { porta, chamadas } = portaFalsa();
    const svc = new VerificationService(porta, relogio);
    expect(() => svc.decidir(ctx, 'c1', { decisao: 'aprovada', motivo: 'documento_ilegivel', versao: 2 })).toThrow(
      'motivo_invalido',
    );
    expect(chamadas).toHaveLength(0);
    await svc.decidir(ctx, 'c1', { decisao: 'recusada', motivo: 'outro', complemento: ' ajuste ', versao: 2 });
    expect(chamadas[0]).toMatchObject({ decisao: 'recusada', complemento: 'ajuste', versao: 2 });
  });
});
