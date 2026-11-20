// Issue 152 (WF-04, bugfix) | Regressao do stub de node:crypto do bundle do envio de foto.
// (a) CA-05: todo nome que o dominio (packages/domain/dist) importa de node:crypto precisa estar no stub; o teste lista
//     TODOS os faltantes de uma vez. Negativos provam que a regra falha de verdade.
// (b) CA-03: cada funcao do stub lanca Error "node:crypto indisponivel no navegador" e nao retorna valor.
// (c) CA-04: o bundle gerado nao contem o codigo do cursor de descoberta (literais de cifra e rotulo do cursor).
// O teste le o dist ja construido e falha (nunca pula) se ele faltar.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { NOMES_STUB_NODE_CRYPTO, conteudoStubNodeCrypto } from '../scripts/stub-node-crypto.mjs';

const DIST = fileURLToPath(new URL('../../../packages/domain/dist', import.meta.url));
const SCRIPT_GERADOR = fileURLToPath(new URL('../scripts/build-fotos-envio.mjs', import.meta.url));
const BUNDLE = fileURLToPath(new URL('../public/fotos-envio.js', import.meta.url));
const MENSAGEM_STUB = 'node:crypto indisponivel no navegador';
const LITERAIS_CURSOR = ['cur1|', 'fastpro-discovery-cursor-v1', 'cursor-aead', 'aes-256-gcm'];

// Imports estaticos com chaves de node:crypto (o unico formato que o stub cobre).
const REGEX_IMPORT_NAMED = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])node:crypto\2/g;
// Qualquer literal de node:crypto ou crypto, para achar formas que o stub nao cobre (namespace, default, bare, require).
const REGEX_LITERAL_CRYPTO = /(['"])(?:node:)?crypto\1/g;

function removerComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function listarJs(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) achados.push(...listarJs(caminho));
    else if (entrada.name.endsWith('.js')) achados.push(caminho);
  }
  return achados;
}

type Varredura = {
  nomes: Map<string, string[]>; // nome importado -> arquivos que o importam
  naoSuportados: string[]; // "arquivo: trecho" de formas que a regra nao entende
};

function importsNodeCrypto(pasta: string): Varredura {
  const nomes = new Map<string, string[]>();
  const naoSuportados: string[] = [];
  for (const arquivo of listarJs(pasta)) {
    const codigo = removerComentarios(readFileSync(arquivo, 'utf8'));
    const relativo = arquivo.slice(pasta.length + 1).split('\\').join('/');
    let suportados = 0;
    for (const m of codigo.matchAll(REGEX_IMPORT_NAMED)) {
      suportados += 1;
      for (const especificador of m[1].split(',')) {
        const limpo = especificador.trim().replace(/^type\s+/, '');
        if (!limpo) continue;
        const nomeImportado = limpo.split(/\s+as\s+/)[0].trim();
        const lista = nomes.get(nomeImportado) ?? [];
        lista.push(relativo);
        nomes.set(nomeImportado, lista);
      }
    }
    // Cada import com chaves cobre exatamente um literal; o excedente e forma nao suportada.
    const literais = [...codigo.matchAll(REGEX_LITERAL_CRYPTO)];
    if (literais.length > suportados) {
      naoSuportados.push(`${relativo}: ${literais.length - suportados} import(s) de node:crypto em forma nao suportada (namespace, default, bare 'crypto', import() ou require)`);
    }
  }
  return { nomes, naoSuportados };
}

function faltantes(nomes: Map<string, string[]>): Array<{ nome: string; arquivos: string[] }> {
  return [...nomes.keys()]
    .filter((nome) => !(NOMES_STUB_NODE_CRYPTO as readonly string[]).includes(nome))
    .sort()
    .map((nome) => ({ nome, arquivos: nomes.get(nome) ?? [] }));
}

function mensagemFalha(lista: Array<{ nome: string; arquivos: string[] }>): string {
  return lista.map((f) => `${f.nome} (importado por ${f.arquivos.join(', ')})`).join('; ');
}

