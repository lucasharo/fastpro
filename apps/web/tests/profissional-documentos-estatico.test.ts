// H-037 (#50) | Testes estaticos da tela de envio do documento de identidade (docs/factory/107-DESENHO-H037.md §8).
// Leitura de arquivos, sem rede e sem navegador. Cobre: sem script nem estilo em linha, sem cor, fonte ou raio
// literal (tokens), sem armazenamento local nem innerHTML, sem log, sem nome de arquivo na API e foco por script
// com alvo focavel (WCAG 2.4.3, mesmo criterio de pedido-h030-estatico).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

const HTML = '../public/profissional-documentos.html';
const CSS = '../public/profissional-documentos.css';
const JS = '../public/profissional-documentos.js';

/** Linhas que nao sao comentario (texto de comentario nao e tela nem codigo). */
const semComentario = (texto: string) =>
  texto
    .split('\n')
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join('\n');

describe('postura da pagina (sem script ou estilo em linha)', () => {
  const html = ler(HTML);

  it('os scripts sao modulos externos da mesma origem (guarda de sessao e documentos)', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/guarda-sessao.js">', '<script type="module" src="/profissional-documentos.js">']);
  });

  it('sem atributo style, sem bloco style e sem manipulador de evento em linha', () => {
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('nao tem link de WhatsApp nem redirecionamento para terceiro', () => {
    expect(html).not.toMatch(/wa\.me/i);
    expect(html).not.toMatch(/target\s*=\s*["']?_blank/i);
  });

  it('o aviso de estado e o de alerta anunciam por regiao viva', () => {
    expect(html).toMatch(/id="estado"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="alerta"[^>]*role="alert"/);
  });

  it('as regioes vivas nunca somem do layout quando vazias (sem display:none em :empty)', () => {
    const css = ler(CSS);
    expect(css).not.toMatch(/:empty\s*,?\s*[^{]*\{\s*display\s*:\s*none/);
  });

  it('o campo de arquivo aceita so os quatro tipos declarados', () => {
    expect(html).toMatch(/accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  });
});

describe('tokens de design (sem valor literal de cor, fonte ou raio)', () => {
  it('o CSS nao tem cor literal (hex, rgb, hsl) nem nome de cor', () => {
    const css = semComentario(ler(CSS).replace(/\/\*[\s\S]*?\*\//g, ''));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\s*\(/i);
    expect(css).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey)\b/i);
  });

  it('toda declaracao de cor, fundo, borda e fonte usa var()', () => {
    const css = ler(CSS).replace(/\/\*[\s\S]*?\*\//g, '');
    const declaracoes = [...css.matchAll(/(?:^|[{;\s])((?:background|color|border(?:-color)?|font-family))\s*:\s*([^;}]+)/gm)];
    expect(declaracoes.length).toBeGreaterThan(5);
    const literais = declaracoes
      .map((m) => ({ prop: m[1], valor: m[2].trim() }))
      .filter((d) => !/var\(/.test(d.valor) && !['inherit', 'none', 'transparent', '0', 'currentColor'].includes(d.valor));
    expect(literais).toEqual([]);
  });

  it('o tamanho de letra e o raio vem de token ou de escala relativa, nunca de px', () => {
    const css = ler(CSS).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/font-size\s*:\s*\d+px/);
    expect(css).not.toMatch(/border-radius\s*:\s*\d+px/);
    expect(css).toMatch(/border-radius\s*:\s*var\(--radius-button\)/);
  });
});

describe('codigo da tela (seguranca, privacidade e logs)', () => {
  const js = semComentario(ler(JS));

  it('nao usa innerHTML, eval nem armazenamento do navegador', () => {
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('nao escreve em log (CA-10): nenhum console.* no codigo da tela', () => {
    expect(js).not.toMatch(/console\s*\./);
  });

  it('nunca le nem envia o nome do arquivo (CA-10)', () => {
    expect(js).not.toMatch(/\.name\b/);
    expect(js).not.toMatch(/filename/);
  });

  it('os caminhos da API sao so os da propria aplicacao, sem URL de leitura de documento', () => {
    const caminhos = [...js.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1]);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const c of caminhos) expect(c.startsWith('/api/v1/professional/documents')).toBe(true);
    expect(js).not.toMatch(/createSignedUrl|signedUrl|\/storage\/v1\/object\/(?!sign)/);
  });

  it('as chamadas nao levam cookie de terceiro nem referrer', () => {
    expect(js).toMatch(/referrerPolicy: 'no-referrer'/);
    expect(js).toMatch(/credentials: 'omit'/);
    expect(js).toMatch(/cache: 'no-store'/);
  });
});

// Foco por script (WCAG 2.4.3 / §5.4): todo elemento que o script foca precisa ser focavel.
// Elemento nativo (input, textarea, select, button, a[href]) dispensa atributo; qualquer outro (h2, p...)
// precisa de tabindex="-1", que o torna focavel por script sem entrar na ordem do Tab.
function idsFocadosPorScript(codigo: string): string[] {
  const variaveis = new Map<string, string>();
  for (const m of codigo.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:el|doc\.getElementById)\(\s*'([\w-]+)'\s*\)/g)) {
    variaveis.set(m[1], m[2]);
  }
  const ids = new Set<string>();
  for (const m of codigo.matchAll(/(?:\bel|doc\.getElementById)\(\s*'([\w-]+)'\s*\)\s*\.focus\(\s*\)/g)) ids.add(m[1]);
  for (const m of codigo.matchAll(/\b(\w+)\.focus\(\s*\)/g)) {
    const id = variaveis.get(m[1]);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

const NATIVO_FOCAVEL = /^<(input|textarea|select|button)\b|^<a\b[^>]*\bhref=/i;

/** Ids focados por script que nao sao nativos e nao tem tabindex="-1" (ou que nao existem no HTML). */
function focadosSemTabindex(codigo: string, html: string): string[] {
  const problemas: string[] = [];
  for (const id of idsFocadosPorScript(codigo)) {
    const tag = html.match(new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bid="${id}"[^>]*>`, 'i'))?.[0];
    if (!tag) {
      problemas.push(`${id} (elemento inexistente)`);
    } else if (!NATIVO_FOCAVEL.test(tag) && !/\stabindex="-1"/.test(tag)) {
      problemas.push(`${id} (sem tabindex="-1": ${tag})`);
    }
  }
  return problemas;
}

describe('CA-20 foco por script tem alvo focavel', () => {
  it('todo elemento focado por script tem tabindex="-1" ou e nativo', () => {
    expect(focadosSemTabindex(ler(JS), ler(HTML))).toEqual([]);
  });

  it('a tela foca a lista, o alerta, o campo de arquivo e o botao de repetir (lista conhecida)', () => {
    expect(idsFocadosPorScript(ler(JS))).toEqual(['alerta', 'arquivo', 'repetir', 'titulo-lista']);
  });

  it('o alvo de foco da lista e o alerta tem tabindex="-1" no HTML', () => {
    const html = ler(HTML);
    expect(html).toMatch(/<h2 id="titulo-lista" tabindex="-1">/);
    expect(html).toMatch(/<p id="alerta"[^>]*tabindex="-1"/);
  });

  it('o teste falha se um elemento focado por script perder o tabindex (demonstracao com HTML sintetico)', () => {
    const codigo = "const doc = {}; const el = (id) => doc.getElementById(id); const lista = el('titulo-lista'); lista.focus();";
    const semTabindex = '<h2 id="titulo-lista">Seus documentos</h2>';
    const comTabindex = '<h2 id="titulo-lista" tabindex="-1">Seus documentos</h2>';
    expect(focadosSemTabindex(codigo, semTabindex)).toEqual(['titulo-lista (sem tabindex="-1": <h2 id="titulo-lista">)']);
    expect(focadosSemTabindex(codigo, comTabindex)).toEqual([]);
  });
});

// Textos: a tela usa so os de packages/domain/src/identity-docs/textos.ts (IDOC_TEXTOS; decisoes 186, 226 e 260).
// Sem excecao de texto de tela. A unica excecao e o titulo da aba do navegador (nome do produto + pagina), que nao e
// texto de tela e nao consta de textos.ts.
describe('textos da tela = textos aprovados do dominio (sem texto inventado)', () => {
  const textos = ler('../../../packages/domain/src/identity-docs/textos.ts');
  const aprovados = [...textos.slice(textos.indexOf('IDOC_TEXTOS')).matchAll(/^\s+\w+: '([^']+)',?$/gm)].map((m) => m[1]);
  // #155 (desenho 178, AD-155-01): o cabecalho, a subnavegacao e o rodape comuns sao conferidos em navegacao-estatico.test.ts;
  // os textos de navegacao e a ligacao "Ver situacao" e a guarda nao sao texto de documento e saem desta conta.
  const EXCECOES = ['FastPro - Documento de identidade', 'Tentar de novo', 'Ver situação do cadastro'];
  const html = ler(HTML);
  const telaSemBlocos = html.replace(/<!-- fp:(cabecalho|subnav|rodape) -->[\s\S]*?<!-- \/fp:\1 -->/g, '');
  const bloco = ler(JS);
  const mensagens = bloco.slice(bloco.indexOf('export const MENSAGENS'), bloco.indexOf('});', bloco.indexOf('export const MENSAGENS')));
  const tela = html + bloco;

  it('o dominio tem os 26 textos aprovados (sanidade da leitura)', () => {
    expect(aprovados).toHaveLength(26);
  });

  it('cada texto de MENSAGENS e cada texto visivel do HTML existe em textos.ts ou esta na lista de excecao', () => {
    const doMapa = [...mensagens.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const doHtml = [...telaSemBlocos.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter((t) => t !== '');
    const inventados = [...doMapa, ...doHtml].filter((t) => !aprovados.includes(t) && !EXCECOES.includes(t));
    expect(inventados).toEqual([]);
  });

  it('cada texto aprovado de textos.ts aparece na tela (HTML ou codigo)', () => {
    const faltando = aprovados.filter((t) => !tela.includes(t));
    expect(faltando).toEqual([]);
  });
});

// R6: o documento nunca vai ao bucket de fotos nem e exibido de volta na tela (107 §13, T-19; CA-06).
describe('R6: sem bucket de fotos e sem exibicao do documento enviado', () => {
  const html = ler(HTML);
  const js = semComentario(ler(JS));
  const css = semComentario(ler(CSS).replace(/\/\*[\s\S]*?\*\//g, ''));

  it('a tela nao cita bucket, fila de fotos, midia nem caminho do Storage', () => {
    expect(html + js + css).not.toMatch(/request-photos|quarantine|MEDIA_|identity-incoming|identity-docs|storage\/v1|fotos-envio/i);
  });

  it('nao ha img, iframe, embed, object, video nem audio: o arquivo enviado nao e mostrado', () => {
    expect(html).not.toMatch(/<(img|iframe|embed|object|video|audio|picture|canvas)\b/i);
    expect(js).not.toMatch(/<(img|iframe|embed|object|canvas)\b/i);
  });

  // #155: a tela pode ter links de navegacao (cabecalho, subnavegacao, "Ver situacao"); o que e proibido e link ao arquivo.
  it('nao ha link para documento (nenhum href a arquivo, Storage ou blob) nem preview por URL local', () => {
    expect(html).not.toMatch(/href="[^"]*(storage|blob:|arquivo|\.pdf|\.jpe?g|\.png|\.webp)/i);
    expect(js).not.toMatch(/createObjectURL|URL\.revokeObjectURL|window\.open|\.src\s*=|\.href\s*=/);
  });

  it('o navegador nao le o conteudo do arquivo (so o envia ao Storage pela URL de uso unico)', () => {
    expect(js).not.toMatch(/FileReader|readAsDataURL|readAsArrayBuffer|readAsText|\.arrayBuffer\(\)|\.text\(\)/);
  });
});
