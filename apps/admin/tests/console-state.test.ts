// H-103 (Issue 112) | Estados da tela do console (docs/factory/70-DESENHO-H103.md §2, §4).
// Vazio, erro, sem sessao e telas, a partir da resposta do menu. Funcao pura, sem rede.
import { describe, it, expect } from 'vitest';
import {
  estadoDoMenu,
  TEXTO_ERRO,
  TEXTO_SEM_SESSAO,
  TEXTO_VAZIO,
} from '../src/console-state.js';

const TELA = { id: 'auditoria', rotulo: 'Trilha de auditoria', caminho: '/console/auditoria' };

describe('estados da tela do console', () => {
  it('200 com telas: estado telas, na ordem recebida', () => {
    expect(estadoDoMenu(200, { telas: [TELA] })).toEqual({ tipo: 'telas', telas: [TELA] });
  });

  it('200 sem telas: estado vazio (texto da Arquitetura)', () => {
    expect(estadoDoMenu(200, { telas: [] })).toEqual({ tipo: 'vazio' });
    expect(TEXTO_VAZIO).toBe('Nenhuma tela disponível para a sua conta.');
  });

  it('404: sessao ausente, vencida ou revogada', () => {
    expect(estadoDoMenu(404, null)).toEqual({ tipo: 'sem_sessao' });
    expect(TEXTO_SEM_SESSAO).toMatch(/sessão não está ativa/);
  });

  it('503 ou qualquer outro status: erro de carregamento', () => {
    expect(estadoDoMenu(503, { code: 'console_indisponivel' })).toEqual({ tipo: 'erro' });
    expect(estadoDoMenu(500, null)).toEqual({ tipo: 'erro' });
    expect(TEXTO_ERRO).toBe('Não foi possível carregar esta tela. Tente novamente.');
  });

  it('200 fora do contrato (sem lista, item sem campo ou corpo nulo): erro, nunca telas', () => {
    expect(estadoDoMenu(200, null)).toEqual({ tipo: 'erro' });
    expect(estadoDoMenu(200, { telas: 'nao-e-lista' })).toEqual({ tipo: 'erro' });
    expect(estadoDoMenu(200, { telas: [{ id: 'x', rotulo: 'y' }] })).toEqual({ tipo: 'erro' });
  });
});
