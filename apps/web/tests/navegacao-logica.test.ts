// #155 (desenho 178, S1; CA-NAV-05, 08, 16) | Logica pura da navegacao: rotas, entrada, sonda, perfil e destinos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ESTADOS_PUBLICOS_VERIFICACAO } from '@fastpro/domain';
import {
  ROTAS,
  ESTADO_APROVADO,
  decidirSonda,
  destinoSituacao,
  montarEntrada,
  perfilLiberado,
  rotaRetornavel
} from '../public/navegacao-logica.js';

describe('decidirSonda (AD-155-03)', () => {
  it('200 e 404 liberam (404 e ainda sem registro, nao falta de sessao)', () => {
    expect(decidirSonda(200)).toBe('liberar');
    expect(decidirSonda(404)).toBe('liberar');
  });
  it('401 e 403 mandam entrar', () => {
    expect(decidirSonda(401)).toBe('entrar');
    expect(decidirSonda(403)).toBe('entrar');
  });
  it('429, 5xx e falha de rede (sem status) sao indisponivel e nunca liberam', () => {
    for (const status of [429, 500, 502, 503, null, undefined, 0]) {
      expect(decidirSonda(status as number), String(status)).toBe('indisponivel');
    }
  });
});

describe('montarEntrada e rotaRetornavel (AD-155-04, 05; CA-NAV-16)', () => {
  it('cliente em rota da lista leva a /entrar com ?voltar= codificado', () => {
    expect(montarEntrada('cliente', '/painel')).toBe('/entrar?voltar=%2Fpainel');
  });
  it('profissional em rota da lista leva a /profissional/entrar com ?voltar=', () => {
    expect(montarEntrada('profissional', '/profissional-situacao')).toBe(
      '/profissional/entrar?voltar=%2Fprofissional-situacao'
    );
  });
  it('rota fora da lista volta sem ?voltar=', () => {
    expect(montarEntrada('cliente', '/')).toBe('/entrar');
    expect(montarEntrada('cliente', '/admin')).toBe('/entrar');
  });
  it('valores de retorno perigosos nunca viram destino', () => {
    for (const valor of ['//evil.test', 'https://evil.test', 'http://evil.test', 'javascript:alert(1)', '/%2F%2Fevil']) {
      expect(montarEntrada('cliente', valor), valor).toBe('/entrar');
      expect(rotaRetornavel(valor), valor).toBeNull();
    }
  });
  it('area desconhecida nao monta entrada', () => {
    expect(montarEntrada('admin', '/painel')).toBeNull();
  });
  it('rotaRetornavel aceita so as rotas marcadas como retornaveis', () => {
    expect(rotaRetornavel('/profissional-documentos')).toBe('/profissional-documentos');
    expect(rotaRetornavel('/pedido/revisao')).toBe('/pedido/revisao');
    expect(rotaRetornavel('/entrar')).toBeNull();
  });
});

describe('perfilLiberado (AD-155-06, RN-NAV-08)', () => {
  it('ESTADO_APROVADO e um valor real do dominio', () => {
    expect((ESTADOS_PUBLICOS_VERIFICACAO as readonly string[]).includes(ESTADO_APROVADO)).toBe(true);
    expect(ESTADO_APROVADO).toBe('aprovada');
  });
  it('so a aprovacao libera o perfil', () => {
    expect(perfilLiberado('aprovada')).toBe(true);
    for (const estado of ESTADOS_PUBLICOS_VERIFICACAO.filter((e) => e !== 'aprovada')) {
      expect(perfilLiberado(estado), estado).toBe(false);
    }
    expect(perfilLiberado(undefined)).toBe(false);
  });
});

describe('destinoSituacao (AD-155-12)', () => {
  it('aceita so destinos da lista fixa', () => {
    expect(destinoSituacao('/profissional-documentos')).toBe('/profissional-documentos');
    expect(destinoSituacao('//evil.test')).toBeNull();
    expect(destinoSituacao('/admin')).toBeNull();
  });
});

describe('tabela de rotas (AD-155-02) e paridade com o retorno seguro (AD-155-04)', () => {
  it('rotas e arquivos sao unicos', () => {
    expect(new Set(ROTAS.map((r) => r.rota)).size).toBe(ROTAS.length);
    expect(new Set(ROTAS.map((r) => r.arquivo)).size).toBe(ROTAS.length);
  });
  it('toda rota retornavel esta na lista fixa de destinoSeguro de entrada-comum.js', () => {
    const fonte = readFileSync(new URL('../public/entrada-comum.js', import.meta.url), 'utf8');
    const lista = fonte.match(/var DESTINOS_VOLTAR = \[([^\]]*)\]/)?.[1] ?? '';
    const aceitos = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const r of ROTAS.filter((x) => x.retornavel)) {
      expect(aceitos, r.rota).toContain(r.rota);
    }
  });
});
