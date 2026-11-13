// Issue 53 (H-040) | Testes da mensagem neutra ao profissional (CA-H040-10; dec. 483, 530). Sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import {
  ESTADO_PUBLICO_EM_ANALISE,
  TEXTO_EM_ANALISE,
  estadoPublicoDoProfissional,
  mensagemAoProfissional,
} from './professional-status-message.js';

describe('estado publico do profissional (CA-H040-10)', () => {
  it('mapeia pendente, em_revisao e retida_duplicidade para o mesmo estado publico', () => {
    expect(estadoPublicoDoProfissional('pendente')).toBe(ESTADO_PUBLICO_EM_ANALISE);
    expect(estadoPublicoDoProfissional('em_revisao')).toBe(ESTADO_PUBLICO_EM_ANALISE);
    expect(estadoPublicoDoProfissional('retida_duplicidade')).toBe(ESTADO_PUBLICO_EM_ANALISE);
  });

  it('serializa o mesmo corpo para os tres estados em analise', () => {
    const corpos = ['pendente', 'em_revisao', 'retida_duplicidade'].map((e) => mensagemAoProfissional(e));
    expect(corpos[0]).toEqual({ estado: 'em_analise', texto: TEXTO_EM_ANALISE });
    expect(corpos[1]).toEqual(corpos[0]);
    expect(corpos[2]).toEqual(corpos[0]);
  });

  it('o texto nao revela duplicidade, identificador nem dado de documento', () => {
    const texto = TEXTO_EM_ANALISE.toLowerCase();
    expect(texto).not.toMatch(/duplic|já existe|ja existe|existente|outro perfil/);
    expect(texto).not.toMatch(/\d/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(texto).not.toMatch(/@/);
  });

  it('nao define texto para os demais estados (outra historia)', () => {
    expect(mensagemAoProfissional('aprovada')).toBeNull();
    expect(mensagemAoProfissional('recusada')).toBeNull();
    expect(estadoPublicoDoProfissional('aprovada')).toBe('aprovada');
  });
});
