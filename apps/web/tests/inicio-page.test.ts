// Issue #153 | Testes da visao da pagina inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §8, fatia 2).
// DOM simulado (inicio-dom-simulado.ts) e fake do fetch: nenhuma rede real. Cobre CA-W01 a CA-W05, CA-W09 a CA-W12,
// CA-W19 e CA-W21: marcacao, busca, teclado, sugestao de endereco, erros de campo e foco, e so chamadas a propria API.
import { describe, it, expect } from 'vitest';
import { ADDRESS_NEUTRAL_MESSAGE } from '../public/address-field.js';
import { ligarPagina } from '../public/inicio.js';
import {
  HTML_INICIO,
  JS_INICIO,
  criarJanela,
  digitar,
  esperar,
  escolherPrimeiroServico,
  rotaComBusca,
  teclar,
  type Desfecho,
} from './inicio-dom-simulado';

function montar(roteador = rotaComBusca(() => undefined)) {
  const ctx = criarJanela(roteador);
  ligarPagina(ctx.janela);
  return ctx;
}

const SEM_ROTA = () => undefined;

/** Issue 159: na escolha do servico o rascunho ainda nao existe (GET 404, POST 201); a sugestao responde como sugestao. */
function rotaDeRascunho(sugestao: () => Desfecho) {
  return rotaComBusca((url, chamada) => {
    if (url === '/api/v1/drafts/current' && chamada.method === 'GET') return { status: 404, corpo: { code: 'nao_encontrado' } };
    if (url === '/api/v1/drafts' && chamada.method === 'POST') return { status: 201, corpo: {} };
    if (url === '/api/v1/geo/address-suggest') return sugestao();
    return undefined;
  });
}

describe('marcacao da inicial (CA-W01, CA-W21)', () => {
  it('traz titulo, frase de apoio e os rotulos aprovados', () => {
    // Titulo do hero (redesenho visual): a marca abre o h1, seguida da proposta de valor.
    expect(HTML_INICIO).toMatch(/<h1 id="ini-titulo">FastPro: [^<]+<span class="ini-destaque">[^<]+<\/span><\/h1>/);
    expect(HTML_INICIO).toContain('Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido.');
    expect(HTML_INICIO).toContain('Qual serviço você precisa?');
    expect(HTML_INICIO).toContain('Onde o serviço será feito?');
    expect(HTML_INICIO).toContain('lang="pt-BR"');
  });

  it('nao traz texto de previa nem formulario de entrada; links do conteudo so para rotas da propria web', () => {
    expect(HTML_INICIO).not.toContain('Sem conteúdo de produto');
    // Decisao do dono (2026-11-21, redesenho pelo template de referencia) substitui a D-5 (#155) so na inicial:
    // o conteudo pode ter chamadas para pedir, cadastrar ou entrar, mas sem campo de senha e sem origem externa.
    const principal = HTML_INICIO.slice(HTML_INICIO.indexOf('<main'), HTML_INICIO.indexOf('</main>'));
    expect(principal).not.toMatch(/[Ss]enha|type="password"/);
    for (const m of principal.matchAll(/<a\s[^>]*href="([^"]+)"/g)) expect(m[1]).toMatch(/^(\/|#)/);
  });

  it('nao tem script inline, estilo inline nem <style> (CSP style-src self)', () => {
    expect(HTML_INICIO).not.toMatch(/<style[\s>]/);
    expect(HTML_INICIO).not.toMatch(/\sstyle=/);
    expect(HTML_INICIO).toMatch(/<script type="module" src="\/inicio\.js"><\/script>/);
  });
});

describe('busca de servico (CA-W02, CA-W03)', () => {
  it('um caractere nao chama a API', () => {
    const ctx = montar(SEM_ROTA);
    digitar(ctx.documento.getElementById('servico'), 'e');
    ctx.rodarTimers();
    expect(ctx.chamadas).toHaveLength(0);
  });

  it('a partir de 2 caracteres busca so em /api/v1/catalog/service-search, com {q} apenas', async () => {
    const ctx = montar();
    digitar(ctx.documento.getElementById('servico'), 'el');
    ctx.rodarTimers();
    await esperar();
    const busca = ctx.chamadas[0];
    expect(busca?.url).toBe('/api/v1/catalog/service-search');
    expect(busca?.method).toBe('POST');
    expect(JSON.parse(busca?.body ?? '{}')).toEqual({ q: 'el' });
    expect(busca?.credentials).toBe('same-origin');
    expect(busca?.redirect).toBe('error');
  });

  it('mostra os servicos como opcoes e o teclado escolhe com seta e Enter', async () => {
    const ctx = montar();
    const servico = ctx.documento.getElementById('servico');
    const lista = ctx.documento.getElementById('servico-lista');
    digitar(servico, 'el');
    ctx.rodarTimers();
    await esperar();
    expect(lista.children).toHaveLength(2);
    expect(lista.children[0]?.getAttribute('role')).toBe('option');
    expect(lista.children[0]?.textContent).toBe('Eletricista');
    teclar(servico, 'ArrowDown');
    expect(servico.getAttribute('aria-activedescendant')).toBe('servico-lista-0');
    teclar(servico, 'Enter');
    expect(servico.value).toBe('Eletricista');
    expect(ctx.documento.getElementById('servico-aviso').textContent).toBe('Serviço escolhido.');
    expect(lista.children).toHaveLength(0);
  });

  it('Escape fecha a lista sem escolher', async () => {
    const ctx = montar();
    const servico = ctx.documento.getElementById('servico');
    digitar(servico, 'el');
    ctx.rodarTimers();
    await esperar();
    teclar(servico, 'Escape');
    expect(ctx.documento.getElementById('servico-lista').children).toHaveLength(0);
    expect(servico.value).toBe('el');
  });

  it('resposta vazia mostra o aviso de nao encontrado', async () => {
    const ctx = montar(() => ({ status: 200, corpo: { status: 'vazio' } }));
    digitar(ctx.documento.getElementById('servico'), 'xyz');
    ctx.rodarTimers();
    await esperar();
    expect(ctx.documento.getElementById('servico-aviso').textContent).toBe(
      'Não encontramos esse serviço. Tente outra palavra.',
    );
  });

  it('falha da busca mostra aviso neutro, sem detalhe tecnico', async () => {
    const ctx = montar(() => 'rede');
    digitar(ctx.documento.getElementById('servico'), 'xyz');
    ctx.rodarTimers();
    await esperar();
    expect(ctx.documento.getElementById('servico-aviso').textContent).toBe(
      'Não foi possível buscar agora. Tente de novo.',
    );
  });
});

