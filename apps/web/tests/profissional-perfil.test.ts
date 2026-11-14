// Issue 56 (H-043) | Renderizador e CSS do perfil publico (docs/factory/143-DESENHO-H043.md, §8: T43-04, T43-05,
// T43-13, T43-14, T43-15, T43-17). Sem navegador: o script classico e avaliado sobre um DOM falso que registra
// cada elemento criado. Textos vem de @fastpro/domain; o script nao tem frase propria.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  construirTelaPerfil,
  montarPerfilPublico,
  PUBLIC_PROFILE_FORBIDDEN_PHRASES,
  PUBLIC_PROFILE_TEXTS,
  type EntradaTelaPerfil,
  type TelaPerfil,
} from '@fastpro/domain';

const LER = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8');
const FONTE_JS = LER('../public/profissional-perfil.js');
const FONTE_CSS = LER('../public/profissional-perfil.css');
const TOKENS_CSS = LER('../public/tokens.css');
const FONTES_DOMINIO = [
  LER('../../../packages/domain/src/public-profile/fields.ts'),
  LER('../../../packages/domain/src/public-profile/texts.ts'),
  LER('../../../packages/domain/src/public-profile/screen.ts'),
];
const ROTA_API = LER('../../api/src/public-profile-route.ts');

class NoFalso {
  readonly filhos: NoFalso[] = [];
  readonly atributos: Record<string, string> = {};
  textContent = '';
  className = '';
  disabled = false;
  constructor(
    readonly tag: string,
    readonly ownerDocument: DocFalso,
  ) {}
  appendChild(no: NoFalso): NoFalso {
    this.filhos.push(no);
    return no;
  }
  removeChild(no: NoFalso): NoFalso {
    this.filhos.splice(this.filhos.indexOf(no), 1);
    return no;
  }
  get firstChild(): NoFalso | undefined {
    return this.filhos[0];
  }
  setAttribute(nome: string, valor: string): void {
    this.atributos[nome] = valor;
  }
}

class DocFalso {
  criados: NoFalso[] = [];
  createElement(tag: string): NoFalso {
    const no = new NoFalso(tag, this);
    this.criados.push(no);
    return no;
  }
}

type Renderizador = (raiz: NoFalso, tela: TelaPerfil) => NoFalso;

/** Avalia o script classico e devolve a funcao, como o navegador faria. */
function carregarRenderizador(): Renderizador {
  return new Function(`${FONTE_JS}\nreturn renderizarPerfilPublico;`)() as Renderizador;
}

function renderizar(tela: TelaPerfil): { raiz: NoFalso; doc: DocFalso } {
  const doc = new DocFalso();
  const raiz = new NoFalso('div', doc);
  carregarRenderizador()(raiz, tela);
  return { raiz, doc };
}

function todosOsNos(no: NoFalso): NoFalso[] {
  return [no, ...no.filhos.flatMap(todosOsNos)];
}

function todosOsTextos(no: NoFalso): string {
  return [no.textContent, ...no.filhos.map(todosOsTextos)].join(' ');
}

function semComentarios(fonte: string): string {
  return fonte
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//') && !linha.trim().startsWith('/*') && !linha.trim().startsWith('*'))
    .join('\n');
}

function semComentariosCss(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '');
}

function luminancia(hex: string): number {
  const canais = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
}

function contraste(a: string, b: string): number {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (clara + 0.05) / (escura + 0.05);
}

/** Valor do primeiro token de cor (tema claro, primeiro bloco de tokens.css). */
function token(nome: string): string {
  const achado = new RegExp(`--${nome}:\\s*(#[0-9A-Fa-f]{6})`).exec(TOKENS_CSS);
  if (!achado) throw new Error(`token ausente: ${nome}`);
  return achado[1]!;
}

const grupo = [
  {
    groupName: 'Limpeza',
    items: [
      { name: 'Faxina residencial', modalities: ['online' as const, 'presencial' as const] },
      { name: 'Passadoria', modalities: ['presencial' as const] },
    ],
  },
];

const entradaPerfil: EntradaTelaPerfil = {
  tipo: 'perfil',
  perfil: { publicName: 'Ana Teste', services: grupo, rating: { average: null, count: 0 } },
};

const TELA_PERFIL = construirTelaPerfil(entradaPerfil);

