// Issue #159 (F0, reproducao) | Pagina /pedido: defeito 1 (sugestao antes do primeiro salvamento, sem rascunho)
// e defeito 2 (servico escolhido aparece vazio). DOM minimo montado a partir de public/pedido.html, fetch com
// estado (porta de rascunho imitada) e relogio falso (vi.useFakeTimers). Sem rede real e sem navegador.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDRESS_NEUTRAL_MESSAGE } from '../public/address-field.js';

const HTML_PEDIDO = readFileSync(new URL('../public/pedido.html', import.meta.url), 'utf8');

interface Resposta {
  status: number;
  corpo?: unknown;
}

type Ouvinte = (evento: Record<string, unknown>) => void;

class ElementoPedido {
  value = '';
  hidden = false;
  disabled = false;
  selectedIndex = 0;
  children: ElementoPedido[] = [];
  private texto = '';
  private atributos = new Map<string, string>();
  private ouvintes = new Map<string, Ouvinte[]>();

  constructor(
    readonly ownerDocument: DocumentoPedido,
    readonly id: string,
  ) {}

  get textContent(): string {
    return this.texto;
  }

  set textContent(valor: string) {
    this.texto = String(valor);
    if (this.texto === '') this.children = [];
  }

  setAttribute(nome: string, valor: string): void {
    this.atributos.set(nome, String(valor));
  }

  getAttribute(nome: string): string | null {
    return this.atributos.get(nome) ?? null;
  }

  removeAttribute(nome: string): void {
    this.atributos.delete(nome);
  }

  addEventListener(tipo: string, fn: Ouvinte): void {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]);
  }

  appendChild(filho: ElementoPedido): ElementoPedido {
    this.children.push(filho);
    return filho;
  }

  querySelectorAll(): ElementoPedido[] {
    return [];
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  disparar(tipo: string, extra: Record<string, unknown> = {}): void {
    for (const fn of this.ouvintes.get(tipo) ?? []) {
      fn({ type: tipo, target: this, preventDefault: () => undefined, ...extra });
    }
  }
}

class DocumentoPedido {
  activeElement: ElementoPedido | null = null;
  visibilityState = 'visible';
  private elementos = new Map<string, ElementoPedido>();

  constructor() {
    for (const m of HTML_PEDIDO.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
      const el = new ElementoPedido(this, m[3] ?? '');
      el.hidden = /\shidden(?=\s|\/|$)/.test(`${m[2] ?? ''}${m[4] ?? ''}`);
      this.elementos.set(el.id, el);
    }
  }

  getElementById(id: string): ElementoPedido {
    const el = this.elementos.get(id);
    if (!el) throw new Error(`id ausente na marcacao: ${id}`);
    return el;
  }

  createElement(): ElementoPedido {
    return new ElementoPedido(this, '');
  }

  addEventListener(): void {}
}

const VISAO_COM_SERVICO = {
  id: 'rascunho-159',
  status: 'aberto',
  service_id: 'svc-1',
  service_name: 'Eletricista',
  address_text: null,
  urgency: null,
  description: null,
  expires_at: '2026-11-28T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
};

/** Espera as promessas da pagina assentarem (sem avancar o relogio falso). */
async function assentar(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function roteia(url: string, metodo: string, porta: { cookie: boolean; recusadas: number }): Resposta {
  if (url === '/api/v1/drafts/current' && metodo === 'GET') {
    return porta.cookie ? { status: 200, corpo: VISAO_COM_SERVICO } : { status: 404, corpo: { code: 'nao_encontrado' } };
  }
  if (url === '/api/v1/drafts' && metodo === 'POST') {
    porta.cookie = true;
    return { status: 201, corpo: VISAO_COM_SERVICO };
  }
  if (url === '/api/v1/drafts/current' && metodo === 'PATCH') {
    return { status: 200, corpo: VISAO_COM_SERVICO };
  }
  if (url === '/api/v1/geo/address-suggest') {
    if (!porta.cookie) {
      porta.recusadas += 1;
      return { status: 403, corpo: { code: 'not_draft' } };
    }
    return { status: 200, corpo: { mode: 'ok', items: [{ label: 'Rua das Flores, 10' }] } };
  }
  return { status: 404, corpo: { code: 'nao_encontrado' } };
}

/** Abre /pedido com a porta de rascunho imitada. `comRascunho` = a API ja tem rascunho com servico. */
async function abrirPedido(comRascunho: boolean) {
  const documento = new DocumentoPedido();
  const porta = { cookie: comRascunho, recusadas: 0 };
  const fetchFalso = async (url: string, opcoes: { method?: string } = {}) => {
    const r = roteia(url, opcoes.method ?? 'GET', porta);
    return {
      status: r.status,
      json: async () => {
        if (r.corpo === undefined) throw new SyntaxError('sem JSON');
        return r.corpo;
      },
    };
  };
  vi.stubGlobal('document', documento);
  vi.stubGlobal('fetch', fetchFalso);
  vi.resetModules();
  await import('../public/pedido.js');
  await assentar();
  const el = (id: string) => documento.getElementById(id);
  return { el, porta };
}

describe('defeitos #159 em /pedido (CA-159-02, CA-159-08)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('CA-159-02 sem rascunho: a sugestao nao e consultada antes do primeiro salvamento (sem 403, sem falha)', async () => {
    const pagina = await abrirPedido(false);
    const endereco = pagina.el('endereco');
    endereco.value = 'Rua das Flores';
    endereco.disparar('input');
    await vi.advanceTimersByTimeAsync(300);
    await assentar();
    expect(pagina.porta.recusadas).toBe(0);
    expect(pagina.el('endereco-aviso').textContent).not.toBe(ADDRESS_NEUTRAL_MESSAGE);
  });

  it('CA-159-08 servico escolhido: o campo de servico mostra o nome do servico vindo do rascunho', async () => {
    const pagina = await abrirPedido(true);
    expect(pagina.el('servico').value).toBe('Eletricista');
  });
});
