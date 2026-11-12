// @vitest-environment happy-dom
// H-107 (Issue 116) | Teste de render da pagina do catalogo com listas vazias (docs/factory/77-REFINO-H107.md CA-11).
// Renderiza a pagina de verdade (React em DOM simulado). A leitura da API e as dependencias do Next sao
// substituidas: a resposta vem de um objeto sintetico, nada chega a rede, ao banco ou a um cookie real.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaginaCatalogo from '../src/app/console/catalogo/page';
import { TEXTO_LISTA_VAZIA } from '../src/catalog-state';
import { notFound } from 'next/navigation';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'sessao-sintetica-do-teste' }) }),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@fastpro/domain', () => ({ ADMIN_SESSION_COOKIE: 'fastpro_admin_sessao_teste' }));
vi.mock('../src/app/console/catalogo/actions', () => ({ salvarCatalogo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test';
  // Lista vazia: grupos, servicos e sinonimos sem nenhum item (a API devolve 200 com as tres listas).
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ grupos: [], servicos: [], sinonimos: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
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
});

describe('T-H107-R2 pagina do catalogo com listas vazias (CA-11)', () => {
  it('cada uma das tres secoes mostra "Nenhum item encontrado." na tela', async () => {
    const jsx = await PaginaCatalogo();
    act(() => {
      root.render(jsx);
    });

    const avisos = Array.from(container.querySelectorAll('p')).filter(
      (p) => p.textContent === TEXTO_LISTA_VAZIA,
    );
    expect(avisos).toHaveLength(3);
    expect(container.textContent).toContain('Nenhum item encontrado.');
    expect(container.querySelector('h1')?.textContent).toBe('Catálogo');
    expect(notFound).not.toHaveBeenCalled();
  });
});