describe('Issue 152 CA-05: stub de node:crypto cobre todos os imports do dominio', () => {
  if (!existsSync(join(DIST, 'index.js'))) {
    it('dist de @fastpro/domain existe', () => {
      throw new Error('dist de @fastpro/domain ausente; rode antes: corepack pnpm --filter @fastpro/domain build');
    });
    return;
  }

  it('o stub exporta todo nome que o dominio importa de node:crypto (lista completa de faltantes)', () => {
    const varredura = importsNodeCrypto(DIST);
    // Formas nao suportadas exigem revisao manual (o stub nao cobre namespace, default nem bare 'crypto').
    expect(varredura.naoSuportados).toEqual([]);
    // Sanidade: a regex achou os imports conhecidos (nao esta vazia por erro de parse).
    expect([...varredura.nomes.keys()]).toEqual(expect.arrayContaining(['createHash', 'randomBytes']));
    // Lista completa: na falha, a comparacao mostra todos os nomes faltantes com o arquivo de origem.
    const falta = faltantes(varredura.nomes);
    expect(mensagemFalha(falta)).toBe('');
  });

  it('negativo: um nome que o stub nao exporta e apontado com o arquivo de origem', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'fastpro-stub-crypto-'));
    try {
      writeFileSync(join(pasta, 'a.js'), "import { createHash, naoExisteNoStub } from 'node:crypto';\nexport const x = createHash;\n");
      const falta = faltantes(importsNodeCrypto(pasta).nomes);
      expect(falta.map((f) => f.nome)).toEqual(['naoExisteNoStub']);
      expect(falta[0].arquivos).toEqual(['a.js']);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('negativo: lista multilinha com nome faltante e detectada', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'fastpro-stub-crypto-'));
    try {
      mkdirSync(join(pasta, 'sub'));
      writeFileSync(
        join(pasta, 'sub', 'b.js'),
        "import {\n  createHash,\n  outroFaltante as alias,\n} from 'node:crypto';\n",
      );
      const falta = faltantes(importsNodeCrypto(pasta).nomes);
      expect(falta.map((f) => f.nome)).toEqual(['outroFaltante']);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('negativo: namespace, bare crypto e require sao sinalizados como forma nao suportada', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'fastpro-stub-crypto-'));
    try {
      writeFileSync(join(pasta, 'c.js'), "import * as c from 'node:crypto';\nexport const y = c;\n");
      writeFileSync(join(pasta, 'd.js'), "import { randomBytes } from 'crypto';\nexport const z = randomBytes;\n");
      writeFileSync(join(pasta, 'e.js'), "const k = require('node:crypto');\nexport const w = k;\n");
      const { naoSuportados } = importsNodeCrypto(pasta);
      expect(naoSuportados.map((linha) => linha.split(':')[0]).sort()).toEqual(['c.js', 'd.js', 'e.js']);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});

describe('Issue 152 CA-03: funcoes do stub falham no navegador', () => {
  it('cada nome do stub e funcao que lanca Error com a mensagem fixa e nao retorna valor', async () => {
    const { code } = await transform(conteudoStubNodeCrypto(), { format: 'cjs', loader: 'js' });
    const modulo = { exports: {} as Record<string, unknown> };
    new Function('exports', 'module', code)(modulo.exports, modulo);
    const exportados = Object.keys(modulo.exports).sort();
    expect(exportados).toEqual([...NOMES_STUB_NODE_CRYPTO].sort());
    for (const nome of NOMES_STUB_NODE_CRYPTO) {
      const fn = modulo.exports[nome];
      expect(typeof fn, `${nome} deve ser funcao`).toBe('function');
      let erro: unknown = null;
      let retorno: unknown = undefined;
      try {
        retorno = (fn as () => unknown)();
      } catch (e) {
        erro = e;
      }
      expect(erro, `${nome} deve lancar`).toBeInstanceOf(Error);
      expect((erro as Error).message).toBe(MENSAGEM_STUB);
      expect(retorno, `${nome} nao deve retornar valor`).toBeUndefined();
    }
  });
});

describe('Issue 152 CA-04: bundle do navegador sem o codigo do cursor', () => {
  beforeAll(() => {
    // Gera de novo, como o build: o teste nunca le um bundle antigo.
    execFileSync(process.execPath, [SCRIPT_GERADOR], { stdio: 'pipe' });
  });

  it('o bundle gerado existe e nao contem os literais do cursor', () => {
    expect(statSync(BUNDLE).size).toBeGreaterThan(0);
    const bundle = readFileSync(BUNDLE, 'utf8');
    const achados = LITERAIS_CURSOR.filter((literal) => bundle.includes(literal));
    expect(achados).toEqual([]);
  });
});
