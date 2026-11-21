// #154 (desenho 176, S7; CA-154-01, 13, 18, 20 a 24) | Telas de entrada no Chromium local, com axe e teclado.
// As paginas saem de apps/web/public por route do Playwright; a API e simulada por route (sem rede real, sem banco).
// Qualquer outra origem e abortada. Cobre so o caminho feliz e as provas de tela pedidas pelo desenho.
import { existsSync, statSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PUBLICO = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const BASE = 'http://fastpro.test';
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const TOKEN = 'tok-sintetico_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';

/** Telas novas e as ajustadas da #154. */
const TELAS = [
  '/entrar',
  '/acesso',
  '/codigo',
  '/profissional/entrar',
  '/profissional/cadastro',
  '/profissional/verificar',
  '/profissional/recuperar',
  '/profissional/redefinir',
];
const LARGURAS = [320, 768, 1200];
const TEMAS = ['light', 'dark'] as const;
/** Pendencia pre-existente (H-013, codigo.css, fora do escopo da #154): botao secundario sem contraste no tema escuro. */
const MOTIVO_CODIGO_ESCURO = 'pendencia pre-existente: botao secundario de codigo.css abaixo de 4,5:1 no tema escuro (H-013); a #154 nao altera codigo.css';

function arquivoPublico(caminho: string): string | undefined {
  const base = caminho === '/' ? '/index.html' : caminho;
  for (const candidato of [base, `${base}.html`, join(base, 'index.html')]) {
    const abs = resolve(PUBLICO, '.' + normalize(candidato));
    if (abs.startsWith(PUBLICO) && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return undefined;
}

interface Registro {
  api: string[];
  externas: string[];
}

/** Servidor de paginas e API simulada por route. A API responde 204 ao confirmar o e-mail e 202 aos demais pedidos. */
async function simular(page: Page): Promise<Registro> {
  const registro: Registro = { api: [], externas: [] };
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE) {
      registro.externas.push(req.url());
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      registro.api.push(`${req.method()} ${url.pathname}`);
      const confirma = url.pathname.endsWith('/verification/confirm') || url.pathname.endsWith('/password/reset');
      await route.fulfill({ status: confirma ? 204 : 202, body: '' });
      return;
    }
    const abs = arquivoPublico(url.pathname);
    if (!abs) {
      await route.fulfill({ status: 404, body: 'nao encontrado' });
      return;
    }
    await route.fulfill({ path: abs, contentType: TIPOS[abs.slice(abs.lastIndexOf('.'))] ?? 'application/octet-stream' });
  });
  return registro;
}

/** Identificador do elemento com foco (id ou texto), para comparar a ordem do Tab. */
async function focoAtual(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return '';
    return el.id || (el.textContent ?? '').trim() || el.tagName.toLowerCase();
  });
}

test.describe('telas de entrada (S7)', () => {
  for (const largura of LARGURAS) {
    for (const tema of TEMAS) {
      for (const tela of TELAS) {
        test(`axe WCAG 2.2 AA sem violacoes em ${tela} a ${largura} px, tema ${tema}`, async ({ page }) => {
          test.fixme(tela === '/codigo' && tema === 'dark', MOTIVO_CODIGO_ESCURO);
          await page.setViewportSize({ width: largura, height: 800 });
          await page.emulateMedia({ colorScheme: tema });
          await simular(page);
          await page.goto(`${BASE}${tela}`);
          const resultado = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze();
          expect(resultado.violations.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
        });
      }
    }
  }

  test('nenhuma tela rola na horizontal em 320 px (1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await simular(page);
    for (const tela of TELAS) {
      await page.goto(`${BASE}${tela}`);
      const larguraDoConteudo = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(larguraDoConteudo, tela).toBeLessThanOrEqual(320);
    }
  });

  test('ordem do Tab em /profissional/entrar: e-mail, senha, mostrar senha, entrar (CA-154-20)', async ({ page }) => {
    await simular(page);
    await page.goto(`${BASE}/profissional/entrar`);
    const ordem: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      ordem.push(await focoAtual(page));
    }
    expect(ordem).toEqual(['email', 'senha', 'alternar-senha', 'enviar']);
  });

  test('o link "Entrar" da inicial e alcancavel pelo teclado e leva a /entrar (CA-154-01)', async ({ page }) => {
    await simular(page);
    await page.goto(`${BASE}/`);
    const link = page.locator('a[href="/entrar"]', { hasText: 'Entrar' });
    await expect(link).toHaveCount(1);
    let alcancado = false;
    for (let i = 0; i < 25 && !alcancado; i += 1) {
      await page.keyboard.press('Tab');
      alcancado = (await focoAtual(page)) === 'Entrar';
    }
    expect(alcancado).toBe(true);
  });

  test('links entre as telas levam aos caminhos certos (CA-154-13)', async ({ page }) => {
    await simular(page);
    const esperados: Array<[string, string, string]> = [
      ['/entrar', 'Digitar o código', '/codigo'],
      ['/entrar', 'Sou profissional', '/profissional/entrar'],
      ['/profissional/entrar', 'Esqueci minha senha', '/profissional/recuperar'],
      ['/profissional/entrar', 'Criar conta', '/profissional/cadastro'],
      ['/profissional/entrar', 'Sou cliente', '/entrar'],
      ['/profissional/cadastro', 'Já tenho conta', '/profissional/entrar'],
      ['/profissional/recuperar', 'Voltar para entrar', '/profissional/entrar'],
    ];
    for (const [tela, texto, destino] of esperados) {
      await page.goto(`${BASE}${tela}`);
      await expect(page.getByRole('link', { name: texto })).toHaveAttribute('href', destino);
    }
  });

  test('nenhuma das telas mostra login social "Google" ou "Apple" (CA-154-18)', async ({ page }) => {
    await simular(page);
    for (const tela of TELAS) {
      await page.goto(`${BASE}${tela}`);
      const texto = await page.evaluate(() => document.body.innerText);
      expect(texto, tela).not.toMatch(/Google|Apple/i);
    }
  });

  test('confirmar o e-mail: a URL perde o token e nada vai para armazenamento (CA-154-24)', async ({ page }) => {
    const registro = await simular(page);
    await page.goto(`${BASE}/profissional/verificar#t=${TOKEN}`);
    await expect(page).toHaveURL(`${BASE}/profissional/verificar`);
    await expect(page.locator('#confirmar')).toBeEnabled({ timeout: 5000 });
    await page.locator('#confirmar').click();
    await expect(page.locator('#aviso')).toContainText('E-mail confirmado');
    expect(page.url()).not.toContain(TOKEN);
    expect(page.url()).not.toContain('#');
    const armazenamento = await page.evaluate(() => ({
      local: window.localStorage.length,
      sessao: window.sessionStorage.length,
      cookie: document.cookie,
    }));
    expect(armazenamento).toEqual({ local: 0, sessao: 0, cookie: '' });
    expect(registro.api).toEqual(['POST /api/v1/auth/professional/verification/confirm']);
    expect(registro.externas).toEqual([]);
  });
});
