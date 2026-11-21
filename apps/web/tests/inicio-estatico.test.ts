// Issue #153 | Testes estaticos da pagina inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §6, §7 e §8, fatia 4).
// Leem os arquivos da raiz: cabecalhos de "/" em vercel.json, marcacao sem estilo ou script inline, CSS so com
// tokens, e nenhuma origem externa no navegador (sem Mapbox, sem provedor de mapa). Nenhuma rede.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

interface BlocoCabecalho {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

const vercel = JSON.parse(lerArquivo('../vercel.json')) as { headers: BlocoCabecalho[] };
const bloqueRaiz = vercel.headers.find((b) => b.source === '/');
const cabecalhosRaiz = Object.fromEntries((bloqueRaiz?.headers ?? []).map((h) => [h.key, h.value]));
const html = lerArquivo('../public/index.html');
const css = lerArquivo('../public/inicio.css');
const js = lerArquivo('../public/inicio.js');
const logica = lerArquivo('../public/inicio-logica.js');

describe('cabecalhos de / (A-4, mesma politica de /pedido)', () => {
  it('existe um bloco source "/" em vercel.json', () => {
    expect(bloqueRaiz).toBeDefined();
  });

  it('CSP restrita: nada alem de self, sem form-action, sem frame', () => {
    expect(cabecalhosRaiz['Content-Security-Policy']).toBe(
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it('sem cache, sem referrer, noindex e frame negado', () => {
    expect(cabecalhosRaiz['Cache-Control']).toBe('no-store');
    expect(cabecalhosRaiz['Referrer-Policy']).toBe('no-referrer');
    expect(cabecalhosRaiz['X-Robots-Tag']).toBe('noindex');
    expect(cabecalhosRaiz['X-Frame-Options']).toBe('DENY');
    expect(cabecalhosRaiz['X-Content-Type-Options']).toBe('nosniff');
  });

  it('a pagina tambem marca noindex na propria marcacao', () => {
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('marcacao sem estilo nem script inline (CSP, A-3)', () => {
  it('sem <style>, sem atributo style= e sem script sem src', () => {
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });

  it('carrega so os proprios arquivos da raiz', () => {
    expect(html).toContain('href="/tokens.css"');
    expect(html).toContain('href="/inicio.css"');
    expect(html).toContain('src="/inicio.js"');
  });

  it('noscript avisa para ativar o JavaScript (desenho §5.4)', () => {
    expect(html).toContain('<noscript><p class="inicio-erro">Ative o JavaScript para continuar.</p></noscript>');
  });

  it('o formulario nao tem action (form-action none)', () => {
    expect(html).toMatch(/<form id="formulario"[^>]*novalidate/);
    expect(html).not.toMatch(/<form[^>]*\saction=/);
  });
});

describe('CSS so com tokens (CA-W16, R-6)', () => {
  it('nao tem cor literal, nome de cor nem funcao de cor', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch)\s*\(/i);
    expect(css).not.toMatch(/:\s*(red|white|black|blue|green|gray|grey)\s*[;}]/i);
  });

  it('tamanhos e espacos vem de tokens; @media usa valor literal, nunca var()', () => {
    expect(css).toMatch(/var\(--space-/);
    const blocos = css.match(/@media[^{]*\{/g) ?? [];
    for (const bloco of blocos) expect(bloco).not.toContain('var(');
  });

  it('nao importa fontes externas nem usa url() para outra origem', () => {
    expect(css).not.toMatch(/@import|https?:\/\//);
  });
});

describe('navegador fala so com a propria origem (sem Mapbox nem provedor de mapa)', () => {
  it('o script e a logica nao tem URL absoluta nem nome de provedor de mapa', () => {
    for (const codigo of [js, logica]) {
      expect(codigo).not.toMatch(/https?:\/\//);
      expect(codigo).not.toMatch(/mapbox/i);
    }
  });

  it('imports do navegador sao so relativos (mesma origem)', () => {
    for (const codigo of [js, logica]) {
      for (const m of codigo.matchAll(/from\s+'([^']+)'/g)) {
        expect(m[1]?.startsWith('./')).toBe(true);
      }
    }
  });
});
