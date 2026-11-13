// E3 (Issue 141, CA-13 e CA-14, CA-18) | Teste estatico do arquivo publico de envio: gera o bundle com o script do
// proprio web (mesmo passo do build), mede o orcamento (20 KB sem gzip), confere a ordem dos scripts de /fotos,
// a exclusao do bundle do git, os scripts do package.json e a CSP de /fotos (sem afrouxar, decisao 149).
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lerRelativo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');
const SCRIPT_GERADOR = fileURLToPath(new URL('../scripts/build-fotos-envio.mjs', import.meta.url));
const BUNDLE = fileURLToPath(new URL('../public/fotos-envio.js', import.meta.url));
const ORCAMENTO_BYTES = 20 * 1024;

const FOTOS_HTML = lerRelativo('../public/fotos.html');
const PACOTE = JSON.parse(lerRelativo('../package.json')) as { scripts: Record<string, string> };
const VERCEL = JSON.parse(lerRelativo('../vercel.json')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

describe('E3 (Issue 141) arquivo publico do envio: estatico e orcamento', () => {
  let bundle = '';

  beforeAll(() => {
    // Gera de novo, como o build: o teste nunca le um bundle antigo.
    execFileSync(process.execPath, [SCRIPT_GERADOR], { stdio: 'pipe' });
    bundle = readFileSync(BUNDLE, 'utf8');
  });

  it('CA-13: o bundle gerado cabe no orcamento de 20 KB (sem gzip) e nao esta vazio', () => {
    const tamanho = statSync(BUNDLE).size;
    expect(tamanho).toBeGreaterThan(500);
    expect(tamanho).toBeLessThanOrEqual(ORCAMENTO_BYTES);
  });

  it('CA-13: o bundle e um IIFE sem import, require, eval, Function dinamico nem fonte externa', () => {
    expect(bundle).not.toMatch(/\bimport\s*\(|\bimport\s+[\w{*]|\brequire\(/);
    expect(bundle).not.toMatch(/\beval\(|new Function\(/);
    expect(bundle).not.toMatch(/https?:\/\//);
    expect(bundle).toContain('FastProFotosEnvio');
  });

  it('CA-18: o bundle e a pagina nao citam canal de foto por WhatsApp ou outro', () => {
    expect(bundle).not.toMatch(/wa\.me|whatsapp/i);
    expect(FOTOS_HTML).not.toMatch(/wa\.me|whatsapp/i);
  });

  it('CA-13: /fotos carrega fotos-envio.js antes de fotos.js, so scripts de mesma origem e nenhum script inline', () => {
    const srcs = [...FOTOS_HTML.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(2);
    for (const atributos of srcs) {
      expect(atributos).toMatch(/src="\/[^"]+"/);
      expect(atributos).not.toMatch(/type="module"|integrity=|crossorigin/);
    }
    const ordem = [...FOTOS_HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    expect(ordem).toEqual(['/fotos-envio.js', '/fotos.js']);
    expect(FOTOS_HTML.replace(/<script\b[^>]*><\/script>/g, '')).not.toMatch(/<script/);
  });

  it('CA-13: o arquivo gerado e ignorado pelo git, como tokens.css', () => {
    const gitignore = lerRelativo('../../../.gitignore');
    expect(gitignore).toContain('apps/web/public/fotos-envio.js');
    expect(gitignore).toContain('apps/web/public/tokens.css');
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('CA-13: build e test chamam o gerador (o bundle nunca fica defasado do codigo-fonte)', () => {
    expect(PACOTE.scripts['build']).toContain('build-fotos-envio.mjs');
    expect(PACOTE.scripts['test']).toContain('build-fotos-envio.mjs');
    expect(PACOTE.scripts['build:fotos-envio']).toBe('node scripts/build-fotos-envio.mjs');
    expect(PACOTE.scripts['build']!.indexOf('build-fotos-envio')).toBeLessThan(PACOTE.scripts['build']!.indexOf('tsc'));
  });

  it('CA-14: a CSP de /fotos continua sem afrouxar: script-src so self e connect-src sem curinga', () => {
    const entrada = VERCEL.headers.find((h) => h.source === '/fotos');
    expect(entrada).toBeDefined();
    const csp = entrada!.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    const diretiva = (nome: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(nome + ' ')) ?? '';
    expect(diretiva('script-src')).toBe("script-src 'self'");
    expect(diretiva('connect-src')).toMatch(/^connect-src 'self' https:\/\/[a-z0-9.-]+\.supabase\.co$/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|worker-src|blob:[^;]*connect/);
    expect(csp).toContain('img-src blob:');
  });
});
