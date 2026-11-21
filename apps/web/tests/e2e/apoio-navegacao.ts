// #155 (desenho 178, S7, AD-155-13) | Apoio do cenario de navegacao: serve apps/web/public com cleanUrls e 404.html,
// simula a API por route e registra chamadas. Cópia curta do padrao de pedido-h030.spec.ts; sem rede real.
import { existsSync, statSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

export const PUBLICO = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
export const BASE = 'http://fastpro.test';

/** Estado simulado da sessao: cada area tem a sua. "nenhuma" devolve 401 em toda chamada da area. */
export const SESSAO = Object.freeze({
  nenhuma: 'nenhuma',
  cliente: 'cliente',
  aprovado: 'aprovado',
  emAnalise: 'em_analise'
});

export interface Sessoes {
  cliente: string;
  profissional: string;
}

export interface Registro {
  api: string[];
  externas: string[];
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const PAINEL = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      serviceName: 'Conserto de torneira',
      status: 'publicado',
      prazo: 'aberto',
      publishedAt: '2026-11-20T12:00:00.000Z',
      acceptanceDeadlineAt: '2026-11-27T12:00:00.000Z'
    }
  ],
  nextCursor: null
};

const PERFIL = { publicName: 'Ana Teste', slug: 'ana-teste', documentType: 'rg', verification: 'aprovada' };
const SERVICOS = {
  services: [{ serviceId: 's1', name: 'Eletricista', regulated: false, active: true, modalities: ['presencial'] }]
};
const AREA = {
  configured: true,
  addressLabel: 'Bairro Centro',
  radiusKm: 10,
  since: '2026-11-01T00:00:00.000Z',
  changesRemaining: 2,
  nextChangeAt: null
};

function arquivoPublico(caminho: string): string | undefined {
  const base = caminho === '/' ? '/index.html' : caminho;
  for (const candidato of [base, `${base}.html`, join(base, 'index.html')]) {
    const abs = resolve(PUBLICO, '.' + normalize(candidato));
    if (abs.startsWith(PUBLICO) && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return undefined;
}

function json(route: Route, status: number, corpo: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
}

function verificacaoDe(estado: string) {
  if (estado === SESSAO.aprovado) {
    return { status: 200, corpo: { estado: 'aprovada', decididoEm: '2026-11-18T10:00:00.000Z', recurso: { situacao: 'indisponivel' } } };
  }
  if (estado === SESSAO.emAnalise) {
    return { status: 200, corpo: { estado: 'em_analise', recurso: { situacao: 'indisponivel' } } };
  }
  return { status: 401, corpo: { code: 'sessao_necessaria' } };
}

/** Liga a API simulada e o servidor de paginas. Chamadas a outras origens sao abortadas e registradas. */
export async function simular(page: Page, sessoes: Sessoes, reg: Registro = { api: [], externas: [] }): Promise<Registro> {
  await page.unroute('**/*').catch(() => undefined);
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE) {
      reg.externas.push(req.url());
      await route.abort();
      return;
    }
    const caminho = url.pathname;
    if (caminho.startsWith('/api/')) {
      reg.api.push(`${req.method()} ${caminho}`);
      if (caminho === '/api/v1/requests') {
        return sessoes.cliente === SESSAO.cliente ? json(route, 200, PAINEL) : json(route, 401, { code: 'sessao_necessaria' });
      }
      if (caminho.startsWith('/api/v1/professional/')) {
        const ativa = sessoes.profissional === SESSAO.aprovado || sessoes.profissional === SESSAO.emAnalise;
        if (caminho === '/api/v1/professional/verificacao') {
          const v = verificacaoDe(sessoes.profissional);
          return json(route, v.status, v.corpo);
        }
        if (!ativa) return json(route, 401, { code: 'sessao_necessaria' });
        if (caminho === '/api/v1/professional/profile') return json(route, 200, PERFIL);
        if (caminho === '/api/v1/professional/profile/services') return json(route, 200, SERVICOS);
        if (caminho === '/api/v1/professional/profile/area') return json(route, 200, AREA);
      }
      return json(route, 404, { code: 'nao_encontrado' });
    }
    if (caminho === '/profissional-documento') {
      await route.fulfill({ status: 307, headers: { location: '/profissional-documentos' }, body: '' });
      return;
    }
    const abs = arquivoPublico(caminho);
    if (!abs) {
      const pagina404 = resolve(PUBLICO, '404.html');
      await route.fulfill({ status: 404, path: pagina404, contentType: TIPOS['.html'] });
      return;
    }
    await route.fulfill({ path: abs, contentType: TIPOS[abs.slice(abs.lastIndexOf('.'))] ?? 'application/octet-stream' });
  });
  return reg;
}
