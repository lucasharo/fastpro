// #155 (desenho 178, S4 e S7; decisao 960 B) | Fluxo feliz do cliente no Chromium local: inicial -> /pedido -> /fotos
// -> /pedido/revisao, com Voltar e Continuar, axe WCAG 2.2 AA em cada tela e teclado. A API e simulada por route
// (sem rede real, sem banco); as paginas saem de apps/web/public. Qualquer origem externa e abortada e registrada.
// Prova com API real fica pendente da #156 (declarado na entrega 179).
import { existsSync, statSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PUBLICO = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
// Origem localhost (contexto seguro): o pedido gera a chave de idempotencia com crypto.randomUUID, que o navegador so expoe em contexto seguro.
const BASE = 'http://localhost';
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

type Resposta = { status: number; corpo?: unknown };
type Mapa = Record<string, Resposta | (() => Resposta)>;
interface Registro {
  api: string[];
  externas: string[];
}

const RASCUNHO = {
  service_id: 'svc-1',
  service: { name: 'Eletricista' },
  address_text: 'Rua das Flores, 10',
  urgency: 'imediato',
  description: 'Tomada queimada na cozinha',
  first_name: 'Ana',
  email: 'ana@exemplo.test',
};
const VISAO = { ...RASCUNHO, id: 'd-1', content_rev: 3, confirmed_at: null };
const CONFIRMADO = { status: 'confirmado', confirmed_at: '2026-11-21T12:00:00Z', content_rev: 3 };

function arquivoPublico(caminho: string): string | undefined {
  const base = caminho === '/' ? '/index.html' : caminho;
  for (const candidato of [base, `${base}.html`, join(base, 'index.html')]) {
    const abs = resolve(PUBLICO, '.' + normalize(candidato));
    if (abs.startsWith(PUBLICO) && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return undefined;
}

/** Serve as paginas de public e simula a API por chave "METODO /caminho". Resposta sem mapa = 404. */
async function servir(page: Page, mapa: Mapa): Promise<Registro> {
  const reg: Registro = { api: [], externas: [] };
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE) {
      reg.externas.push(req.url());
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chave = `${req.method()} ${url.pathname}`;
      reg.api.push(chave);
      const entrada = mapa[chave];
      const r: Resposta = entrada === undefined ? { status: 404, corpo: { code: 'nao_encontrado' } } : typeof entrada === 'function' ? entrada() : entrada;
      await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.corpo ?? {}) });
      return;
    }
    const abs = arquivoPublico(url.pathname);
    if (!abs) {
      await route.fulfill({ status: 404, path: resolve(PUBLICO, '404.html'), contentType: TIPOS['.html'] });
      return;
    }
    await route.fulfill({ path: abs, contentType: TIPOS[abs.slice(abs.lastIndexOf('.'))] ?? 'application/octet-stream' });
  });
  return reg;
}

async function semViolacoes(page: Page, quando: string) {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(resultado.violations.map((v) => `${v.id} (${v.impact})`), quando).toEqual([]);
}

