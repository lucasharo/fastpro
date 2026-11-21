// #154 (desenho 176, S2; CA-154-07, 08; CA-154-13 em parte) | Links entre as telas do cliente e ajustes em /acesso e /codigo.
// Confere o HTML versionado e o comportamento do script de /acesso com DOM simulado (node:vm). Sem rede.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { carregarPagina, documentoFalso, resposta, type RespostaFalsa } from './entrada-dom-falso';

const lerPublico = (arquivo: string) => readFileSync(new URL(`../public/${arquivo}`, import.meta.url), 'utf8');
const TOKEN = 'TOKEN-SINTETICO-' + 'p'.repeat(28);

describe('entrar.html: estrutura e links (desenho 176 §4.1, §4.2, §6)', () => {
  const html = lerPublico('entrar.html');

  it('idioma pt-BR, um unico h1, conteudo principal com id conteudo', () => {
    expect(html).toContain('<html lang="pt-BR">');
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('<main id="conteudo"');
  });

  it('blocos de cabecalho e rodape vazios para a Issue 155', () => {
    expect(html).toMatch(/<!-- fp:cabecalho -->\s*<!-- \/fp:cabecalho -->/);
    expect(html).toMatch(/<!-- fp:rodape -->\s*<!-- \/fp:rodape -->/);
  });

  it('links para o codigo e para a entrada do profissional (CA-154-13)', () => {
    expect(html).toContain('href="/codigo"');
    expect(html).toContain('href="/profissional/entrar"');
  });

  it('formulario em POST, sem action, e campo de e-mail com rotulo e descricao de erro', () => {
    expect(html).toContain('<form id="formulario" method="post"');
    expect(html).not.toMatch(/\saction=/);
    expect(html).toContain('<label for="email">E-mail</label>');
    expect(html).toContain('aria-describedby="erro-email"');
    expect(html).toContain('id="erro-geral" class="entrada-erro" role="alert"');
    expect(html).toContain('id="resultado" class="entrada-status" role="status"');
  });

  it('carrega o modulo comum antes da pagina, sem script embutido', () => {
    const comum = html.indexOf('src="/entrada-comum.js"');
    const pagina = html.indexOf('src="/entrar.js"');
    expect(comum).toBeGreaterThan(-1);
    expect(pagina).toBeGreaterThan(comum);
    expect(/<script(?![^>]*\ssrc=)/.test(html)).toBe(false);
  });

  it('sem endereco externo, sem atributo de evento e sem login social (CA-154-18)', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/Google|Apple/);
  });
});

describe('acesso.html e codigo.html: link Pedir novo acesso e Voltar (CA-154-07, CA-154-13)', () => {
  it('acesso.html tem o link "Pedir novo acesso" para /entrar, presente no HTML', () => {
    const html = lerPublico('acesso.html');
    expect(html).toContain('<a id="novo-acesso" class="entrada-link" href="/entrar">Pedir novo acesso</a>');
    expect(html).toContain('<link rel="stylesheet" href="/entrada.css" />');
    expect(html).toContain('<meta name="viewport"');
  });

  it('codigo.html tem o link Voltar para /entrar', () => {
    expect(lerPublico('codigo.html')).toContain('<a href="/entrar">Voltar</a>');
  });
});

describe('acesso.js: o link "Pedir novo acesso" some so depois do sucesso (desenho 176 §4.1)', () => {
  const IDS = ['confirmar', 'aviso', 'novo-acesso'];
  const CONFIRMADO = 'Acesso confirmado. A próxima etapa será liberada em breve.';
  const INVALIDO = 'Este link não pode mais ser usado. Peça um novo acesso.';

  async function rodar(consumo: RespostaFalsa, sessao?: RespostaFalsa) {
    const doc = documentoFalso(IDS, 'acesso');
    const pagina = carregarPagina(['acesso.js'], doc, async (url) => {
      if (url.endsWith('/consume')) return consumo;
      return sessao ?? resposta(200, { status: 'autenticado' });
    }, `#t=${TOKEN}`);
    doc.el('confirmar').disparar('click');
    await pagina.esperar();
    return { doc, pagina };
  }

  it('sucesso: aviso confirmado e link escondido', async () => {
    const { doc } = await rodar(resposta(200, {}));
    expect(doc.el('aviso').textContent).toBe(CONFIRMADO);
    expect(doc.el('novo-acesso').hidden).toBe(true);
  });

  it('link recusado (400): aviso de link invalido e link continua visivel', async () => {
    const { doc } = await rodar(resposta(400, {}));
    expect(doc.el('aviso').textContent).toBe(INVALIDO);
    expect(doc.el('novo-acesso').hidden).toBe(false);
  });

  it('o script nao chama a API ao carregar, so no clique (CA-H012-01)', async () => {
    const doc = documentoFalso(IDS, 'acesso');
    const pagina = carregarPagina(['acesso.js'], doc, async () => resposta(200, {}), `#t=${TOKEN}`);
    await pagina.esperar();
    expect(pagina.chamadas).toHaveLength(0);
  });
});
