// H-013 (Issue #26) | T-H013-24 (modulo codigo.js com DOM simulado, sem rede) e checagens estaticas da pagina
// /codigo (docs/factory/91-DESENHO-H013.md, §5, §6). T-H013-25 (navegador, axe, zoom) NAO roda aqui: Playwright
// nao esta instalado no repositorio; fica pendente com motivo registrado no relatorio.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');
const CODIGO_JS = lerArquivo('../public/codigo.js');
const CODIGO_HTML = lerArquivo('../public/codigo.html');
const CODIGO_CSS = lerArquivo('../public/codigo.css');
const VERCEL = JSON.parse(lerArquivo('../vercel.json')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };

/** Elemento minimo: atributos, filhos, texto, valor, eventos. Basta para o modulo (sem DOM real). */
class Elem {
  attrs: Record<string, string> = {};
  children: Elem[] = [];
  textContent = '';
  value = '';
  disabled = false;
  listeners: Record<string, Array<(ev?: unknown) => unknown>> = {};
  constructor(public tag: string, public ownerDocument: Doc) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  appendChild(c: Elem) {
    this.children.push(c);
    return c;
  }
  addEventListener(t: string, fn: (ev?: unknown) => unknown) {
    (this.listeners[t] ??= []).push(fn);
  }
  dispatch(t: string, ev: unknown = {}) {
    for (const fn of this.listeners[t] ?? []) fn(ev);
  }
  focus() {
    this.ownerDocument.focused = this;
  }
  click() {
    this.dispatch('click');
  }
}

class Doc {
  focused: Elem | null = null;
  raiz: Elem | null = null;
  createElement(tag: string) {
    return new Elem(tag, this);
  }
  getElementById(id: string) {
    return id === 'codigo-raiz' ? this.raiz : null;
  }
}

interface Mundo {
  doc: Doc;
  raiz: Elem;
  fetchChamadas: Array<{ url: string; corpo: unknown }>;
  respostas: Array<{ status: number } | 'erro' | 'pendente'>;
  storage: string[];
  console: string[];
  api: {
    montarCodigo: (raiz: Elem, opcoes: Record<string, unknown>) => { form: Elem; campo: Elem; botao: Elem; erro: Elem; status: Elem; novo: Elem };
    soDigitos: (v: string) => string;
    TEXTOS: Record<string, string>;
  };
  pendentes: Array<(r: unknown) => void>;
}

/** Roda o script num contexto isolado. Sem location, history, localStorage nem sessionStorage (acesso falharia). */
function mundo(opcoesRoda: { pagina?: boolean; fila?: Array<{ status: number } | 'erro' | 'pendente'> } = {}): Mundo {
  const doc = new Doc();
  const raiz = doc.createElement('main');
  raiz.ownerDocument = doc;
  doc.raiz = opcoesRoda.pagina ? raiz : null;
  const m: Mundo = {
    doc,
    raiz,
    fetchChamadas: [],
    respostas: [...(opcoesRoda.fila ?? [])],
    storage: [],
    console: [],
    api: undefined as unknown as Mundo['api'],
    pendentes: [],
  };
  const fetchFalso = (url: string, init: { body?: string }) => {
    m.fetchChamadas.push({ url, corpo: init.body ? JSON.parse(init.body) : undefined });
    const prox = m.respostas.shift() ?? { status: 200 };
    if (prox === 'erro') return Promise.reject(new Error('rede'));
    if (prox === 'pendente') {
      return new Promise((resolve) => m.pendentes.push(resolve));
    }
    return Promise.resolve({ status: prox.status });
  };
  const sandbox = {
    document: doc,
    fetch: fetchFalso,
    setTimeout: () => 0,
    console: { log: (...a: unknown[]) => m.console.push(String(a)), error: () => m.console.push('err'), warn: () => m.console.push('warn') },
    localStorage: { setItem: () => m.storage.push('local') },
    sessionStorage: { setItem: () => m.storage.push('session') },
  };
  vm.runInNewContext(CODIGO_JS, sandbox);
  m.api = (sandbox as unknown as { FastProCodigo: Mundo['api'] }).FastProCodigo;
  return m;
}