describe('T43-13 marcacao do renderizador (Issue 56, H-043)', () => {
  it('um unico h1 com o nome, h2 por secao, listas semanticas e detalhes nativos do selo', () => {
    const { raiz } = renderizar(TELA_PERFIL);
    const nos = todosOsNos(raiz);
    expect(nos.filter((n) => n.tag === 'h1').map((n) => n.textContent)).toEqual(['Ana Teste']);
    expect(nos.filter((n) => n.tag === 'h2').map((n) => n.textContent)).toEqual([
      PUBLIC_PROFILE_TEXTS.rotuloSelo,
      PUBLIC_PROFILE_TEXTS.tituloServicos,
      PUBLIC_PROFILE_TEXTS.tituloReputacao,
    ]);
    expect(nos.filter((n) => n.tag === 'ul')).toHaveLength(1);
    expect(nos.filter((n) => n.tag === 'li')).toHaveLength(2);
    const detalhes = nos.find((n) => n.tag === 'details');
    expect(detalhes).toBeDefined();
    expect(nos.find((n) => n.tag === 'summary')?.textContent).toBe(PUBLIC_PROFILE_TEXTS.rotuloLimitesSelo);
  });

  it('regiao com aria-live="polite" e data-estado; sem botao, link, campo, imagem ou icone', () => {
    const { raiz, doc } = renderizar(TELA_PERFIL);
    expect(raiz.atributos['aria-live']).toBe('polite');
    expect(raiz.atributos['data-estado']).toBe('perfil');
    const tags = new Set(doc.criados.map((n) => n.tag));
    for (const proibida of ['button', 'a', 'input', 'img', 'svg', 'iframe', 'script', 'link', 'style']) {
      expect(tags.has(proibida), proibida).toBe(false);
    }
  });

  it('o script so cria elementos de texto e de estrutura permitidos', () => {
    const { doc } = renderizar(TELA_PERFIL);
    const permitidas = ['section', 'h1', 'h2', 'h3', 'details', 'summary', 'p', 'div', 'ul', 'li', 'span'];
    for (const no of doc.criados) expect(permitidas).toContain(no.tag);
  });

  it('contraste >= 4,5:1 nos pares de texto usados (tokens do tema claro)', () => {
    const pares: [string, string][] = [
      ['color-text-primary', 'color-surface'],
      ['color-text-secondary', 'color-surface'],
      ['color-text-primary', 'color-field'],
      ['color-text-secondary', 'color-field'],
      ['color-brand', 'color-surface'],
    ];
    for (const [texto, fundo] of pares) {
      expect(contraste(token(texto), token(fundo)), `${texto} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('T43-14 tokens sem valor literal (Issue 56, H-043)', () => {
  it('CSS sem hexadecimal nem funcao de cor (rgb, hsl, oklch)', () => {
    const css = semComentariosCss(FONTE_CSS);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\s*\(/i);
  });

  it('espacamentos, folgas e contornos so por var(--...), 0 ou auto', () => {
    const declaracoes = [...semComentariosCss(FONTE_CSS).matchAll(/(padding|margin|gap|outline-offset|font-weight)\s*:\s*([^;}]+)/g)];
    expect(declaracoes.length).toBeGreaterThan(5);
    for (const [, propriedade, valor] of declaracoes) {
      for (const parte of valor!.trim().split(/\s+/)) {
        expect(/^(var\(--[a-z0-9-]+\)|0|auto|inherit)$/.test(parte), `${propriedade}: ${valor}`).toBe(true);
      }
    }
  });

  it('script sem cor literal, sem estilo inline e sem valor de cor em string', () => {
    const codigo = semComentarios(FONTE_JS);
    expect(codigo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(codigo).not.toMatch(/\b(?:rgba?|hsla?)\s*\(/i);
    expect(codigo).not.toMatch(/\.style\b|style\s*=/);
  });
});

describe('T43-15 coluna fluida de 320 px a 1280 px (Issue 56, H-043)', () => {
  it('nenhuma largura fixa acima de 320 px e nenhum nowrap em texto', () => {
    const css = semComentariosCss(FONTE_CSS);
    for (const [, valor] of css.matchAll(/(?:^|[\s;{])(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      expect(Number(valor)).toBeLessThanOrEqual(320);
    }
    expect(css).not.toMatch(/white-space\s*:\s*nowrap/);
    expect(css).toMatch(/overflow-wrap\s*:\s*anywhere/);
    expect(css).toMatch(/max-width\s*:\s*100%/);
  });

  it('nao usa posicionamento fixo nem rolagem horizontal forcada', () => {
    const css = semComentariosCss(FONTE_CSS);
    expect(css).not.toMatch(/position\s*:\s*fixed/);
    expect(css).not.toMatch(/overflow-x\s*:\s*scroll/);
  });

  it('foco visivel explicito para teclado', () => {
    expect(FONTE_CSS).toMatch(/:focus-visible\s*\{[^}]*outline/);
  });
});

describe('T43-17 nenhuma chamada ou recurso externo (Issue 56, H-043)', () => {
  it('script, CSS, dominio e rota: sem URL http(s), sem Mapbox, sem import, fetch ou script externo', () => {
    const alvos = [FONTE_JS, FONTE_CSS, ...FONTES_DOMINIO, ROTA_API];
    for (const fonte of alvos) {
      expect(fonte).not.toMatch(/https?:\/\//i);
      expect(fonte.toLowerCase()).not.toContain('mapbox');
      expect(fonte).not.toMatch(/\bfetch\s*\(/);
      expect(fonte).not.toMatch(/XMLHttpRequest|navigator\.sendBeacon/);
      expect(fonte).not.toMatch(/@import|url\(\s*['"]?(?:https?:)?\/\//);
    }
    const js = semComentarios(FONTE_JS);
    expect(js).not.toMatch(/\bimport\s|\brequire\s*\(|<script|<link/);
  });
});

describe('T43-04 telefone, WhatsApp e e-mail ausentes no corpo e na tela (Issue 56, H-043)', () => {
  it('dado de contato que chegasse ao dominio nao aparece no view-model nem na tela', () => {
    const contaminado = montarPerfilPublico({
      publicName: 'Ana Teste',
      slug: 'ana-teste',
      verified: true,
      services: grupo,
      rating: { average: null, count: 0 },
      phone: '5511999990000',
      whatsapp: '5511988880000',
      email: 'marcador.contato@example.test',
    });
    expect(contaminado.ok).toBe(true);
    if (!contaminado.ok) return;
    const tela = construirTelaPerfil({ tipo: 'perfil', perfil: contaminado.perfil });
    const { raiz } = renderizar(tela);
    const marcadores = ['5511999990000', '5511988880000', 'marcador.contato', 'example.test', 'WhatsApp', 'whatsapp'];
    const corpo = JSON.stringify(contaminado.perfil) + JSON.stringify(tela) + todosOsTextos(raiz);
    for (const marcador of marcadores) expect(corpo.includes(marcador), marcador).toBe(false);
  });
});

describe('T43-05 texto do selo na tela (Issue 56, H-043)', () => {
  it('limitacao exata dentro do detalhe nativo, e nenhuma frase proibida na tela', () => {
    const { raiz } = renderizar(TELA_PERFIL);
    const nos = todosOsNos(raiz);
    const limitacao = nos.find((n) => n.className === 'perfil-selo-limitacao');
    expect(limitacao?.textContent).toBe(
      'Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo atesta apenas a conferência de identificação cadastral e não constitui garantia de qualidade, certificação técnica, recomendação ou cobertura securitária sobre os serviços prestados.',
    );
    const texto = todosOsTextos(raiz).toLowerCase();
    for (const frase of PUBLIC_PROFILE_FORBIDDEN_PHRASES) expect(texto.includes(frase.toLowerCase())).toBe(false);
  });

  it('nenhuma frase do perfil fica escrita no script: todas vem do dominio', () => {
    for (const frase of Object.values(PUBLIC_PROFILE_TEXTS)) expect(FONTE_JS).not.toContain(frase);
  });
});

describe('estados de tela (Issue 56, H-043)', () => {
  it('perfil sem servicos mostra o aviso e nenhuma lista', () => {
    const tela = construirTelaPerfil({
      tipo: 'perfil',
      perfil: { publicName: 'Ana Teste', services: [], rating: { average: null, count: 0 } },
    });
    const { raiz } = renderizar(tela);
    expect(raiz.atributos['data-estado']).toBe('perfil_sem_servicos');
    expect(todosOsNos(raiz).some((n) => n.tag === 'ul')).toBe(false);
    expect(todosOsTextos(raiz)).toContain(PUBLIC_PROFILE_TEXTS.servicosVazios);
  });

  it('nao encontrado, erro e carregando mostram so o aviso, sem titulo nem selo', () => {
    for (const entrada of [{ tipo: 'nao_encontrado' as const }, { tipo: 'erro' as const }, { tipo: 'carregando' as const }]) {
      const { raiz } = renderizar(construirTelaPerfil(entrada));
      expect(todosOsNos(raiz).some((n) => n.tag === 'h1' || n.tag === 'details')).toBe(false);
      expect(raiz.atributos['aria-live']).toBe('polite');
      expect(raiz.filhos).toHaveLength(1);
    }
    expect(todosOsTextos(renderizar(construirTelaPerfil({ tipo: 'nao_encontrado' })).raiz)).toContain(
      'Perfil não encontrado ou indisponível.',
    );
  });

  it('reputacao sem avaliacoes aparece como texto, e a troca de tela substitui o conteudo anterior', () => {
    const doc = new DocFalso();
    const raiz = new NoFalso('div', doc);
    const renderizador = carregarRenderizador();
    renderizador(raiz, TELA_PERFIL);
    expect(todosOsTextos(raiz)).toContain('Ainda sem avaliações');
    renderizador(raiz, construirTelaPerfil({ tipo: 'erro' }));
    expect(raiz.filhos).toHaveLength(1);
    expect(raiz.atributos['data-estado']).toBe('erro');
  });
});
