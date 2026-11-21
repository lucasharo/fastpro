// #155 (desenho 178, S7; CA-NAV-01, 05, 08, 11, 12, 13, 15) | Navegacao entre as telas no Chromium local, com axe e teclado.
// Caminho feliz e caminhos de erro de guarda. As paginas saem de apps/web/public por route; a API e simulada por route
// (apoio-navegacao.ts). Sem rede real: qualquer outra origem e abortada. Prova com API real fica pendente da #156.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { simular, SESSAO } from './apoio-navegacao';

const BASE = 'http://fastpro.test';

async function semViolacoes(page: Page, quando: string) {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(resultado.violations.map((v) => `${v.id} (${v.impact})`), quando).toEqual([]);
}

test.describe('navegacao (S7, caminho feliz e guardas)', () => {
  test('cliente: a inicial leva a Meus pedidos; sem sessao vai para a entrada com retorno; com sessao lista o pedido', async ({ page }) => {
    const reg = await simular(page, { cliente: SESSAO.nenhuma, profissional: SESSAO.nenhuma });
    await page.setViewportSize({ width: 1200, height: 800 });

    await test.step('inicial com cabecalho comum e foco no "Pular para o conteudo" primeiro', async () => {
      await page.goto(`${BASE}/`);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Pular para o conteúdo');
      await semViolacoes(page, '/');
    });

    await test.step('Meus pedidos sem sessao vai para /entrar?voltar=/painel', async () => {
      await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Meus pedidos' }).click();
      await page.waitForURL(`${BASE}/entrar?voltar=%2Fpainel`);
      await expect(page.locator('main h1')).toHaveText('Entrar');
      expect(reg.api.some((r) => r.includes('/api/v1/requests'))).toBe(true);
    });

    await test.step('com sessao, /painel lista o pedido publicado sem dados de contato', async () => {
      await simular(page, { cliente: SESSAO.cliente, profissional: SESSAO.nenhuma }, reg);
      await page.goto(`${BASE}/painel`);
      await expect(page.locator('#lista li')).toHaveCount(1);
      await expect(page.locator('#lista')).toContainText('Conserto de torneira');
      await expect(page.locator('#lista')).toContainText('Aceites abertos');
      await semViolacoes(page, '/painel');
    });

    await test.step('reflow a 320 px sem rolagem horizontal e com os itens do menu', async () => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`${BASE}/painel`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Entrar' })).toBeVisible();
    });

    await test.step('nenhuma origem externa foi acessada', async () => {
      expect(reg.externas).toEqual([]);
    });
  });

  test('profissional: sem sessao vai para a entrada; aprovado percorre documentos, situacao e perfil', async ({ page }) => {
    const reg = await simular(page, { cliente: SESSAO.nenhuma, profissional: SESSAO.nenhuma });
    await page.setViewportSize({ width: 1200, height: 800 });

    await test.step('documentos sem sessao vai para /profissional/entrar com retorno', async () => {
      await page.goto(`${BASE}/profissional-documentos`);
      await page.waitForURL(`${BASE}/profissional/entrar?voltar=%2Fprofissional-documentos`);
      await expect(page.locator('main h1')).toHaveText('Entrar como profissional');
    });

    await test.step('aprovado: documentos liberam a tela e o link "Ver situacao" aparece', async () => {
      await simular(page, { cliente: SESSAO.nenhuma, profissional: SESSAO.aprovado }, reg);
      await page.goto(`${BASE}/profissional-documentos`);
      await expect(page.locator('section[data-protegido]').first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ver situação do cadastro' })).toHaveAttribute('href', '/profissional-situacao');
      await semViolacoes(page, '/profissional-documentos');
    });

    await test.step('situacao mostra o estado vindo do dominio', async () => {
      await page.getByRole('navigation', { name: 'Passos do profissional' }).getByRole('link', { name: 'Situação' }).click();
      await expect(page.locator('#situacao')).toHaveAttribute('data-estado', 'aprovada');
      await semViolacoes(page, '/profissional-situacao');
    });

    await test.step('perfil aprovado mostra nome, servicos e base', async () => {
      await page.getByRole('navigation', { name: 'Passos do profissional' }).getByRole('link', { name: 'Perfil' }).click();
      await expect(page.locator('#conteudo-perfil')).toBeVisible();
      await expect(page.locator('#conteudo-perfil')).toContainText('Ana Teste');
      await expect(page.locator('#conteudo-perfil')).toContainText('Eletricista');
      await expect(page.locator('#conteudo-perfil')).toContainText('Bairro Centro');
      await semViolacoes(page, '/profissional-perfil');
    });

    await test.step('perfil antes da aprovacao volta para a situacao', async () => {
      await simular(page, { cliente: SESSAO.nenhuma, profissional: SESSAO.emAnalise }, reg);
      await page.goto(`${BASE}/profissional-perfil`);
      await page.waitForURL(`${BASE}/profissional-situacao`);
      await expect(page.locator('#situacao')).toHaveAttribute('data-estado', 'em_analise');
    });

    await test.step('nenhuma origem externa foi acessada', async () => {
      expect(reg.externas).toEqual([]);
    });
  });

  test('rotas de erro: rota inexistente mostra 404 com cabecalho e rodape; o documento antigo redireciona', async ({ page }) => {
    await simular(page, { cliente: SESSAO.nenhuma, profissional: SESSAO.nenhuma });
    await page.setViewportSize({ width: 1200, height: 800 });

    await test.step('404 com cabecalho, rodape e links de volta', async () => {
      const resposta = await page.goto(`${BASE}/rota-que-nao-existe`);
      expect(resposta?.status()).toBe(404);
      await expect(page.locator('main h1')).toHaveText('Não encontramos essa página');
      await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Pedir um serviço' })).toBeVisible();
      await semViolacoes(page, '/404');
    });

  });
});
