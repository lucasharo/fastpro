// H-030 (Issue #43) | Testes de navegador de /pedido e /pedido/revisao (docs/factory/90-DESENHO-H030.md §7.4,
// decisao 169). Subconjunto essencial: foco, aria-busy, botao desabilitado, clique unico, estados, axe e fluxo.
// A API e simulada por route do Playwright; as paginas saem de apps/web/public. Sem rede real, sem banco, sem e-mail:
// qualquer requisicao para outra origem e abortada e registrada (o teste exige que a lista fique vazia).
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

const REVISAO = 'GET /api/v1/drafts/current/review';
const CONFIRMA = 'POST /api/v1/drafts/current/confirm';
const ATUAL = 'GET /api/v1/drafts/current';
const IDENTIDADE_GET = 'GET /api/v1/drafts/current/identity';
const IDENTIDADE_PUT = 'PUT /api/v1/drafts/current/identity';
const DESAFIO = 'POST /api/v1/auth/challenges';

/** Resposta simulada. `espera` segura a resposta ate o teste liberar (para ver estados de carregamento). */
interface Resposta {
  status: number;
  corpo?: unknown;
  espera?: Promise<void>;
}
type Mapa = Record<string, Resposta>;

const VISAO = {
  service_id: 'svc-1',
  service: { name: 'Eletricista' },
  address_text: 'Rua das Flores, 10',
  urgency: 'imediato',
  description: 'Tomada queimada na cozinha',
  first_name: 'Ana',
  email: 'ana@exemplo.test',
  content_rev: 3,
  confirmed_at: null,
};
const CONFIRMADO_EM = '2026-11-12T12:00:00Z';

/** Cria uma espera manual: `liberar()` deixa a resposta seguir. */
function portao(): { espera: Promise<void>; liberar: () => void } {
  let liberar: () => void = () => {};
  const espera = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  return { espera, liberar: () => liberar() };
}

/** Arquivo de apps/web/public para um caminho (cleanUrls: /pedido -> pedido.html). Nunca sai da pasta publica. */
function arquivoPublico(caminho: string): string | undefined {
  const base = caminho === '/' ? '/index.html' : caminho;
  for (const candidato of [base, `${base}.html`, join(base, 'index.html')]) {
    const abs = resolve(PUBLICO, '.' + normalize(candidato));
    if (abs.startsWith(PUBLICO) && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return undefined;
}

interface Registro {
  chamadas: string[];
  externas: string[];
}

/** Instala a API simulada e o servidor de paginas por route. Qualquer outra origem e abortada. */
async function simular(page: Page, mapa: Mapa): Promise<Registro> {
  const registro: Registro = { chamadas: [], externas: [] };
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE) {
      registro.externas.push(req.url());
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chave = `${req.method()} ${url.pathname}`;
      registro.chamadas.push(chave);
      const resposta = mapa[chave] ?? { status: 500, corpo: { code: 'nao_simulado' } };
      if (resposta.espera) await resposta.espera;
      await route.fulfill({
        status: resposta.status,
        contentType: 'application/json',
        body: resposta.corpo === undefined ? '' : JSON.stringify(resposta.corpo),
      });
      return;
    }
    const abs = arquivoPublico(url.pathname);
    if (!abs) {
      await route.fulfill({ status: 404, body: 'nao encontrado' });
      return;
    }
    const tipo = TIPOS[abs.slice(abs.lastIndexOf('.'))] ?? 'application/octet-stream';
    await route.fulfill({ path: abs, contentType: tipo });
  });
  return registro;
}

