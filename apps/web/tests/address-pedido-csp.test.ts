// H-020 | CSP das paginas de pedido (docs/factory/56-DESENHO-H020.md, §2.4, §6 teste 11).
// Leitura estatica de apps/web/vercel.json e do componente. Sem rede. As paginas /pedido ainda nao
// existem (ligam em H-025 e H-036); a politica fica reservada e este teste a verifica.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

interface Bloco {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

const config = JSON.parse(lerArquivo('../vercel.json')) as { headers: Bloco[] };

function cspDe(source: string): string | undefined {
  const bloco = config.headers.find((h) => h.source === source);
  return bloco?.headers.find((h) => h.key === 'Content-Security-Policy')?.value;
}

describe('T-H020-CSP politica das paginas de pedido (CA-14, §2.4)', () => {
  const origens = ['/acesso', '/pedido', '/pedido/(.*)'];

  it.each(origens)('%s tem CSP com connect-src apenas self e default-src none', (source) => {
    const csp = cspDe(source);
    expect(csp, `CSP de ${source}`).toBeDefined();
    const diretivas = Object.fromEntries(
      csp!
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [nome, ...valores] = d.split(/\s+/);
          return [nome, valores];
        }),
    ) as Record<string, string[]>;
    expect(diretivas['connect-src']).toEqual(["'self'"]);
    expect(diretivas['default-src']).toEqual(["'none'"]);
    expect(diretivas['script-src']).toEqual(["'self'"]);
  });

  it.each(origens)('%s nao libera nenhuma origem externa, coringa ou dominio do Mapbox', (source) => {
    const csp = cspDe(source) ?? '';
    expect(csp).not.toMatch(/https?:|\*|wss?:|mapbox/i);
  });

  it('a pagina de pedido tem as mesmas cabecalhos de seguranca de /acesso', () => {
    const acesso = config.headers.find((h) => h.source === '/acesso')!.headers;
    const pedido = config.headers.find((h) => h.source === '/pedido')!.headers;
    expect(pedido).toEqual(acesso);
  });
});

describe('T-H020-CSP componente sem origem externa (CA-14)', () => {
  it('o componente so usa o endereco relativo da propria API', () => {
    const codigo = lerArquivo('../public/address-field.js');
    expect(codigo).not.toMatch(/https?:\/\//);
    expect(codigo).not.toMatch(/mapbox/i);
    expect(codigo).toContain("ADDRESS_ENDPOINT = '/api/v1/geo/address-suggest'");
  });

  it('o componente nao usa armazenamento persistente do navegador', () => {
    const codigo = lerArquivo('../public/address-field.js');
    expect(codigo).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/);
  });
});