test.describe('fluxo do cliente (S4 e S7, caminho feliz)', () => {
  test('inicial -> pedido -> fotos -> revisao, com Voltar e Continuar sem perder o pedido', async ({ page }) => {
    let criado = false;
    const reg = await servir(page, {
      'GET /api/v1/drafts/current': () => (criado ? { status: 200, corpo: RASCUNHO } : { status: 404, corpo: { code: 'nao_encontrado' } }),
      'POST /api/v1/drafts': () => {
        criado = true;
        return { status: 201, corpo: { id: 'd-1' } };
      },
      'POST /api/v1/catalog/service-search': { status: 200, corpo: { status: 'ok', items: [{ service_id: 'svc-1', service_name: 'Eletricista' }] } },
      'PATCH /api/v1/drafts/current': { status: 200, corpo: RASCUNHO },
      'GET /api/v1/drafts/current/identity': { status: 200, corpo: { first_name: 'Ana', email: 'ana@exemplo.test' } },
      'PUT /api/v1/drafts/current/identity': { status: 200, corpo: {} },
      'POST /api/v1/auth/challenges': { status: 200, corpo: {} },
      'GET /api/v1/drafts/current/review': { status: 200, corpo: VISAO },
      'GET /api/v1/media/photos': { status: 200, corpo: { fotos: [] } },
    });

    await test.step('inicial: busca o servico, escolhe e continua para o pedido', async () => {
      await page.goto(`${BASE}/`);
      await page.locator('#servico').fill('Eletri');
      await page.locator('#servico-lista li', { hasText: 'Eletricista' }).click();
      await page.locator('#endereco').fill('Rua das Flores, 10');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.waitForURL(`${BASE}/pedido`, { timeout: 15_000 });
      await semViolacoes(page, '/ (inicial)');
    });

    await test.step('pedido: dados do rascunho e "Revisar pedido" leva as fotos (nao a revisao)', async () => {
      await expect(page.locator('#nome')).toHaveValue('Ana');
      await page.getByRole('button', { name: 'Revisar pedido' }).click();
      await page.waitForURL(`${BASE}/fotos`, { timeout: 15_000 });
    });

    await test.step('fotos: Voltar ao pedido e Continuar para revisao aparecem e sao alcancaveis pelo teclado', async () => {
      const passos = page.getByRole('navigation', { name: 'Passos do pedido' });
      await expect(passos.getByRole('link', { name: 'Voltar ao pedido' })).toBeVisible();
      await expect(passos.getByRole('link', { name: 'Continuar para revisão' })).toBeVisible();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Pular para o conteúdo');
      await semViolacoes(page, '/fotos');
    });

    await test.step('fotos: Continuar (teclado Enter) abre a revisao com os dados do pedido', async () => {
      await page.getByRole('link', { name: 'Continuar para revisão' }).focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(`${BASE}/pedido/revisao`, { timeout: 15_000 });
      await expect(page.locator('#secao-revisao')).toBeVisible();
      await expect(page.locator('#v-servico')).toHaveText('Eletricista');
      await expect(page.locator('#v-endereco')).toHaveText('Rua das Flores, 10');
      await semViolacoes(page, '/pedido/revisao');
    });

    await test.step('revisao: Voltar às fotos (teclado) e de volta a revisao sem perder o pedido', async () => {
      await page.getByRole('navigation', { name: 'Passos do pedido' }).getByRole('link', { name: 'Voltar às fotos' }).focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(`${BASE}/fotos`, { timeout: 15_000 });
      await page.getByRole('link', { name: 'Continuar para revisão' }).click();
      await expect(page.locator('#v-servico')).toHaveText('Eletricista');
    });

    await test.step('nenhuma origem externa foi acessada e a API recebeu so as chamadas esperadas', async () => {
      expect(reg.externas).toEqual([]);
      expect(reg.api).toContain('GET /api/v1/media/photos');
      expect(reg.api.filter((c) => c === 'POST /api/v1/requests')).toEqual([]);
    });
  });

  test('revisao sem sessao: publicar mostra o aviso de sessao, o pedido segue guardado e o link volta a revisao', async ({ page }) => {
    const reg = await servir(page, {
      'GET /api/v1/drafts/current/review': { status: 200, corpo: VISAO },
      'POST /api/v1/drafts/current/confirm': { status: 200, corpo: CONFIRMADO },
      'POST /api/v1/requests': { status: 401, corpo: { code: 'sessao_necessaria' } },
    });

    await page.goto(`${BASE}/pedido/revisao`);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByRole('button', { name: 'Publicar pedido' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar pedido' }).click();

    await expect(page.locator('#publicar-erro')).toContainText('Sua sessão terminou. Entre de novo para publicar. Seu pedido continua guardado.');
    const entrar = page.getByRole('link', { name: 'Entrar de novo' });
    await expect(entrar).toBeVisible();
    await expect(entrar).toHaveAttribute('href', '/entrar?voltar=%2Fpedido%2Frevisao');
    expect(reg.api.filter((c) => c === 'POST /api/v1/requests')).toHaveLength(1);
    await semViolacoes(page, '/pedido/revisao (sessao expirada)');
    expect(reg.externas).toEqual([]);
  });
});
