// #154 (desenho 176 §4.3, §4.1 e AD-154-09) | Cabecalhos e redirecionamento das rotas de entrada em vercel.json.
// Nao chama o Vercel: confere a configuracao versionada. Mesma regra dos cabecalhos de /acesso e /pedido.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface Cabecalho {
  key: string;
  value: string;
}
interface Regra {
  source: string;
  headers: Cabecalho[];
}
interface Redirecionamento {
  source: string;
  destination: string;
  permanent?: boolean;
}
interface Configuracao {
  cleanUrls?: boolean;
  redirects?: Redirecionamento[];
  headers: Regra[];
}

const configuracao: Configuracao = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);

const ROTAS_ENTRADA = [
  '/entrar',
  '/profissional/entrar',
  '/profissional/cadastro',
  '/profissional/verificar',
  '/profissional/recuperar',
  '/profissional/redefinir',
];

/** Cabecalhos que valem para a rota: todas as regras cuja origem (regex do Vercel) casa com o caminho. */
function cabecalhosDe(rota: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const regra of configuracao.headers) {
    const re = new RegExp('^' + regra.source + '$');
    if (!re.test(rota)) continue;
    for (const h of regra.headers) mapa.set(h.key, h.value);
  }
  return mapa;
}

describe('vercel.json: rotas de entrada (CA-154-22, 24; desenho 176 §4.3)', () => {
  it.each(ROTAS_ENTRADA)('%s nao guarda cache e nao vaza referrer', (rota) => {
    const h = cabecalhosDe(rota);
    expect(h.get('Cache-Control')).toBe('no-store');
    expect(h.get('Referrer-Policy')).toBe('no-referrer');
    expect(h.get('X-Robots-Tag')).toBe('noindex');
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it.each(ROTAS_ENTRADA)('%s tem CSP sem script inline, sem envio para fora e sem formulario externo', (rota) => {
    const csp = cabecalhosDe(rota).get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it.each(ROTAS_ENTRADA)('%s nao usa imagem nem fonte externas', (rota) => {
    const csp = cabecalhosDe(rota).get('Content-Security-Policy') ?? '';
    expect(csp).not.toMatch(/img-src|font-src|https?:/);
  });

  it.each(ROTAS_ENTRADA)('%s impede abertura em quadro', (rota) => {
    expect(cabecalhosDe(rota).get('X-Frame-Options')).toBe('DENY');
  });

  it('rotas de entrada nao herdam regra de outra tela com CSP mais ampla', () => {
    for (const rota of ROTAS_ENTRADA) {
      const csp = cabecalhosDe(rota).get('Content-Security-Policy') ?? '';
      expect(csp).not.toMatch(/supabase\.co/);
    }
  });
});

describe('vercel.json: redirecionamento de /profissional (AD-154-09)', () => {
  it('redireciona /profissional para /profissional/entrar com 307 (temporario)', () => {
    const regra = (configuracao.redirects ?? []).find((r) => r.source === '/profissional');
    expect(regra).toBeDefined();
    expect(regra?.destination).toBe('/profissional/entrar');
    expect(regra?.permanent).toBe(false);
  });

  it('mantem cleanUrls ligado (serve /entrar como entrar.html)', () => {
    expect(configuracao.cleanUrls).toBe(true);
  });
});
