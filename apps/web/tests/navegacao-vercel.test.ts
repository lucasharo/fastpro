// #155 (desenho 178, S3 e §8; decisao 963) | Cabecalhos e redirecionamentos das telas novas, lidos do vercel.json.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface BlocoCabecalho {
  source: string;
  headers: { key: string; value: string }[];
}
interface Redirecionamento {
  source: string;
  destination: string;
  permanent: boolean;
}
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  headers: BlocoCabecalho[];
  redirects: Redirecionamento[];
};

const CSP_PADRAO =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function cabecalhosDe(origem: string): Record<string, string> {
  const bloco = vercel.headers.find((b) => b.source === origem);
  expect(bloco, origem).toBeDefined();
  return Object.fromEntries((bloco?.headers ?? []).map((h) => [h.key, h.value]));
}

describe('cabecalhos das telas novas (desenho 178 §8)', () => {
  for (const origem of ['/painel', '/profissional-(documentos|situacao|perfil)']) {
    it(`${origem}: sem cache, noindex, CSP padrao sem origem externa`, () => {
      const c = cabecalhosDe(origem);
      expect(c['Cache-Control']).toBe('no-store');
      expect(c['X-Robots-Tag']).toBe('noindex');
      expect(c['Referrer-Policy']).toBe('no-referrer');
      expect(c['Content-Security-Policy']).toBe(CSP_PADRAO);
      expect(c['X-Frame-Options']).toBe('DENY');
    });
  }
});

describe('redirecionamentos (decisao 963, AD-155-08)', () => {
  it('o documento duplicado redireciona para o oficial com 307 (permanent false)', () => {
    expect(vercel.redirects).toContainEqual({
      source: '/profissional-documento',
      destination: '/profissional-documentos',
      permanent: false
    });
  });

  it('o redirecionamento de /profissional da Issue 154 continua existindo e nao foi recriado', () => {
    const achados = vercel.redirects.filter((r) => r.source === '/profissional');
    expect(achados).toEqual([{ source: '/profissional', destination: '/profissional/entrar', permanent: false }]);
  });
});
