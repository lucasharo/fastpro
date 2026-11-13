// H-031 (Issue #44) | Testes da logica pura da publicacao (docs/factory/110-DESENHO-H031.md, §3 e §8).
// Sem rede e sem navegador: so a interpretacao da resposta de POST /v1/requests e os textos de cada desfecho.
import { describe, it, expect } from 'vitest';
import { ackDuplicidadeSobrevive, interpretarPublicacao, PUBLICACAO_TEXTOS, textoDaPublicacao } from '../public/pedido-logica.js';

describe('ackDuplicidadeSobrevive: o aviso de duplicidade so se perde com resposta do servidor (H-031, #44)', () => {
  it('falha de rede (manterAck) e o proprio aviso mantem o token; os demais desfechos o limpam', () => {
    expect(ackDuplicidadeSobrevive({ tipo: 'indisponivel', manterAck: true })).toBe(true);
    expect(ackDuplicidadeSobrevive({ tipo: 'duplicidade', ackToken: 'tok.1' })).toBe(true);
    expect(ackDuplicidadeSobrevive({ tipo: 'indisponivel' })).toBe(false);
    expect(ackDuplicidadeSobrevive({ tipo: 'publicado', acceptanceDeadlineAt: 'x' })).toBe(false);
    expect(ackDuplicidadeSobrevive({ tipo: 'limite' })).toBe(false);
  });
});

describe('interpretarPublicacao (110 §3): cada resposta vira um desfecho fechado', () => {
  it('201 e 200 com status publicado viram publicado, com o prazo de aceite', () => {
    const corpo = { status: 'publicado', id: 'x', publishedAt: '2026-11-13T12:00:00Z', acceptanceDeadlineAt: '2026-11-20T12:00:00Z' };
    expect(interpretarPublicacao(201, corpo)).toEqual({ tipo: 'publicado', acceptanceDeadlineAt: '2026-11-20T12:00:00Z' });
    expect(interpretarPublicacao(200, corpo).tipo).toBe('publicado');
  });

  it('409 duplicidade traz o token de aviso (ackToken) para o reenvio', () => {
    expect(interpretarPublicacao(409, { code: 'duplicidade', ackToken: 'tok.123' })).toEqual({ tipo: 'duplicidade', ackToken: 'tok.123' });
    expect(interpretarPublicacao(409, { code: 'duplicidade' })).toEqual({ tipo: 'duplicidade', ackToken: null });
  });

  it('409 de conteudo, e-mail e fotos, e 202 e 409 de geocodificacao viram processando', () => {
    expect(interpretarPublicacao(409, { code: 'conteudo_alterado' })).toEqual({ tipo: 'conteudo_alterado' });
    expect(interpretarPublicacao(409, { code: 'email_divergente' })).toEqual({ tipo: 'email_divergente' });
    expect(interpretarPublicacao(409, { code: 'fotos_em_processamento' })).toEqual({ tipo: 'fotos' });
    expect(interpretarPublicacao(202, { code: 'aguardando_geocodificacao' })).toEqual({ tipo: 'processando' });
    expect(interpretarPublicacao(409, { code: 'geocodificacao_em_andamento' })).toEqual({ tipo: 'processando' });
    expect(interpretarPublicacao(409, { code: 'em_andamento' })).toEqual({ tipo: 'processando' });
  });

  it('401, 404 e 429 viram sessao, vencido e limite', () => {
    expect(interpretarPublicacao(401, { code: 'sessao_necessaria' })).toEqual({ tipo: 'sessao' });
    expect(interpretarPublicacao(404, { code: 'nao_encontrado' })).toEqual({ tipo: 'vencido' });
    expect(interpretarPublicacao(429, { code: 'limite' })).toEqual({ tipo: 'limite' });
  });

  it('422 de endereco, limite de enderecos e campos faltando', () => {
    expect(interpretarPublicacao(422, { code: 'endereco_nao_encontrado' })).toEqual({ tipo: 'endereco' });
    expect(interpretarPublicacao(422, { code: 'geocode_limit' })).toEqual({ tipo: 'limite_enderecos' });
    expect(interpretarPublicacao(422, { code: 'campos_faltando', missing: ['titulo'] })).toEqual({ tipo: 'campos', missing: ['titulo'] });
  });

  it('503 e qualquer outra resposta viram indisponivel', () => {
    expect(interpretarPublicacao(503, { code: 'publicacao_indisponivel' })).toEqual({ tipo: 'indisponivel' });
    expect(interpretarPublicacao(500, null)).toEqual({ tipo: 'indisponivel' });
  });
});

describe('textos da publicacao (110 §8)', () => {
  it('cada erro tem o texto do desenho, sem endereco nem coordenada', () => {
    expect(textoDaPublicacao('limite')).toBe('Muitas tentativas. Tente de novo mais tarde.');
    expect(textoDaPublicacao('vencido')).toBe('Seu pedido expirou. Refaça o pedido.');
    expect(textoDaPublicacao('indisponivel')).toBe('Não foi possível publicar agora. Seus dados continuam salvos. Tente de novo.');
    expect(textoDaPublicacao('tipo-que-nao-existe')).toBe('');
  });

  it('"publicado" so aparece nas frases aprovadas e o prazo usa data em pt-BR', () => {
    expect(PUBLICACAO_TEXTOS.publicado).toBe('Pedido publicado.');
    expect(PUBLICACAO_TEXTOS.aceitesAte('2026-11-20T12:00:00Z')).toMatch(/^Aceites até \d{2}\/\d{2}\/\d{4}\.$/);
    expect(PUBLICACAO_TEXTOS.aceitesAte('nao-e-data')).toBe('Aceites até .');
  });
});
