// H-108 (Issue 117) | Estados da tela operacao (docs/factory/76-DESENHO-H108.md §2; 73-REFINO-H108.md
// CA-H108-06, 07, 08, 10, 15, 16). Funcoes puras, sem rede: resposta da API a estado de tela.
import { describe, it, expect } from 'vitest';
import {
  contagemEstado,
  estadoDoPainel,
  filaVazia,
  idadeTexto,
  rotuloAlerta,
  rotuloCota,
  TEXTO_FILA_VAZIA,
  type PainelBody,
} from '../src/ops-panel-state.js';
import { TEXTO_ERRO } from '../src/console-state.js';

const VAZIO: PainelBody = {
  gerado_em: '2099-01-01T12:00:00.000Z',
  fila_email: {
    por_estado: { pendente: 0, enviando: 0, enviado: 0, falha: 0, suprimido: 0, adiado_cota: 0, descartado: 0 },
    idade_pendente_s: null,
    falhas_por_codigo: {},
  },
  cotas: [
    { servico: 'email', periodo: 'dia_utc', sem_dados: true },
    { servico: 'email', periodo: 'mes', sem_dados: true },
    { servico: 'mapbox_permanent', periodo: 'mes', sem_dados: true },
    { servico: 'mapbox_geocoding_temp', periodo: 'mes', sem_dados: true },
  ],
  webhooks: null,
  fotos: null,
  rls: null,
};

describe('estado da tela (estadoDoPainel)', () => {
  it('200 com a forma do contrato: estado painel, sem alterar os valores', () => {
    const r = estadoDoPainel(200, VAZIO);
    expect(r).toEqual({ tipo: 'painel', painel: VAZIO });
  });

  it('404 e 403: sem acesso (a tela e tratada como inexistente para quem nao e Superadmin)', () => {
    expect(estadoDoPainel(404, null)).toEqual({ tipo: 'sem_acesso' });
    expect(estadoDoPainel(403, { code: 'permission_denied' })).toEqual({ tipo: 'sem_acesso' });
  });

  it('503 ou qualquer outro status: erro com o texto da Arquitetura (CA-H108-16)', () => {
    expect(estadoDoPainel(503, { code: 'ops_indisponivel' })).toEqual({ tipo: 'erro' });
    expect(estadoDoPainel(500, null)).toEqual({ tipo: 'erro' });
    expect(TEXTO_ERRO).toBe('Não foi possível carregar esta tela. Tente novamente.');
  });

  it('200 fora do contrato (campo faltando, tipo errado, cota sem dados de uso): erro, nunca zero inventado', () => {
    expect(estadoDoPainel(200, null)).toEqual({ tipo: 'erro' });
    expect(estadoDoPainel(200, { ...VAZIO, fila_email: undefined })).toEqual({ tipo: 'erro' });
    expect(estadoDoPainel(200, { ...VAZIO, cotas: 'nao-e-lista' })).toEqual({ tipo: 'erro' });
    expect(
      estadoDoPainel(200, { ...VAZIO, cotas: [{ servico: 'email', periodo: 'mes', usado: 'x', limite: 1 }] }),
    ).toEqual({ tipo: 'erro' });
  });

  it('blocos com null (webhooks, fotos, RLS) sao aceitos e continuam null (a tela os omite)', () => {
    const r = estadoDoPainel(200, VAZIO);
    expect(r.tipo === 'painel' && r.painel.webhooks).toBeNull();
    expect(r.tipo === 'painel' && r.painel.fotos).toBeNull();
    expect(r.tipo === 'painel' && r.painel.rls).toBeNull();
  });
});

describe('fila de e-mail', () => {
  it('fila sem pendencia: filaVazia e o texto da Arquitetura (CA-H108-06)', () => {
    expect(filaVazia(VAZIO.fila_email)).toBe(true);
    expect(TEXTO_FILA_VAZIA).toBe('Nenhuma pendência no momento.');
    expect(contagemEstado(VAZIO.fila_email, 'pendente')).toBe(0);
  });

  it('fila com pendente, enviando ou adiado por cota: nao esta vazia', () => {
    const base = VAZIO.fila_email;
    expect(filaVazia({ ...base, por_estado: { ...base.por_estado, pendente: 2 } })).toBe(false);
    expect(filaVazia({ ...base, por_estado: { ...base.por_estado, enviando: 1 } })).toBe(false);
    expect(filaVazia({ ...base, por_estado: { ...base.por_estado, adiado_cota: 3 } })).toBe(false);
  });

  it('estado ausente na resposta conta como zero; enviado e falha nao sao pendencia', () => {
    const base = VAZIO.fila_email;
    expect(contagemEstado({ ...base, por_estado: {} }, 'falha')).toBe(0);
    expect(filaVazia({ ...base, por_estado: { ...base.por_estado, enviado: 9, falha: 4 } })).toBe(true);
  });
});

describe('cotas', () => {
  it('70% e 85% geram aviso; 0 nao gera; 95% so aparece se gravado (Storage e Mapbox)', () => {
    expect(rotuloAlerta(0)).toBeNull();
    expect(rotuloAlerta(1)).toBe('Aviso: 70% do limite');
    expect(rotuloAlerta(2)).toBe('Aviso: 85% do limite');
    expect(rotuloAlerta(3)).toBe('Aviso: 95% do limite');
  });

  it('rotulo de servico e periodo em texto de tela; codigo desconhecido aparece como esta', () => {
    expect(rotuloCota('email', 'dia_utc')).toBe('E-mail · Hoje (UTC)');
    expect(rotuloCota('mapbox_permanent', 'mes')).toBe('Mapbox (permanente) · No mês');
    expect(rotuloCota('servico_novo', 'mes')).toBe('servico_novo · No mês');
  });
});

describe('idade em texto simples', () => {
  it('segundos, minutos e horas', () => {
    expect(idadeTexto(45)).toBe('45 segundos');
    expect(idadeTexto(120)).toBe('2 minutos');
    expect(idadeTexto(3600)).toBe('1 horas');
    expect(idadeTexto(3900)).toBe('1 horas e 5 minutos');
  });
});
