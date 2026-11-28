// H-107 (Issue 116) | Estado da tela do catalogo (docs/factory/81-DESENHO-H107.md §5; 77-REFINO-H107.md CA-11).
// Funcoes puras: resposta da API a estado de tela. Sem React, sem rede. Valores sinteticos.
import { describe, expect, it } from 'vitest';
import {
  estadoDaGravacao,
  estadoDoCatalogo,
  motivoDoCampo,
  rotuloModalidade,
  TEXTO_ERRO_CARREGAR,
  TEXTO_ERRO_SALVAR,
  TEXTO_LISTA_VAZIA,
} from '../src/catalog-state.js';

const GRUPO = { id: 'g1', name: 'Saude', position: 1, active: true, version: 2 };
const SERVICO = { id: 's1', group_id: 'g1', name: 'Obra', modality: 'presencial', regulated: false, active: true, version: 1 };
const SINONIMO = { id: 'y1', service_id: 's1', term: 'construcao', active: true, version: 1 };

describe('T-H107-A leitura da tela (CA-11, estado vazio e erro)', () => {
  it('404 vira sem acesso (a tela responde como inexistente)', () => {
    expect(estadoDoCatalogo(404, null)).toEqual({ tipo: 'sem_acesso' });
  });

  it('lista vazia e lista com itens: a forma do contrato entra inteira', () => {
    expect(estadoDoCatalogo(200, { grupos: [], servicos: [], sinonimos: [] })).toEqual({
      tipo: 'lista',
      grupos: [],
      servicos: [],
      sinonimos: [],
    });
    const cheio = estadoDoCatalogo(200, { grupos: [GRUPO], servicos: [SERVICO], sinonimos: [SINONIMO] });
    expect(cheio.tipo).toBe('lista');
    expect(TEXTO_LISTA_VAZIA).toBe('Nenhum item encontrado.');
  });

  it('erro de rede, 500 e corpo fora do contrato viram erro, nunca dado inventado', () => {
    expect(estadoDoCatalogo(500, {})).toEqual({ tipo: 'erro' });
    expect(estadoDoCatalogo(200, { grupos: 'x', servicos: [], sinonimos: [] })).toEqual({ tipo: 'erro' });
    expect(estadoDoCatalogo(200, { grupos: [{ id: 'g', name: 1 }], servicos: [], sinonimos: [] })).toEqual({ tipo: 'erro' });
    expect(TEXTO_ERRO_CARREGAR).toMatch(/Tente novamente/);
  });
});

describe('T-H107-B gravacao: erro por campo, conflito e sucesso (CA-11)', () => {
  it('201 e 200 viram salvo', () => {
    expect(estadoDaGravacao(201, { id: 'g1' }).situacao).toBe('salvo');
    expect(estadoDaGravacao(200, { id: 'g1' }).situacao).toBe('salvo');
  });

  it('422 liga cada motivo ao campo, com texto em portugues (sem codigo cru)', () => {
    const r = estadoDaGravacao(422, { code: 'dados_invalidos', campos: { name: 'obrigatorio', position: 'invalido' } });
    expect(r.situacao).toBe('erro');
    expect(r.mensagem).toBe('Corrija os campos destacados.');
    expect(r.campos).toEqual({ name: 'Preencha este campo.', position: 'Valor inválido.' });
  });

  it('sinonimo duplicado (409) aponta o termo e orienta a reativar', () => {
    const r = estadoDaGravacao(409, { code: 'sinonimo_duplicado', campos: { term: 'ja_existe' }, sugestao: 'reativar' });
    expect(r.situacao).toBe('erro');
    expect(r.campos.term).toBe('Este termo já existe neste serviço.');
    expect(r.mensagem).toMatch(/reative-o/);
  });

  it('versao em conflito (409) recarrega a lista sem perder o texto (situacao conflito)', () => {
    const r = estadoDaGravacao(409, { code: 'versao_em_conflito' });
    expect(r.situacao).toBe('conflito');
    expect(r.mensagem).toMatch(/Recarregue a lista/);
  });

  it('grupo sem servico ativo (409) orienta a ordem certa, para grupo e para servico', () => {
    expect(estadoDaGravacao(409, { code: 'grupo_sem_servico_ativo', sugestao: 'ativar_servico_antes' }).mensagem).toMatch(/ative antes/);
    expect(estadoDaGravacao(409, { code: 'grupo_sem_servico_ativo', sugestao: 'desativar_grupo_antes' }).mensagem).toMatch(/desative o grupo antes/);
  });

  it('404 na gravacao vira sem acesso; erro do servidor vira o texto de nada salvo', () => {
    expect(estadoDaGravacao(404, null).situacao).toBe('sem_acesso');
    const r = estadoDaGravacao(503, { code: 'catalogo_indisponivel' });
    expect(r.mensagem).toBe(TEXTO_ERRO_SALVAR);
    expect(r.mensagem).toMatch(/Nada foi alterado/);
    expect(JSON.stringify(r)).not.toMatch(/catalogo_indisponivel/);
  });

  it('motivo desconhecido vira texto generico, nunca o codigo', () => {
    expect(motivoDoCampo('qualquer_coisa')).toBe('Valor inválido.');
  });
});

describe('T-H107-C rotulos', () => {
  it('modalidade conhecida ganha rotulo; desconhecida aparece como veio', () => {
    expect(rotuloModalidade('ambos')).toBe('Presencial e online');
    expect(rotuloModalidade('remoto')).toBe('remoto');
  });
});
