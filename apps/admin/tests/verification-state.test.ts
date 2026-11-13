// Issue 52 (H-039) | Testes do estado da tela da fila de verificacao (124 §5.4; T-21 na camada da tela).
import { describe, expect, it } from 'vitest';
import {
  escopoDaUrl,
  estadoDaFila,
  rotuloEstado,
  rotuloPrazo,
  TEXTO_ERRO_CARREGAR,
  TEXTO_LISTA_VAZIA,
} from '../src/verification-state';

const LINHA = {
  id: '11111111-2222-4333-8444-555555555555',
  short_id: '11111111',
  status: 'pendente',
  appeal_status: 'nenhum',
  sla_target_at: '2099-01-03T12:00:00.000Z',
  received_at: '2099-01-01T12:00:00.000Z',
  services: [],
  overdue: false,
  assigned_to_me: false,
  version: 1,
};

describe('estadoDaFila', () => {
  it('404 vira sem acesso, sem detalhe da API', () => {
    expect(estadoDaFila(404, null)).toEqual({ tipo: 'sem_acesso' });
  });

  it('lista vazia mostra o texto aprovado da decisao 386', () => {
    expect(estadoDaFila(200, { itens: [], proximo: null })).toEqual({ tipo: 'vazia' });
    expect(TEXTO_LISTA_VAZIA).toBe('Nenhum caso nesta lista.');
  });

  it('itens validos viram lista; formato fora do esperado vira erro generico', () => {
    expect(estadoDaFila(200, { itens: [LINHA], proximo: null })).toEqual({ tipo: 'lista', itens: [LINHA] });
    expect(estadoDaFila(200, { itens: [{ id: 'x' }], proximo: null })).toEqual({ tipo: 'erro' });
    expect(estadoDaFila(500, null)).toEqual({ tipo: 'erro' });
    expect(estadoDaFila(200, 'texto')).toEqual({ tipo: 'erro' });
  });

  it('o texto de erro nao traz detalhe tecnico', () => {
    expect(TEXTO_ERRO_CARREGAR).not.toMatch(/sql|banco|stack|bucket|caminho/i);
  });
});

describe('escopoDaUrl, rotuloEstado e rotuloPrazo', () => {
  it('escopo desconhecido cai em pendentes', () => {
    expect(escopoDaUrl('recursos')).toBe('recursos');
    expect(escopoDaUrl('tudo')).toBe('pendentes');
    expect(escopoDaUrl(undefined)).toBe('pendentes');
  });

  it('estados conhecidos ganham rotulo; desconhecido nao ecoa o valor', () => {
    expect(rotuloEstado('retida_duplicidade')).toBe('Retida por duplicidade');
    expect(rotuloEstado('qualquer_coisa')).toBe('Estado desconhecido');
  });

  it('prazo e apenas informativo', () => {
    expect(rotuloPrazo(true)).toBe('Além da meta');
    expect(rotuloPrazo(false)).toBe('Dentro da meta');
  });
});
