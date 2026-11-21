// Issue #153 | Testes da logica pura da pagina inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §8, fatia 1).
// Sem navegador e sem rede: so funcoes puras. Cobre os erros E-01 a E-03, os tres ramos de "Continuar",
// a leitura do 404 da API (sem rascunho) e o 404 da plataforma (indisponivel), e a paridade com a API.
import { describe, it, expect } from 'vitest';
import { ADDRESS_QUERY_MAX } from '@fastpro/domain';
import {
  INICIO_TEXTOS,
  decidirCriacao,
  enderecoParaEnvio,
  interpretarEscrita,
  interpretarRascunhoAtual,
  montarCorpo,
  textoDoErro,
  validarCampos,
} from '../public/inicio-logica.js';
import { ADDRESS_MIN_CHARS, ADDRESS_MAX_CHARS } from '../public/address-field.js';

const SERVICO = 'svc-1';
const OUTRO = 'svc-2';
const enderecoDe = (n: number) => 'a'.repeat(n);

describe('validarCampos (E-01, E-02, E-03)', () => {
  it('pede o servico quando nao foi escolhido da lista (E-01)', () => {
    const erros = validarCampos({ servicoId: null, endereco: 'Rua das Flores, 10' });
    expect(erros.map((e) => e.codigo)).toEqual(['E-01']);
    expect(erros[0]?.campo).toBe('servico');
  });

  it('considera servico vazio como ausente', () => {
    expect(validarCampos({ servicoId: '   ', endereco: 'Rua das Flores' }).map((e) => e.codigo)).toEqual(['E-01']);
    expect(validarCampos({ servicoId: '', endereco: 'Rua das Flores' }).map((e) => e.codigo)).toEqual(['E-01']);
  });

  it('pede o endereco quando vazio ou so com espacos (E-02)', () => {
    expect(validarCampos({ servicoId: SERVICO, endereco: '' }).map((e) => e.codigo)).toEqual(['E-02']);
    expect(validarCampos({ servicoId: SERVICO, endereco: '     ' }).map((e) => e.codigo)).toEqual(['E-02']);
  });

  it('endereco curto (menos de 3 caracteres) e E-02', () => {
    expect(validarCampos({ servicoId: SERVICO, endereco: 'ab' }).map((e) => e.codigo)).toEqual(['E-02']);
    expect(validarCampos({ servicoId: SERVICO, endereco: 'abc' })).toEqual([]);
  });

  it('endereco com mais de 120 caracteres e E-03; 120 exatos passam', () => {
    expect(validarCampos({ servicoId: SERVICO, endereco: enderecoDe(120) })).toEqual([]);
    expect(validarCampos({ servicoId: SERVICO, endereco: enderecoDe(121) }).map((e) => e.codigo)).toEqual(['E-03']);
  });

  it('conta espacos repetidos como um so antes do limite', () => {
    const comEspacos = `Rua${' '.repeat(50)}das   Flores`;
    expect(validarCampos({ servicoId: SERVICO, endereco: comEspacos })).toEqual([]);
  });

  it('devolve os erros na ordem servico -> endereco', () => {
    const erros = validarCampos({ servicoId: null, endereco: '' });
    expect(erros.map((e) => e.codigo)).toEqual(['E-01', 'E-02']);
  });

  it('sem erros quando os dois campos estao corretos', () => {
    expect(validarCampos({ servicoId: SERVICO, endereco: 'Rua das Flores, 10' })).toEqual([]);
  });
});

describe('montarCorpo (so service_id e address_text)', () => {
  it('monta exatamente {service_id, address_text}', () => {
    expect(montarCorpo({ servicoId: SERVICO, endereco: '  Rua das Flores,  10 ' })).toEqual({
      service_id: SERVICO,
      address_text: 'Rua das Flores, 10',
    });
    expect(Object.keys(montarCorpo({ servicoId: SERVICO, endereco: 'Rua das Flores' })).sort()).toEqual([
      'address_text',
      'service_id',
    ]);
  });

  it('enderecoParaEnvio normaliza espacos e controles', () => {
    expect(enderecoParaEnvio('a\u0007  b\tc')).toBe('a b c');
  });
});

