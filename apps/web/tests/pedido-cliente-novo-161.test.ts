// Issue #161 (Fatia 1) | Pagina /pedido: cliente novo (sem conta) recebe o codigo do primeiro pedido.
// O pedido do codigo e a verificacao usam purpose 'publish' (decisao D-1 do desenho 189), e o texto da espera nao
// afirma envio (D-6). DOM minimo montado a partir de public/pedido.html, fetch falso que grava o corpo das chamadas
// e relogio falso. Sem rede real e sem navegador.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HTML_PEDIDO = readFileSync(new URL('../public/pedido.html', import.meta.url), 'utf8');
const FONTE_PEDIDO = readFileSync(new URL('../public/pedido.js', import.meta.url), 'utf8');
const FONTE_LOGICA = readFileSync(new URL('../public/pedido-logica.js', import.meta.url), 'utf8');

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

interface Chamada {
  url: string;
  metodo: string;
  corpo: Record<string, unknown> | null;
}

/** Espera as promessas da pagina assentarem (sem avancar o relogio falso). */
async function assentar(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function resposta(status: number, corpo: unknown) {
  return {
    status,
    json: async () => {
      if (corpo === undefined) throw new SyntaxError('sem JSON');
      return corpo;
    },
  };
}

/** Abre /pedido com fetch falso: o desafio e a verificacao respondem como a API responde no caminho feliz. */
async function abrirPedido() {
  const documento = new DocumentoPedido();
  const chamadas: Chamada[] = [];
  const fetchFalso = async (url: string, opcoes: { method?: string; body?: string } = {}) => {
    const metodo = opcoes.method ?? 'GET';
    const corpo = opcoes.body ? (JSON.parse(opcoes.body) as Record<string, unknown>) : null;
    chamadas.push({ url, metodo, corpo });
    if (url === '/api/v1/auth/challenges' && metodo === 'POST') return resposta(202, { status: 'recebido' });
    if (url === '/api/v1/auth/challenges/verify' && metodo === 'POST') return resposta(200, { status: 'codigo_ok' });
    return resposta(404, { code: 'nao_encontrado' });
  };
  vi.stubGlobal('document', documento);
  vi.stubGlobal('fetch', fetchFalso);
  vi.resetModules();
  await import('../public/pedido.js');
  await assentar();
  return { el: (id: string) => documento.getElementById(id), chamadas };
}

describe('cliente novo em /pedido usa purpose publish (Issue 161, CA-161-01 e CA-161-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('o pedido do codigo e a verificacao enviam purpose publish, e a espera nao diz "Enviamos"', async () => {
    const pagina = await abrirPedido();

    // Pedido do codigo: botao "reenviar" chama enviarDesafio com o e-mail atual.
    pagina.el('reenviar').disparar('click');
    await assentar();
    const pedido = pagina.chamadas.find((c) => c.url === '/api/v1/auth/challenges' && c.metodo === 'POST');
    expect(pedido?.corpo?.purpose).toBe('publish');
    expect(pagina.el('email-texto').textContent).not.toContain('Enviamos');
    expect(pagina.el('email-texto').textContent).toContain('caixa de spam');

    // Verificacao: botao "validar-codigo" com seis digitos.
    pagina.el('codigo').value = '123456';
    pagina.el('validar-codigo').disparar('click');
    await assentar();
    const verifica = pagina.chamadas.find((c) => c.url === '/api/v1/auth/challenges/verify');
    expect(verifica?.corpo?.purpose).toBe('publish');
    expect(verifica?.corpo?.code).toBe('123456');
  });
});

describe('textos da espera e fontes de /pedido (Issue 161, D-6 e R-1)', () => {
  it('pedido.js nao fixa purpose login e nao afirma envio ("Enviamos")', () => {
    expect(FONTE_PEDIDO).not.toContain("purpose: 'login'");
    expect(FONTE_PEDIDO).not.toContain('Enviamos');
    expect(FONTE_PEDIDO.match(/purpose: 'publish'/g)?.length).toBe(2);
  });

  it('o texto padrao da espera (pedido-logica.js) nao afirma envio', () => {
    expect(FONTE_LOGICA).not.toContain('Enviamos um link');
    expect(FONTE_LOGICA).toContain('Pedimos o envio do código para o seu e-mail');
  });
});
