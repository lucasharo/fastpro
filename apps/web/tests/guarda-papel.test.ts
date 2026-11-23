// Guarda de navegacao por papel: cada papel so fica nas telas dele (as publicas valem para todos).
import { describe, expect, it } from 'vitest';
import { destinoDaGuarda } from '../src/components/Sessao';

describe('destinoDaGuarda', () => {
  it('visitante e carregamento nunca sao redirecionados', () => {
    for (const caminho of ['/', '/painel', '/profissional/painel', '/pedido']) {
      expect(destinoDaGuarda('anonimo', caminho)).toBeNull();
      expect(destinoDaGuarda(undefined, caminho)).toBeNull();
    }
  });

  it('cliente nao entra em telas do profissional nem na tela de entrada', () => {
    expect(destinoDaGuarda('cliente', '/profissional')).toBe('/painel');
    expect(destinoDaGuarda('cliente', '/profissional/painel')).toBe('/painel');
    expect(destinoDaGuarda('cliente', '/profissional/entrar')).toBe('/painel');
    expect(destinoDaGuarda('cliente', '/entrar')).toBe('/painel');
  });

  it('cliente fica nas telas dele e nas publicas', () => {
    for (const caminho of ['/', '/painel', '/painel/pedido/x', '/pedido', '/pedido/revisao', '/p/ana', '/acesso']) {
      expect(destinoDaGuarda('cliente', caminho)).toBeNull();
    }
  });

  it('profissional nao entra nas telas do cliente, na inicial nem nas de entrada', () => {
    for (const caminho of ['/', '/painel', '/painel/pedido/x', '/pedido', '/entrar', '/profissional', '/profissional/entrar', '/profissional/cadastro']) {
      expect(destinoDaGuarda('profissional', caminho)).toBe('/profissional/painel');
    }
  });

  it('profissional fica na area dele e nas publicas', () => {
    for (const caminho of ['/profissional/painel', '/profissional/pedidos', '/profissional/conversas', '/p/ana', '/profissional/redefinir']) {
      expect(destinoDaGuarda('profissional', caminho)).toBeNull();
    }
  });
});
