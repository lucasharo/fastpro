// Issue 56 (H-043) | Testes do view-model da tela do perfil publico (docs/factory/143-DESENHO-H043.md, §6.2; T43-09, T43-10).
import { describe, expect, it } from 'vitest';
import { construirTelaPerfil, PUBLIC_PROFILE_TEXTS, rotuloReputacao } from './index.js';

const grupo = [{ groupName: 'Limpeza', items: [{ name: 'Faxina', modalities: ['online' as const] }] }];

describe('T43-09 perfil sem avaliacoes', () => {
  it('mostra "Ainda sem avaliacoes" e nenhuma estrela ou nota', () => {
    const tela = construirTelaPerfil({
      tipo: 'perfil',
      perfil: { publicName: 'Ana Teste', services: grupo, rating: { average: null, count: 0 } },
    });
    expect(tela.tipo).toBe('perfil');
    expect(tela.reputacao?.rotulo).toBe('Ainda sem avaliações');
    expect(tela.selo?.rotulo).toBe('Identidade verificada');
    expect(tela.selo?.limitacao).toBe(PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo);
  });
});

describe('T43-10 reputacao com notas (fixture da E10)', () => {
  it('media com 1 casa decimal e contagem', () => {
    expect(rotuloReputacao({ average: 4.5, count: 2 })).toBe('Média 4,5 · 2 avaliações');
    expect(rotuloReputacao({ average: 5, count: 1 })).toBe('Média 5,0 · 1 avaliação');
  });
});

describe('T43-11 estados da tela', () => {
  it('perfil sem servicos mostra o estado vazio e lista vazia', () => {
    const tela = construirTelaPerfil({
      tipo: 'perfil',
      perfil: { publicName: 'Ana Teste', services: [], rating: { average: null, count: 0 } },
    });
    expect(tela.tipo).toBe('perfil_sem_servicos');
    expect(tela.aviso).toBe(PUBLIC_PROFILE_TEXTS.servicosVazios);
    expect(tela.servicos).toEqual([]);
  });

  it('nao encontrado, erro e carregando usam a mesma frase de cada estado', () => {
    expect(construirTelaPerfil({ tipo: 'nao_encontrado' })).toEqual({
      tipo: 'nao_encontrado',
      aviso: 'Perfil não encontrado ou indisponível.',
    });
    expect(construirTelaPerfil({ tipo: 'erro' }).aviso).toBe(PUBLIC_PROFILE_TEXTS.erro);
    expect(construirTelaPerfil({ tipo: 'carregando' }).tipo).toBe('carregando');
  });
});