describe('decidirCriacao (tres ramos de Continuar, decisao 941)', () => {
  it('sem rascunho -> criar', () => {
    expect(decidirCriacao({ atual: null, servicoId: SERVICO })).toBe('criar');
  });

  it('mesmo servico, com descricao -> atualizar (nao pede confirmacao)', () => {
    const atual = { service_id: SERVICO, description: 'Tomada queimada', urgency: 'imediato' };
    expect(decidirCriacao({ atual, servicoId: SERVICO })).toBe('atualizar');
  });

  it('outro servico sem descricao nem urgencia -> atualizar', () => {
    const atual = { service_id: OUTRO, description: null, urgency: null };
    expect(decidirCriacao({ atual, servicoId: SERVICO })).toBe('atualizar');
  });

  it('outro servico com descricao -> confirmar', () => {
    const atual = { service_id: OUTRO, description: 'Tomada queimada', urgency: null };
    expect(decidirCriacao({ atual, servicoId: SERVICO })).toBe('confirmar');
  });

  it('outro servico com urgencia -> confirmar', () => {
    const atual = { service_id: OUTRO, description: '   ', urgency: 'proximo_mes' };
    expect(decidirCriacao({ atual, servicoId: SERVICO })).toBe('confirmar');
  });
});

describe('interpretarRascunhoAtual (404 da API x 404 da plataforma)', () => {
  it('200 com corpo do rascunho -> rascunho', () => {
    const view = { service_id: SERVICO, description: null };
    expect(interpretarRascunhoAtual(200, view)).toEqual({ tipo: 'rascunho', view });
  });

  it('404 com corpo JSON da API -> sem rascunho (pode criar)', () => {
    expect(interpretarRascunhoAtual(404, { code: 'nao_encontrado' })).toEqual({ tipo: 'sem_rascunho' });
  });

  it('404 sem corpo JSON (plataforma / API fora do ar) -> indisponivel, nunca sem rascunho', () => {
    expect(interpretarRascunhoAtual(404, null)).toEqual({ tipo: 'indisponivel' });
  });

  it('404 com corpo JSON de outro formato -> indisponivel', () => {
    expect(interpretarRascunhoAtual(404, { mensagem: 'nao achado' })).toEqual({ tipo: 'indisponivel' });
  });

  it('5xx e 429 -> indisponivel', () => {
    expect(interpretarRascunhoAtual(500, null)).toEqual({ tipo: 'indisponivel' });
    expect(interpretarRascunhoAtual(429, { code: 'limite' })).toEqual({ tipo: 'indisponivel' });
  });
});

describe('interpretarEscrita (POST e PATCH)', () => {
  it('201 e 200 gravam; 429 e limite; o resto e falha', () => {
    expect(interpretarEscrita(201)).toEqual({ tipo: 'ok' });
    expect(interpretarEscrita(200)).toEqual({ tipo: 'ok' });
    expect(interpretarEscrita(429)).toEqual({ tipo: 'limite' });
    expect(interpretarEscrita(503)).toEqual({ tipo: 'falha' });
    expect(interpretarEscrita(404)).toEqual({ tipo: 'falha' });
    expect(interpretarEscrita(0)).toEqual({ tipo: 'falha' });
  });
});

describe('textos da inicial', () => {
  it('E-07 tem o texto aprovado (desenho §5.3)', () => {
    expect(textoDoErro('falha')).toBe(
      'Não foi possível continuar agora. Seus dados estão aqui; tente de novo.',
    );
    expect(textoDoErro('limite')).toBe(INICIO_TEXTOS.muitasTentativas);
  });

  it('nenhum texto tem termos comerciais, tecnicos ou valores (CA-W20)', () => {
    const proibidos = /grátis|gratis|barato|promoção|promocao|R\$|\bAPI\b|token|UUID/i;
    for (const [chave, texto] of Object.entries(INICIO_TEXTOS)) {
      expect(typeof texto === 'string' && proibidos.test(texto), chave).toBe(false);
    }
  });

  it('a frase de apoio e a aprovada em decisao 945', () => {
    expect(INICIO_TEXTOS.apoio).toBe(
      'Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido.',
    );
  });
});

describe('paridade de limites com a API', () => {
  it('o minimo, o maximo e a normalizacao do endereco batem com o dominio', () => {
    expect(ADDRESS_MIN_CHARS).toBe(3);
    expect(ADDRESS_MAX_CHARS).toBe(ADDRESS_QUERY_MAX);
    expect(ADDRESS_MAX_CHARS).toBe(120);
  });
});
