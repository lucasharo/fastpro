// #154 (desenho 176 §6, §7; CA-154-23, CA-154-24) | Varredura estatica dos arquivos novos e alterados das telas de entrada.
// A lista de arquivos cresce por fatia (S1 a S6). Arquivo ainda nao criado nao entra na varredura.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const RAIZ = new URL('../public/', import.meta.url);
const ARQUIVOS = [
  'entrada.css',
  'entrada-comum.js',
  'entrar.html',
  'entrar.js',
  'profissional/entrar.html',
  'profissional/cadastro.html',
  'profissional/verificar.html',
  'profissional/recuperar.html',
  'profissional/redefinir.html',
  'profissional-acesso.js',
  'profissional-link.js',
];

const existentes = ARQUIVOS.filter((a) => existsSync(new URL(a, RAIZ)));
const ler = (a: string) => readFileSync(new URL(a, RAIZ), 'utf8');

// Cor literal: hexadecimal de 3, 4, 6 ou 8 digitos, funcoes de cor e nomes de cor CSS usados como valor.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/;
const FUNCAO_COR = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\s*\(/i;
const NOME_COR =
  /:\s*[^;{}]*\b(?:white|black|red|green|blue|gray|grey|silver|navy|tomato|yellow|orange|purple|pink|brown|cyan|magenta)\b/i;

describe('entrada: arquivos novos (CA-154-23, tokens sem cor fixa)', () => {
  it('a fatia S1 entregou o CSS comum e o modulo comum', () => {
    expect(existentes).toEqual(expect.arrayContaining(['entrada.css', 'entrada-comum.js']));
  });

  it.each(existentes.filter((a) => a.endsWith('.css') || a.endsWith('.html')))(
    '%s nao tem cor literal, funcao de cor nem nome de cor',
    (arquivo) => {
      const texto = ler(arquivo);
      // Comentarios de cabecalho sao lidos como texto; a regra vale para o codigo de estilo.
      const semComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(HEX.test(semComentarios)).toBe(false);
      expect(FUNCAO_COR.test(semComentarios)).toBe(false);
      expect(NOME_COR.test(semComentarios)).toBe(false);
    },
  );

  it.each(existentes.filter((a) => a.endsWith('.css')))(
    '%s so usa cor por token (var(--...)) ou palavra neutra',
    (arquivo) => {
      const texto = ler(arquivo).replace(/\/\*[\s\S]*?\*\//g, '');
      const declaracoesDeCor = [...texto.matchAll(/(?:^|[;{\s])(color|background|border(?:-[a-z]+)?|outline)\s*:\s*([^;}]+)/gm)];
      for (const m of declaracoesDeCor) {
        const valor = m[2].trim();
        const neutro = /^(none|transparent|currentColor|inherit|0)\b/.test(valor);
        const tokenOuVazio = valor.includes('var(--') || valor.startsWith('1px') || valor.startsWith('3px');
        expect(neutro || tokenOuVazio, `${arquivo}: ${m[1]}: ${valor}`).toBe(true);
      }
    },
  );

  it.each(existentes.filter((a) => a.endsWith('.html')))('%s nao tem estilo em linha nem bloco de estilo', (arquivo) => {
    const texto = ler(arquivo);
    expect(texto).not.toMatch(/\sstyle\s*=/);
    expect(texto).not.toMatch(/<style[\s>]/i);
  });
});

describe('entrada: codigo sem armazenamento, sem console, sem injecao de HTML (CA-154-24; desenho 176 §7)', () => {
  const PROIBIDOS_JS: Array<[RegExp, string]> = [
    [/\binnerHTML\b/, 'innerHTML'],
    [/\bouterHTML\b/, 'outerHTML'],
    [/\binsertAdjacentHTML\b/, 'insertAdjacentHTML'],
    [/\bdocument\.write\b/, 'document.write'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\b/, 'new Function'],
    [/\bconsole\b/, 'console'],
    [/\blocalStorage\b/, 'localStorage'],
    [/\bsessionStorage\b/, 'sessionStorage'],
    [/\bdocument\.cookie\b/, 'document.cookie'],
    [/\bindexedDB\b/, 'indexedDB'],
  ];

  it.each(existentes.filter((a) => a.endsWith('.js') || a.endsWith('.html')))(
    '%s nao usa API proibida (innerHTML, console, storage, cookie)',
    (arquivo) => {
      const texto = ler(arquivo)
        // Comentarios podem citar o nome da API para explicar a regra; o codigo nao pode usar.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [re, nome] of PROIBIDOS_JS) {
        expect(re.test(texto), `${arquivo} usa ${nome}`).toBe(false);
      }
    },
  );

  it('o modulo comum nao usa rede fora do fetch passado por quem chama', () => {
    const texto = ler('entrada-comum.js');
    expect(texto).not.toMatch(/\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b|\bWebSocket\b/);
  });
});