/** Espera as promessas pendentes do modulo (o fetch falso resolve na propria fila de microtarefas). */
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('T-H013-24 modulo codigo.js (DOM simulado)', () => {
  it('so digitos, ate 6: colar com espacos ou traco e aceito', () => {
    const m = mundo();
    expect(m.api.soDigitos('12 34-56789')).toBe('123456');
    expect(m.api.soDigitos('ab')).toBe('');
  });

  it('botao so habilita com 6 digitos; campo recebe so digitos ao colar', () => {
    const m = mundo();
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test', purpose: 'publish' });
    expect(w.botao.disabled).toBe(true);
    w.campo.value = '12345';
    w.campo.dispatch('input');
    expect(w.botao.disabled).toBe(true);
    w.campo.value = '123-456';
    w.campo.dispatch('input');
    expect(w.campo.value).toBe('123456');
    expect(w.botao.disabled).toBe(false);
  });

  it('atributos do campo: numerico, one-time-code, 6 caracteres, alertas', () => {
    const m = mundo();
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test' });
    expect(w.campo.attrs.inputmode).toBe('numeric');
    expect(w.campo.attrs.autocomplete).toBe('one-time-code');
    expect(w.campo.attrs.maxlength).toBe('6');
    expect(w.campo.attrs.pattern).toBe('[0-9]{6}');
    expect(w.campo.attrs.type).toBe('text');
    expect(w.erro.attrs.role).toBe('alert');
    expect(w.status.attrs.role).toBe('status');
  });

  it('uma so chamada por clique: enquanto envia, novo clique nao dispara outro POST', async () => {
    const m = mundo({ fila: ['pendente'] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test', purpose: 'publish' });
    w.campo.value = '123456';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    w.form.dispatch('submit');
    expect(m.fetchChamadas).toHaveLength(1);
    expect(m.fetchChamadas[0]?.url).toBe('/api/v1/auth/challenges/verify');
    expect(w.botao.disabled).toBe(true);
    expect(w.botao.attrs['aria-busy']).toBe('true');
  });

  it('o corpo leva e-mail, codigo e finalidade; a URL nao leva nada sensivel', async () => {
    const m = mundo({ fila: [{ status: 200 }, { status: 200 }] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test', purpose: 'publish' });
    w.campo.value = '654321';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    await esperar();
    expect(m.fetchChamadas[0]?.corpo).toEqual({ email: 'cliente@example.test', code: '654321', purpose: 'publish' });
    expect(m.fetchChamadas[0]?.url).not.toMatch(/654321|cliente/);
  });

  it('mensagens fixas por status; 422 igual para os casos; 429 e 503 com texto proprio', async () => {
    const m = mundo({ fila: [{ status: 422 }, { status: 429 }, { status: 503 }, { status: 422 }] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test' });
    const enviar = async () => {
      w.campo.value = '111111';
      w.campo.dispatch('input');
      w.form.dispatch('submit');
      await esperar();
    };
    await enviar();
    expect(w.erro.textContent).toBe(m.api.TEXTOS.invalido);
    await enviar();
    expect(w.erro.textContent).toBe(m.api.TEXTOS.limite);
    await enviar();
    expect(w.erro.textContent).toBe(m.api.TEXTOS.indisponivel);
    await enviar();
    expect(w.erro.textContent).toBe(m.api.TEXTOS.invalido);
  });

  it('tres erros 422 seguidos acrescentam a ajuda; 422 nao revela tentativas', async () => {
    const m = mundo({ fila: [{ status: 422 }, { status: 422 }, { status: 422 }] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test' });
    for (let i = 0; i < 3; i++) {
      w.campo.value = '111111';
      w.campo.dispatch('input');
      w.form.dispatch('submit');
      await esperar();
    }
    expect(w.erro.textContent).toContain('peça um novo código');
    expect(w.erro.textContent).not.toMatch(/restante|tentativa/i);
  });

  it('foco volta ao campo no erro, com aria-invalid', async () => {
    const m = mundo({ fila: [{ status: 422 }] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test' });
    w.campo.value = '111111';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    await esperar();
    expect(m.doc.focused).toBe(w.campo);
    expect(w.campo.attrs['aria-invalid']).toBe('true');
  });

  it('200: confirma, abre a etapa (POST session) e chama aoConfirmar uma vez', async () => {
    let confirmou = 0;
    const m = mundo({ fila: [{ status: 200 }, { status: 200 }] });
    const w = m.api.montarCodigo(m.raiz, {
      email: 'cliente@example.test',
      aoConfirmar: () => {
        confirmou += 1;
      },
    });
    w.campo.value = '123456';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    await esperar();
    expect(m.fetchChamadas.map((c) => c.url)).toEqual(['/api/v1/auth/challenges/verify', '/api/v1/auth/session']);
    expect(w.status.textContent).toBe(m.api.TEXTOS.acessoConfirmado);
    expect(confirmou).toBe(1);
  });

  it('pedido de novo codigo: sem e-mail valido nao envia; com e-mail envia uma vez', async () => {
    const m = mundo({ fila: [{ status: 202 }] });
    const w = m.api.montarCodigo(m.raiz, { purpose: 'login' });
    w.novo.dispatch('click');
    expect(m.fetchChamadas).toHaveLength(0);
    expect(w.erro.textContent).toBe(m.api.TEXTOS.emailInvalido);
  });

  it('nada vai a localStorage, sessionStorage, console ou URL', async () => {
    const m = mundo({ fila: [{ status: 422 }, { status: 200 }, { status: 200 }] });
    const w = m.api.montarCodigo(m.raiz, { email: 'cliente@example.test' });
    w.campo.value = '123456';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    await esperar();
    w.campo.value = '123456';
    w.campo.dispatch('input');
    w.form.dispatch('submit');
    await esperar();
    expect(m.storage).toEqual([]);
    expect(m.console).toEqual([]);
  });

  it('pagina isolada: liga o modulo ao elemento codigo-raiz sem e-mail pre-preenchido', () => {
    const m = mundo({ pagina: true });
    expect(m.raiz.children.length).toBeGreaterThan(0);
    const formulario = m.raiz.children[0] as Elem;
    expect(formulario.tag).toBe('form');
    const ache = (e: Elem, id: string): boolean => e.attrs.id === id || e.children.some((c) => ache(c, id));
    expect(ache(formulario, 'codigo-email')).toBe(true);
  });
});

describe('pagina /codigo (estatico, sem navegador)', () => {
  it('html: idioma pt-BR, um h1, sem script embutido, sem estilo inline, folhas externas', () => {
    expect(CODIGO_HTML).toMatch(/<html lang="pt-BR">/);
    expect((CODIGO_HTML.match(/<h1>/g) ?? []).length).toBe(1);
    expect(CODIGO_HTML).not.toMatch(/<script>(?!\s*<\/script>)/);
    expect(CODIGO_HTML).not.toMatch(/\sstyle=/);
    expect(CODIGO_HTML).toMatch(/href="\/codigo\.css"/);
    expect(CODIGO_HTML).toMatch(/src="\/codigo\.js"/);
  });

  it('css: sem cor hexadecimal solta (cores so por token)', () => {
    expect(CODIGO_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODIGO_CSS).toMatch(/outline: 3px solid var\(--color-brand\)/);
  });

  it('vercel.json: /codigo e /codigo/* com o mesmo bloco de cabecalhos de /pedido', () => {
    const pedido = VERCEL.headers.find((h) => h.source === '/pedido');
    const codigo = VERCEL.headers.find((h) => h.source === '/codigo');
    const codigoSub = VERCEL.headers.find((h) => h.source === '/codigo/(.*)');
    expect(pedido).toBeDefined();
    expect(codigo?.headers).toEqual(pedido?.headers);
    expect(codigoSub?.headers).toEqual(pedido?.headers);
    const csp = codigo?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'none'");
  });
});
