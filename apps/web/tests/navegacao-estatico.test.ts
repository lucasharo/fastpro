// #155 (desenho 178, S2 e S3; CA-NAV-02, 09, 10, 14, 15) | Estatico: blocos comuns, rotas, links e texto proibido.
// Le apenas os arquivos de apps/web/public e a tabela ROTAS. Sem rede e sem navegador.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { ROTAS, SEM_NAVEGACAO } from '../public/navegacao-logica.js';
import { blocos } from '../scripts/navegacao-blocos.mjs';

const PUBLICO = fileURLToPath(new URL('../public/', import.meta.url));
const WEB = fileURLToPath(new URL('../', import.meta.url));
const lerPublico = (arquivo: string) => readFileSync(join(PUBLICO, arquivo), 'utf8');

function listarHtml(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = join(dir, e.name);
    if (e.isDirectory()) return listarHtml(abs);
    return e.name.endsWith('.html') ? [relative(PUBLICO, abs).split(sep).join('/')] : [];
  });
}

const bloco = (html: string, nome: string): string | undefined =>
  html.match(new RegExp(`<!-- fp:${nome} -->([\\s\\S]*?)<!-- /fp:${nome} -->`))?.[1];
const semAtual = (s: string) => s.replace(/ aria-current="page"/g, '');
const contaAtual = (s: string | undefined) => (s ?? '').match(/aria-current="page"/g)?.length ?? 0;

const paginas = ROTAS.map((r) => ({ ...r, html: lerPublico(r.arquivo) }));

describe('rotas e arquivos (AD-155-02; CA-NAV-09, CA-NAV-15)', () => {
  it('todo .html de public esta em ROTAS ou em SEM_NAVEGACAO', () => {
    const naTabela = new Set<string>([...ROTAS.map((r) => r.arquivo), ...SEM_NAVEGACAO]);
    expect(listarHtml(PUBLICO).filter((a) => !naTabela.has(a))).toEqual([]);
  });

  it('todo arquivo de ROTAS existe em public', () => {
    expect(ROTAS.filter((r) => !existsSync(join(PUBLICO, r.arquivo))).map((r) => r.arquivo)).toEqual([]);
  });

  it('links e recursos internos apontam para arquivo ou rota existente (sem link quebrado)', () => {
    const vercel = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8')) as { redirects: { source: string }[] };
    const redirecionados = new Set(vercel.redirects.map((r) => r.source));
    const quebrados: string[] = [];
    for (const arquivo of listarHtml(PUBLICO)) {
      const html = lerPublico(arquivo);
      for (const m of html.matchAll(/(?:href|src|action)="(\/[^"]*)"/g)) {
        const caminho = m[1].split('#')[0].split('?')[0];
        if (caminho === '/' || caminho === '') continue;
        const candidatos = [caminho, `${caminho}.html`, `${caminho}/index.html`];
        const existe =
          redirecionados.has(caminho) ||
          candidatos.some((c) => existsSync(join(PUBLICO, c)));
        if (!existe) quebrados.push(`${arquivo} -> ${m[1]}`);
      }
    }
    expect(quebrados).toEqual([]);
  });

  it('nenhum link para area administrativa (RN-NAV-06)', () => {
    const achados = listarHtml(PUBLICO).flatMap((a) =>
      [...lerPublico(a).matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => /\/admin/i.test(h))
    );
    expect(achados).toEqual([]);
  });
});

describe('blocos comuns (AD-155-01; CA-NAV-02)', () => {
  it('cabecalho e rodape identicos em todas as paginas depois de tirar aria-current', () => {
    const cabecalhos = new Set(paginas.map((p) => semAtual(bloco(p.html, 'cabecalho') ?? '<ausente>')));
    const rodapes = new Set(paginas.map((p) => bloco(p.html, 'rodape') ?? '<ausente>'));
    expect(cabecalhos.size).toBe(1);
    expect(rodapes.size).toBe(1);
  });

  it('exatamente um aria-current no cabecalho quando a rota tem item; nenhum quando nao tem', () => {
    for (const p of paginas) {
      expect(contaAtual(bloco(p.html, 'cabecalho')), p.rota).toBe(p.item ? 1 : 0);
    }
  });

  it('subnavegacao so nas telas de passo do profissional, com um aria-current', () => {
    for (const p of paginas) {
      const sub = bloco(p.html, 'subnav');
      if (p.subitem) {
        expect(sub, p.rota).toBeDefined();
        expect(contaAtual(sub), p.rota).toBe(1);
      } else {
        expect(sub, p.rota).toBeUndefined();
      }
    }
  });

  it('cada pagina tem o blocos de cabecalho e rodape', () => {
    for (const p of paginas) {
      expect(bloco(p.html, 'cabecalho'), p.rota).toBeDefined();
      expect(bloco(p.html, 'rodape'), p.rota).toBeDefined();
    }
  });

  it('titulo no padrao FastPro - <tela>', () => {
    for (const p of paginas) {
      expect(p.html, p.rota).toMatch(/<title>FastPro - [^<]+<\/title>/);
    }
  });

  it('o alvo do "Pular para o conteudo" existe: main com id conteudo ou sentinela dentro do main', () => {
    for (const p of paginas) {
      const ok = /<main[^>]*\sid="conteudo"/.test(p.html) || p.html.includes('<span id="conteudo"');
      expect(ok, p.rota).toBe(true);
    }
  });

  it('navegacao.css vem depois de tokens.css em todas as paginas', () => {
    for (const p of paginas) {
      const t = p.html.indexOf('href="/tokens.css"');
      const n = p.html.indexOf('href="/navegacao.css"');
      expect(t, p.rota).toBeGreaterThanOrEqual(0);
      expect(n, p.rota).toBeGreaterThan(t);
    }
  });

  it('sincronizacao sem diferenca: sincronizar-navegacao --check sai com codigo 0', () => {
    expect(() =>
      execFileSync(process.execPath, [join(WEB, 'scripts', 'sincronizar-navegacao.mjs'), '--check'], { stdio: 'pipe' })
    ).not.toThrow();
  });
});

describe('CSP e marcacao (desenho 178 §8; CA-NAV-14)', () => {
  it('nenhuma pagina de public tem style=, <style> ou script inline', () => {
    for (const arquivo of listarHtml(PUBLICO)) {
      const html = lerPublico(arquivo);
      expect(html, arquivo).not.toMatch(/\sstyle=/);
      expect(html, arquivo).not.toMatch(/<style/i);
      expect(html, arquivo).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    }
  });
});

describe('texto da navegacao (CA-NAV-10; RN-NAV-05, RN-NAV-11)', () => {
  it('nenhum contador, vaga, onda, termos ou aviso "apenas conecta" nos blocos', () => {
    const textos = Object.keys(Object.fromEntries(ROTAS.map((r) => [r.rota, 1])))
      .map((rota) => {
        const b = blocos(rota);
        return [...b.cabecalho, ...(b.subnav ?? []), ...b.rodape].join('\n');
      })
      .join('\n');
    expect(textos).not.toMatch(/apenas conecta|vagas?\b|\bonda\b|contador|termos/i);
  });
});