describe('endereco (CA-W10, CA-W12)', () => {
  it('a sugestao usa o contexto do rascunho e so a propria API (depois que o rascunho existe)', async () => {
    const ctx = montar(rotaDeRascunho(() => ({ status: 200, corpo: { mode: 'ok', items: [{ label: 'Rua das Flores, 10' }] } })));
    await escolherPrimeiroServico(ctx);
    await esperar();
    digitar(ctx.documento.getElementById('endereco'), 'Rua das');
    ctx.rodarTimers();
    await esperar();
    const sugestao = ctx.chamadas.find((c) => c.url.includes('address-suggest'));
    expect(sugestao?.url).toBe('/api/v1/geo/address-suggest');
    expect(JSON.parse(sugestao?.body ?? '{}')).toEqual({ q: 'Rua das', context: 'request_draft' });
    expect(ctx.documento.getElementById('endereco-lista').children[0]?.textContent).toBe('Rua das Flores, 10');
  });

  it('falha da sugestao nao bloqueia o texto livre', async () => {
    const ctx = montar(rotaDeRascunho(() => 'rede'));
    await escolherPrimeiroServico(ctx);
    await esperar();
    const endereco = ctx.documento.getElementById('endereco');
    digitar(endereco, 'Rua das Flores');
    ctx.rodarTimers();
    await esperar();
    expect(ctx.documento.getElementById('endereco-aviso').textContent).toBe(ADDRESS_NEUTRAL_MESSAGE);
    expect(endereco.value).toBe('Rua das Flores');
  });
  });

describe('Continuar sem dados validos (CA-W04, CA-W13)', () => {
  it('sem servico: E-01 no campo, foco no servico e nenhuma requisicao de criacao', () => {
    const ctx = montar(SEM_ROTA);
    ctx.documento.getElementById('formulario').disparar('submit');
    expect(ctx.documento.getElementById('servico-erro').textContent).toBe('Escolha um serviço da lista para continuar.');
    expect(ctx.documento.getElementById('servico').getAttribute('aria-invalid')).toBe('true');
    expect(ctx.documento.activeElement?.id).toBe('servico');
    expect(ctx.chamadas).toHaveLength(0);
  });

  it('com servico e endereco curto: E-02 no endereco, foco nele e sem rascunho novo na validacao', async () => {
    const ctx = montar(rotaDeRascunho(() => ({ status: 200, corpo: { mode: 'ok', items: [] } })));
    await escolherPrimeiroServico(ctx);
    await esperar();
    const antes = ctx.chamadas.filter((c) => c.url.startsWith('/api/v1/drafts')).length;
    digitar(ctx.documento.getElementById('endereco'), 'ab');
    ctx.documento.getElementById('formulario').disparar('submit');
    expect(ctx.documento.getElementById('endereco-erro').textContent).toBe(
      'Preencha o endereço com pelo menos 3 caracteres.',
    );
    expect(ctx.documento.activeElement?.id).toBe('endereco');
    expect(ctx.chamadas.filter((c) => c.url.startsWith('/api/v1/drafts')).length).toBe(antes);
  });

  it('Enter sem opcao ativa nao escolhe nada nem chama a API', () => {
    const ctx = montar(SEM_ROTA);
    const servico = ctx.documento.getElementById('servico');
    digitar(servico, 'el');
    teclar(servico, 'Enter');
    expect(servico.value).toBe('el');
    expect(ctx.documento.getElementById('servico-erro').textContent).toBe('');
    expect(ctx.chamadas).toHaveLength(0);
  });
});

describe('so chamadas a propria API (CA-W05, CA-W19)', () => {
  it('todas as chamadas da pagina vao para /api/v1/ na mesma origem', async () => {
    const ctx = montar(() => ({ status: 200, corpo: { mode: 'ok', items: [{ label: 'Rua das Flores' }] } }));
    await escolherPrimeiroServico(ctx);
    digitar(ctx.documento.getElementById('endereco'), 'Rua das');
    ctx.rodarTimers();
    await esperar();
    expect(ctx.chamadas.length).toBeGreaterThan(0);
    for (const chamada of ctx.chamadas) {
      expect(chamada.url.startsWith('/api/v1/')).toBe(true);
      expect(chamada.credentials).toBe('same-origin');
      expect(chamada.cache).toBe('no-store');
    }
  });

  it('o script nao usa armazenamento do navegador, cookie, log nem HTML dinamico', () => {
    expect(JS_INICIO).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
    expect(JS_INICIO).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\(/);
  });
});
