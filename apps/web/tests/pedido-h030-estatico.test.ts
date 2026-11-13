// H-030 (Issue #43) | Testes estaticos das telas /pedido e /pedido/revisao (docs/factory/90-DESENHO-H030.md, §7.3).
// Leitura de arquivos, sem rede e sem navegador. Cobre CA-02 (urgencia no HTML), CA-11 (sem coordenada),
// CA-13 (so a frase aprovada diz "publicado"), CA-14 (sem hex, sem style em linha, sem script inline) e a CSP.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

const HTML = ['../public/pedido.html', '../public/pedido/revisao.html'];
const CODIGO = ['../public/pedido.js', '../public/pedido-revisao.js', '../public/pedido-logica.js'];
const ESTILO = ['../public/pedido.css'];
const TODOS = [...HTML, ...CODIGO, ...ESTILO];

/** Linhas que nao sao comentario (texto de comentario nao e tela nem codigo). */
const semComentario = (texto: string) =>
  texto
    .split('\n')
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join('\n');

interface Bloco {
  source: string;
  headers: Array<{ key: string; value: string }>;
}
const config = JSON.parse(ler('../vercel.json')) as { headers: Bloco[] };

describe('CA-02 urgencia exata no HTML', () => {
  it('o select de urgencia tem exatamente os 4 rotulos aprovados, na ordem', () => {
    const html = ler('../public/pedido.html');
    const rotulos = [...html.matchAll(/<option value="[^"]*">([^<]*)<\/option>/g)].map((m) => m[1]);
    expect(rotulos).toEqual(['Imediato', 'Nas próximas semanas', 'Próximo mês', 'Ainda não defini']);
  });
});

describe('CA-01 quatro campos e sem senha', () => {
  it('a pagina tem servico, local, urgencia, descricao, nome e e-mail, e nenhum campo de senha', () => {
    const html = ler('../public/pedido.html');
    for (const id of ['servico', 'endereco', 'urgencia', 'descricao', 'nome', 'email']) {
      expect(html, `campo ${id}`).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/type="password"/i);
  });
});

describe('CA-14 postura de HTML (CSP sem estilo nem script em linha)', () => {
  it.each(HTML)('%s: sem style=, sem script em linha, sem handler on*, sem form action', (caminho) => {
    const html = ler(caminho);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<form[^>]*\baction=/i);
  });

  it.each(TODOS)('%s: sem hexadecimal de cor fora de tokens', (caminho) => {
    expect(semComentario(ler(caminho))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(semComentario(ler(caminho))).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
  });

  it.each(TODOS)('%s: sem link ou chamada para outro host', (caminho) => {
    expect(semComentario(ler(caminho))).not.toMatch(/https?:\/\//i);
  });
});

describe('CA-11 sem coordenada, mapa ou ponto na tela', () => {
  it.each(TODOS)('%s: nenhuma palavra de coordenada ou mapa', (caminho) => {
    expect(semComentario(ler(caminho))).not.toMatch(/\b(lat|lon|latitude|longitude|mapa|mapbox|geom)\b/i);
  });
});

describe('CA-13 "publicado" so na frase aprovada', () => {
  // Lista fechada de trechos com "publicad" que NAO sao texto de tela (H-031, #44). Justificativa:
  // - 'publicado' como valor de status, somente em comparacao (===, !==) ou em objeto de status/tipo (status:, tipo:).
  //   Esse valor nao vai para a tela: a tela recebe a frase aprovada pelo mapa de textos.
  // - chave 'publicado' do mapa PUBLICACAO_TEXTOS (pedido-logica.js), so quando o valor da mesma linha e a frase aprovada
  //   'Pedido publicado.'. O valor e checado como frase aprovada, e PUBLICACAO_TEXTOS.publicado tem teste proprio.
  // Qualquer outro trecho (ex.: 'Publicado' em texto, ou 'publicado' passado a textContent) precisa conter frase aprovada.
  const CONTEXTO_DE_STATUS = /(===|!==|\bstatus\s*:|\btipo\s*:)\s*['"`]$/;
  const VALOR_APROVADO_DA_CHAVE = /^'Pedido publicado\.'/;

  function trechoNaoVisivel(trecho: string, antes: string, depois: string): boolean {
    const nucleo = trecho.replace(/[)}\];,:]*$/, '').trim();
    if (nucleo !== 'publicado') return false;
    return CONTEXTO_DE_STATUS.test(antes) || VALOR_APROVADO_DA_CHAVE.test(depois);
  }

  it('a excecao e estreita: so codigo de status em comparacao ou objeto, e a chave cujo valor e a frase aprovada', () => {
    expect(trechoNaoVisivel('publicado', "if (estado.tipo === '", '')).toBe(true);
    expect(trechoNaoVisivel('publicado', "return { tipo: '", '')).toBe(true);
    expect(trechoNaoVisivel('publicado:', '\n  ', "'Pedido publicado.',")).toBe(true);
    expect(trechoNaoVisivel('publicado:', '\n  ', "'Pedido publicado!',")).toBe(false);
    expect(trechoNaoVisivel('Publicado', '<p>', '')).toBe(false);
    expect(trechoNaoVisivel('Publicado', "if (x === '", '')).toBe(false);
    expect(trechoNaoVisivel('publicado', "el('x').textContent = '", '')).toBe(false);
  });

  it('no codigo e no HTML, todo texto visivel com "publicad" e uma frase aprovada', () => {
    const aprovados = ['Ainda não foi publicado.', 'Pedido publicado.', 'parecido publicado recentemente.'];
    for (const caminho of TODOS) {
      const fonte = semComentario(ler(caminho)).replace(/\$\{[^}]*\}/g, ' ');
      for (const m of fonte.matchAll(/[^'"`\n]*publicad[^'"`\n]*/gi)) {
        const trecho = m[0].trim();
        const fim = (m.index ?? 0) + m[0].length;
        if (trechoNaoVisivel(trecho, fonte.slice(0, m.index ?? 0), fonte.slice(fim))) continue;
        expect(aprovados.some((a) => trecho.includes(a)), `${caminho}: ${trecho}`).toBe(true);
      }
    }
  });
});

describe('regiao viva dos erros de publicacao e confirmacao (H-031, #44)', () => {
  it.each(['confirmar-erro', 'publicar-erro'])('%s anuncia o erro com role="alert"', (id) => {
    expect(ler('../public/pedido/revisao.html')).toMatch(new RegExp(`<p id="${id}"[^>]*\\brole="alert"`));
  });
});

describe('textos aprovados de §5.3 existem como constantes', () => {
  const logica = ler('../public/pedido-logica.js');
  it.each([
    'Carregando seu pedido…',
    'Não encontramos um pedido em andamento. Comece um novo pedido.',
    'Não foi possível salvar essa alteração. Tente de novo.',
    'Não foi possível confirmar agora. Seus dados continuam salvos. Tente de novo.',
    'Seu pedido mudou. Confira de novo antes de confirmar.',
    'Muitas tentativas. Aguarde um instante e tente de novo.',
    'Não encontramos esse serviço. Tente outra palavra.',
    'Pedido confirmado. Ainda não foi publicado.',
    'Não foi possível abrir seu pedido agora. Tente de novo.',
  ])('%s', (texto) => {
    expect(logica).toContain(texto);
  });
});

describe('CA-06 a confirmacao nao aparece como envio automatico', () => {
  it('o POST de confirmacao so existe em pedido-revisao.js, dentro de confirmar()', () => {
    const revisao = ler('../public/pedido-revisao.js');
    expect(revisao).toContain("'/api/v1/drafts/current/confirm'");
    expect(revisao.match(/criarControladorConfirmacao\(/g)?.length).toBe(1);
    expect(ler('../public/pedido.js')).not.toContain('/confirm');
  });
});

describe('CSP e cabecalhos de /pedido/revisao (vercel.json, §7.3)', () => {
  const bloco = config.headers.find((h) => h.source === '/pedido/revisao');
  const valor = (chave: string) => bloco?.headers.find((h) => h.key === chave)?.value;

  it('tem entrada propria com no-store, noindex e CSP restrita', () => {
    expect(bloco).toBeDefined();
    expect(valor('Cache-Control')).toBe('no-store');
    expect(valor('X-Robots-Tag')).toBe('noindex');
    const csp = valor('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('as entradas de /pedido, /pedido/(.*) e /fotos continuam presentes', () => {
    const origens = config.headers.map((h) => h.source);
    expect(origens).toEqual(expect.arrayContaining(['/pedido', '/pedido/(.*)', '/fotos', '/codigo']));
  });
});

// Foco por script (WCAG 2.4.3 / §5.4): todo elemento que o script foca precisa ser focavel.
// Elemento nativo (input, textarea, select, button, a[href]) dispensa atributo; qualquer outro
// (h1, p, h2, section...) precisa de tabindex="-1", que o torna focavel por script sem entrar na ordem do Tab.
// tabindex positivo e proibido (§5.4: a ordem do DOM e a ordem visual).
const PARES_FOCO = [
  { codigo: '../public/pedido.js', html: '../public/pedido.html' },
  { codigo: '../public/pedido-revisao.js', html: '../public/pedido/revisao.html' },
] as const;

/** Ids dos elementos que o script foca: el('x').focus(), getElementById('x').focus() e variaveis atribuidas a eles. */
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

describe('CA-14 foco por script tem alvo focavel', () => {
  it.each(PARES_FOCO)('$codigo: todo elemento focado por script tem tabindex="-1" ou e nativo', ({ codigo, html }) => {
    expect(focadosSemTabindex(ler(codigo), ler(html))).toEqual([]);
  });

  it('pedido.js foca resumo-erro, titulo-email, descricao e email (lista conhecida, sem vazio)', () => {
    expect(idsFocadosPorScript(ler('../public/pedido.js'))).toEqual(['descricao', 'email', 'resumo-erro', 'titulo-email']);
  });

  it('pedido-revisao.js foca titulo, confirmado e os alvos da publicacao (H-031)', () => {
    expect(idsFocadosPorScript(ler('../public/pedido-revisao.js')).sort()).toEqual(
      ['confirmado', 'duplicidade-revisar', 'e-endereco', 'publicar', 'titulo'],
    );
  });

  it('o teste falha se um elemento focado por script perder o tabindex (demonstracao com HTML sintetico)', () => {
    const codigo = "const doc = {}; const el = (id) => doc.getElementById(id); el('titulo').focus();";
    const semTabindex = '<h1 id="titulo">Revise</h1>';
    const comTabindex = '<h1 id="titulo" tabindex="-1">Revise</h1>';
    expect(focadosSemTabindex(codigo, semTabindex)).toEqual(['titulo (sem tabindex="-1": <h1 id="titulo">)']);
    expect(focadosSemTabindex(codigo, comTabindex)).toEqual([]);
  });
});
