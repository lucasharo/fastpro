// @vitest-environment happy-dom
// Catalogo em abas (2026-11-24) | Render da pagina de verdade (React em DOM simulado). A API e as dependencias do
// Next sao substituidas: as respostas vem de objetos sinteticos, nada chega a rede, ao banco ou a um cookie real.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaginaCatalogo from '../src/app/console/catalogo/page';
import { notFound } from 'next/navigation';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'sessao-sintetica-do-teste' }) }),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@fastpro/domain', () => ({ ADMIN_SESSION_COOKIE: 'fastpro_admin_sessao_teste' }));
vi.mock('../src/app/console/catalogo/actions', () => ({ salvarCatalogo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPCOES = { groups: [{ id: 'g1', name: 'Elétrica', active: true }], services: [{ id: 's1', name: 'Tomada', group_id: 'g1', active: true }] };
let pagina: unknown = { total: 0, pagina: 1, porPagina: 50, items: [] };
let statusLista = 200;
const chamadas: string[] = [];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test';
  chamadas.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      chamadas.push(url);
      const opcoes = url.includes('catalogo-opcoes');
      const status = opcoes ? 200 : statusLista;
      return new Response(status === 200 ? JSON.stringify(opcoes ? OPCOES : pagina) : '', { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  statusLista = 200;
});

async function renderizar(parametros: Record<string, string>) {
  const jsx = await PaginaCatalogo({ searchParams: Promise.resolve(parametros) });
  act(() => {
    root.render(jsx);
  });
}

describe('catalogo em abas com tabela paginada no banco', () => {
  it('lista vazia: tres abas, Grupos ativa e aviso de lista vazia', async () => {
    pagina = { total: 0, pagina: 1, porPagina: 50, items: [] };
    await renderizar({});
    const abas = Array.from(container.querySelectorAll('.aba')).map((a) => a.textContent);
    expect(abas).toEqual(['Grupos', 'Serviços', 'Sinônimos']);
    expect(container.querySelector('.aba-ativa')?.textContent).toBe('Grupos');
    expect(container.textContent).toContain('Nenhum item com estes filtros.');
    expect(container.querySelector('h1')?.textContent).toBe('Catálogo');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('sinonimos: pede a pagina com os filtros e mostra tabela e paginacao', async () => {
    pagina = {
      total: 120,
      pagina: 2,
      porPagina: 50,
      items: [{ id: 'y1', term: 'tomada solta', service_id: 's1', service_name: 'Tomada', group_name: 'Elétrica', active: true, version: 1 }],
    };
    await renderizar({ aba: 'sinonimos', pagina: '2', q: 'tomada', grupo: 'g1' });
    expect(chamadas[0]).toContain('/v1/admin/listas/catalogo?aba=sinonimos&pagina=2&q=tomada&grupo=g1');
    expect(container.querySelector('.aba-ativa')?.textContent).toBe('Sinônimos');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody td')?.textContent).toBe('tomada solta');
    expect(container.textContent).toContain('Mostrando 51 a 100 de 120');
    expect(container.textContent).toContain('Página 2 de 3');
    const proxima = Array.from(container.querySelectorAll('.paginacao a')).find((a) => a.textContent === 'Próxima');
    expect(proxima?.getAttribute('href')).toBe('/console/catalogo?aba=sinonimos&q=tomada&grupo=g1&pagina=3');
  });

  it('sem permissao (404 da API): a tela responde como inexistente', async () => {
    statusLista = 404;
    await renderizar({}).catch(() => undefined);
    expect(notFound).toHaveBeenCalled();
  });
});