/** Violacoes de impacto serio ou critico (AX-04). */
async function violacoesGraves(page: Page): Promise<string[]> {
  const resultado = await new AxeBuilder({ page }).analyze();
  return resultado.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact})`);
}

const contar = (registro: Registro, chave: string) => registro.chamadas.filter((c) => c === chave).length;

test.describe('/pedido/revisao (T-E05, T-E06, T-E09 essenciais)', () => {
  test('foco vai para o titulo depois da carga; nenhuma requisicao externa (CA-14, CA-11)', async ({ page }) => {
    const registro = await simular(page, { [REVISAO]: { status: 200, corpo: VISAO } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#secao-revisao')).toBeVisible();
    await expect(page.locator('#titulo')).toBeFocused();
    await expect(page.locator('#v-servico')).toHaveText('Eletricista');
    expect(registro.externas).toEqual([]);
  });

  test('carregando: aria-busy, texto de espera e sem dado antigo; depois libera (CA-13)', async ({ page }) => {
    const { espera, liberar } = portao();
    await simular(page, { [REVISAO]: { status: 200, corpo: VISAO, espera } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#pedido-raiz')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#estado')).toHaveText('Carregando seu pedido…');
    await expect(page.locator('#secao-revisao')).toBeHidden();
    liberar();
    await expect(page.locator('#pedido-raiz')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#v-servico')).toHaveText('Eletricista');
  });

  test('vazio: 404 mostra o texto e o link para comecar um novo pedido (CA-13)', async ({ page }) => {
    await simular(page, { [REVISAO]: { status: 404, corpo: { code: 'nao_encontrado' } } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#secao-vazia')).toContainText('Não encontramos um pedido em andamento. Comece um novo pedido.');
    await expect(page.getByRole('link', { name: 'Comece um novo pedido' })).toHaveAttribute('href', '/pedido');
  });

  test('campos faltando: resumo com os campos que faltam (CA-03)', async ({ page }) => {
    await simular(page, { [REVISAO]: { status: 422, corpo: { code: 'campos_faltando', missing: ['first_name', 'email'] } } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#campos-texto')).toHaveText(/Falta preencher: .+\./);
  });

  test('e-mail nao confirmado: tela Confira seu e-mail, sem dado do pedido (CA-04)', async ({ page }) => {
    await simular(page, { [REVISAO]: { status: 409, corpo: { code: 'email_nao_confirmado' } } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#secao-email')).toBeVisible();
    await expect(page.locator('#secao-email')).toContainText('Confira seu e-mail');
    await expect(page.getByText('Eletricista')).toHaveCount(0);
  });

  test('confirmar: um clique = uma chamada; botao desabilitado e aria-busy durante o envio (CA-06, CA-08)', async ({
    page,
  }) => {
    const { espera, liberar } = portao();
    const registro = await simular(page, {
      [REVISAO]: { status: 200, corpo: VISAO },
      [CONFIRMA]: { status: 200, corpo: { status: 'confirmado', confirmed_at: CONFIRMADO_EM }, espera },
    });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#confirmar')).toBeEnabled();
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.locator('#confirmar')).toBeDisabled();
    await expect(page.locator('#confirmar')).toHaveText('Confirmando…');
    await expect(page.locator('#pedido-raiz')).toHaveAttribute('aria-busy', 'true');
    // Cliques extras num botao desabilitado nao disparam evento: o envio continua unico.
    await page.locator('#confirmar').evaluate((botao) => {
      const alvo = botao as unknown as { click(): void };
      alvo.click();
      alvo.click();
    });
    expect(contar(registro, CONFIRMA)).toBe(1);
    liberar();
    await expect(page.locator('#confirmado')).toHaveText('Pedido confirmado. Ainda não foi publicado.');
    await expect(page.locator('#confirmado')).toBeFocused();
    expect(contar(registro, CONFIRMA)).toBe(1);
  });

  test('conteudo alterado: mensagem e nova leitura (CA-09)', async ({ page }) => {
    await simular(page, {
      [REVISAO]: { status: 200, corpo: VISAO },
      [CONFIRMA]: { status: 409, corpo: { code: 'conteudo_alterado' } },
    });
    await page.goto(`${BASE}/pedido/revisao`);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.locator('#confirmar-erro')).toHaveText('Seu pedido mudou. Confira de novo antes de confirmar.');
  });

  test('falha ao confirmar: texto sem "publicado", botao volta a ficar disponivel (CA-13)', async ({ page }) => {
    await simular(page, {
      [REVISAO]: { status: 200, corpo: VISAO },
      [CONFIRMA]: { status: 500, corpo: { code: 'erro' } },
    });
    await page.goto(`${BASE}/pedido/revisao`);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.locator('#confirmar-erro')).toHaveText(
      'Não foi possível confirmar agora. Seus dados continuam salvos. Tente de novo.',
    );
    await expect(page.locator('#confirmar')).toBeEnabled();
  });

  test('pedido ja confirmado abre direto em Confirmado, sem nova confirmacao (T-E06)', async ({ page }) => {
    const registro = await simular(page, {
      [REVISAO]: { status: 200, corpo: { ...VISAO, confirmed_at: CONFIRMADO_EM } },
    });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#confirmado')).toHaveText('Pedido confirmado. Ainda não foi publicado.');
    expect(contar(registro, CONFIRMA)).toBe(0);
  });

  test('axe sem violacoes serias ou criticas na revisao e no estado vazio (AX-04)', async ({ page }) => {
    await simular(page, { [REVISAO]: { status: 200, corpo: VISAO } });
    await page.goto(`${BASE}/pedido/revisao`);
    await expect(page.locator('#titulo')).toBeFocused();
    expect(await violacoesGraves(page)).toEqual([]);
  });
});

test.describe('/pedido (T-E02, T-E03, T-E04 essenciais)', () => {
  test('urgencia: exatamente os 4 rotulos aprovados e sem campo de senha (CA-02, CA-01)', async ({ page }) => {
    await simular(page, { [ATUAL]: { status: 404 }, [IDENTIDADE_GET]: { status: 404 } });
    await page.goto(`${BASE}/pedido`);
    await expect(page.locator('#urgencia option')).toHaveText(['Imediato', 'Nas próximas semanas', 'Próximo mês', 'Ainda não defini']);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('revisar com campos vazios: foco no resumo e nenhum pedido de e-mail (CA-03)', async ({ page }) => {
    const registro = await simular(page, { [ATUAL]: { status: 404 }, [IDENTIDADE_GET]: { status: 404 } });
    await page.goto(`${BASE}/pedido`);
    await page.getByRole('button', { name: 'Revisar pedido' }).click();
    await expect(page.locator('#resumo-erro')).toBeFocused();
    await expect(page.locator('#resumo-erro')).toHaveText(/Falta preencher/);
    expect(contar(registro, DESAFIO)).toBe(0);
  });

  test('fluxo com API simulada: revisar, espera do e-mail e a aba vai sozinha para as fotos (T-E04; desenho 178 S4)', async ({
    page,
  }) => {
    const registro = await simular(page, {
      [ATUAL]: {
        status: 200,
        corpo: { service_id: 'svc-1', address_text: 'Rua das Flores, 10', urgency: 'imediato', description: 'Tomada queimada na cozinha' },
      },
      [IDENTIDADE_GET]: { status: 200, corpo: { first_name: 'Ana', email: 'ana@exemplo.test' } },
      [IDENTIDADE_PUT]: { status: 200, corpo: {} },
      [DESAFIO]: { status: 200, corpo: {} },
      [REVISAO]: { status: 200, corpo: VISAO },
    });
    await page.goto(`${BASE}/pedido`);
    await expect(page.locator('#nome')).toHaveValue('Ana');
    await page.getByRole('button', { name: 'Revisar pedido' }).click();
    await expect(page).toHaveURL(/\/fotos$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Continuar para revisão' })).toBeVisible();
    expect(contar(registro, DESAFIO)).toBe(1);
    expect(contar(registro, CONFIRMA)).toBe(0);
    expect(registro.externas).toEqual([]);
  });

  test('axe sem violacoes serias ou criticas em /pedido (AX-04)', async ({ page }) => {
    await simular(page, { [ATUAL]: { status: 404 }, [IDENTIDADE_GET]: { status: 404 } });
    await page.goto(`${BASE}/pedido`);
    await expect(page.locator('#formulario')).toBeVisible();
    expect(await violacoesGraves(page)).toEqual([]);
  });
});
