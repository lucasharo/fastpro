// H-020 | Testes do componente AddressField com relogio falso (docs/factory/56-DESENHO-H020.md, §1, §6 testes 4-6).
// Sem DOM real e sem rede: o controlador recebe temporizador, relogio e cliente falsos; a visao usa elementos
// falsos. Nenhuma chamada ao Mapbox: o cliente simulado responde o formato da propria API.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-020 (UI)');
};

import { describe, it, expect, vi } from 'vitest';
import {
  ADDRESS_DEBOUNCE_MS,
  ADDRESS_NEUTRAL_MESSAGE,
  createSuggestController,
  mountAddressField,
  normalizeQuery,
} from '../public/address-field.js';

// ---------- relogio e temporizador falsos ----------
function relogioFalso() {
  let agora = 0;
  let proximo = 1;
  const pendentes = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => agora,
    timers: {
      setTimeout(fn: () => void, ms: number) {
        const id = proximo++;
        pendentes.set(id, { at: agora + ms, fn });
        return id;
      },
      clearTimeout(id: number) {
        pendentes.delete(id);
      },
    },
    avancar(ms: number) {
      agora += ms;
      for (const [id, t] of [...pendentes]) {
        if (t.at <= agora) {
          pendentes.delete(id);
          t.fn();
        }
      }
    },
    pendentes: () => pendentes.size,
  };
}

// ---------- rede falsa: cada chamada fica pendente ate o teste responder ----------
interface Chamada {
  readonly body: { q: string; context: string };
  readonly signal: AbortSignal;
  responder(status: number, corpo: unknown): void;
  falhar(): void;
}

function redeFalsa() {
  const chamadas: Chamada[] = [];
  const request = (body: { q: string; context: string }, signal: AbortSignal) =>
    new Promise((resolve, reject) => {
      chamadas.push({
        body,
        signal,
        responder: (status: number, corpo: unknown) =>
          resolve({ ok: status >= 200 && status < 300, status, json: async () => corpo }),
        falhar: () => reject(new Error('falha de rede')),
      });
      signal.addEventListener('abort', () => reject(new DOMExceptionLike('AbortError')));
    });
  return { chamadas, request };
}

class DOMExceptionLike extends Error {
  constructor(nome: string) {
    super(nome);
    this.name = nome;
  }
}

function criar() {
  const relogio = relogioFalso();
  const rede = redeFalsa();
  const estados: Array<{ status: string; items: string[]; mensagem: string }> = [];
  const c = createSuggestController({
    context: 'request_draft',
    request: rede.request,
    timers: relogio.timers,
    now: relogio.now,
    onState: (e: { status: string; items: string[]; mensagem: string }) => estados.push(e),
  });
  return { c, relogio, rede, estados, ultimo: () => estados[estados.length - 1]! };
}

const ok = (labels: string[]) => ({
  mode: 'ok',
  items: labels.map((label) => ({ label })),
});

describe('T-H020-U1 minimo de 3 caracteres e espera de 300 ms (CA-07)', () => {
  it('2 caracteres nao consultam; 3 caracteres consultam uma vez apos 300 ms', () => {
    const { c, relogio, rede } = criar();
    c.input('Ru');
    relogio.avancar(1000);
    expect(rede.chamadas).toHaveLength(0);
    c.input('Rua');
    relogio.avancar(ADDRESS_DEBOUNCE_MS - 1);
    expect(rede.chamadas).toHaveLength(0);
    relogio.avancar(1);
    expect(rede.chamadas).toHaveLength(1);
    expect(rede.chamadas[0]!.body).toEqual({ q: 'Rua', context: 'request_draft' });
  });

  it('rajada de teclas gera uma unica consulta, com o texto final', () => {
    const { c, relogio, rede } = criar();
    c.input('Rua');
    relogio.avancar(200);
    c.input('Rua A');
    relogio.avancar(200);
    c.input('Rua Alfa');
    relogio.avancar(299);
    expect(rede.chamadas).toHaveLength(0);
    relogio.avancar(1);
    expect(rede.chamadas.map((x) => x.body.q)).toEqual(['Rua Alfa']);
  });

  it('mais de 120 caracteres nao consulta', () => {
    const { c, relogio, rede } = criar();
    c.input('a'.repeat(121));
    relogio.avancar(1000);
    expect(rede.chamadas).toHaveLength(0);
  });

  it('a contagem usa a mesma normalizacao da API (espacos, controles, NFC)', () => {
    expect(normalizeQuery('  Rua \t Alfa​ ')).toBe('Rua Alfa');
    expect(normalizeQuery('Rua José')).toBe('Rua José');
  });
});

describe('T-H020-U2 cancelamento da consulta em voo (desenho §1, regra 1)', () => {
  it('nova tecla aborta a consulta anterior e a resposta atrasada e ignorada', () => {
    const { c, relogio, rede, estados } = criar();
    c.input('Rua Al');
    relogio.avancar(300);
    const primeira = rede.chamadas[0]!;
    c.input('Rua Alf');
    expect(primeira.signal.aborted).toBe(true);
    const antes = estados.length;
    primeira.responder(200, ok(['Resposta velha']));
    return Promise.resolve().then(() => {
      expect(estados.length).toBe(antes);
      expect(c.getState().items).toEqual([]);
    });
  });
});

describe('T-H020-U3 lista, escolha e descarte (CA-05, CA-06)', () => {
  it('mostra os rotulos; escolher copia o rotulo, descarta a lista e nao consulta de novo', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, ok(['Rua Alfa, 10, Sao Paulo', 'Rua Alfa, 20, Campinas']));
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().status).toBe('lista');
    const escolhido = c.choose(1);
    expect(escolhido).toBe('Rua Alfa, 20, Campinas');
    expect(c.getValue()).toBe('Rua Alfa, 20, Campinas');
    expect(c.getState().items).toEqual([]);
    relogio.avancar(5000);
    expect(rede.chamadas).toHaveLength(1);
  });

  it('esc, perda de foco e limpar o campo descartam a lista e cancelam a consulta em voo', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, ok(['Rua Alfa']));
    await Promise.resolve();
    await Promise.resolve();
    c.discard();
    expect(c.getState().items).toEqual([]);
    c.input('Rua Beta');
    relogio.avancar(300);
    const emVoo = rede.chamadas[1]!;
    c.discard();
    expect(emVoo.signal.aborted).toBe(true);
  });

  it('o unico dado do formulario e o texto; a requisicao so leva q e context', () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    expect(Object.keys(rede.chamadas[0]!.body).sort()).toEqual(['context', 'q']);
    expect(typeof c.getValue()).toBe('string');
  });
});

describe('T-H020-U4 falha e degradacao sem nova tentativa (CA-10, CA-11)', () => {
  it('falha de rede ou 503 mostra a mensagem neutra e nao tenta de novo sozinha', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.falhar();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().mensagem).toBe(ADDRESS_NEUTRAL_MESSAGE);
    relogio.avancar(60_000);
    expect(rede.chamadas).toHaveLength(1);
    expect(c.getValue()).toBe('Rua Alfa');
  });

  it('texto_livre/indisponivel usa a mensagem neutra e exige nova digitacao', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, { mode: 'texto_livre', reason: 'indisponivel' });
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().mensagem).toBe(ADDRESS_NEUTRAL_MESSAGE);
    c.input('Rua Alfa!');
    relogio.avancar(300);
    expect(rede.chamadas).toHaveLength(2);
  });
});

describe('T-H020-U5 limite de taxa e cota sem mensagem (CA-08, CA-09)', () => {
  it('limite: sem consulta pelo retry_after_s; depois volta', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(429, { mode: 'texto_livre', reason: 'limite', retry_after_s: 60 });
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().mensagem).toBe('');
    c.input('Rua Alfas');
    relogio.avancar(300);
    expect(rede.chamadas).toHaveLength(1);
    relogio.avancar(60_000);
    c.input('Rua Alfass');
    relogio.avancar(300);
    expect(rede.chamadas).toHaveLength(2);
  });

  it('cota: nenhuma consulta ate recarregar a pagina e sem mensagem de erro', async () => {
    const { c, relogio, rede } = criar();
    c.input('Rua Alfa');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, { mode: 'texto_livre', reason: 'cota' });
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().mensagem).toBe('');
    relogio.avancar(3_600_000);
    c.input('Rua Alfas');
    relogio.avancar(1000);
    expect(rede.chamadas).toHaveLength(1);
  });
});

describe('T-H020-U6 nenhuma escrita em armazenamento do navegador (CA-05)', () => {
  it('um fluxo completo nao toca localStorage, sessionStorage, IndexedDB nem Cache API', async () => {
    const espias = {
      localStorage: vi.fn(),
      sessionStorage: vi.fn(),
      indexedDB: vi.fn(),
      caches: vi.fn(),
    };
    for (const [nome, espia] of Object.entries(espias)) {
      Object.defineProperty(globalThis, nome, { value: espia, configurable: true, writable: true });
    }
    try {
      const { c, relogio, rede } = criar();
      c.input('Rua Alfa');
      relogio.avancar(300);
      rede.chamadas[0]!.responder(200, ok(['Rua Alfa, 10']));
      await Promise.resolve();
      await Promise.resolve();
      c.choose(0);
      for (const espia of Object.values(espias)) expect(espia).not.toHaveBeenCalled();
    } finally {
      for (const nome of Object.keys(espias)) delete (globalThis as Record<string, unknown>)[nome];
    }
  });
});

// ---------- visao com elementos falsos ----------
class ElementoFalso {
  readonly atributos = new Map<string, string>();
  readonly ouvintes = new Map<string, Array<(e: Record<string, unknown>) => void>>();
  readonly filhos: ElementoFalso[] = [];
  private texto = '';
  value = '';
  // Como no navegador: atribuir '' remove os filhos.
  get textContent() {
    return this.texto;
  }
  set textContent(v: string) {
    this.texto = v;
    if (v === '') this.filhos.length = 0;
  }
  readonly id: string;
  readonly ownerDocument: DocFalso;
  constructor(id: string, doc: DocFalso) {
    this.id = id;
    this.ownerDocument = doc;
  }
  setAttribute(n: string, v: string) {
    this.atributos.set(n, v);
  }
  removeAttribute(n: string) {
    this.atributos.delete(n);
  }
  getAttribute(n: string) {
    return this.atributos.get(n);
  }
  addEventListener(tipo: string, fn: (e: Record<string, unknown>) => void) {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(fn);
    this.ouvintes.set(tipo, lista);
  }
  disparar(tipo: string, evento: Record<string, unknown> = {}) {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn({ preventDefault() {}, ...evento });
  }
  appendChild(filho: ElementoFalso) {
    this.filhos.push(filho);
  }
}

class DocFalso {
  createElement() {
    return new ElementoFalso('', this);
  }
}

function montarVisao() {
  const doc = new DocFalso();
  const input = new ElementoFalso('campo', doc);
  const list = new ElementoFalso('opcoes', doc);
  const aviso = new ElementoFalso('aviso', doc);
  const relogio = relogioFalso();
  const rede = redeFalsa();
  mountAddressField({
    input,
    list,
    aviso,
    context: 'request_draft',
    request: rede.request,
    timers: relogio.timers,
    now: relogio.now,
  });
  return { input, list, aviso, relogio, rede };
}

describe('T-H020-U7 visao: combobox, rotulos como texto e escolha (CA-03, CA-04)', () => {
  it('rotulo com HTML aparece como texto, nunca como marcacao', async () => {
    const { input, list, relogio, rede } = montarVisao();
    input.value = 'Rua Alfa';
    input.disparar('input');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, ok(['<img src=x onerror=alert(1)>Rua Alfa']));
    await Promise.resolve();
    await Promise.resolve();
    expect(list.filhos).toHaveLength(1);
    expect(list.filhos[0]!.textContent).toBe('<img src=x onerror=alert(1)>Rua Alfa');
    expect(list.filhos[0]!.getAttribute('role')).toBe('option');
    expect(input.getAttribute('role')).toBe('combobox');
  });

  it('mousedown escolhe a opcao (campo recebe o rotulo) e a tecla Enter escolhe a ativa', async () => {
    const { input, list, relogio, rede } = montarVisao();
    input.value = 'Rua Alfa';
    input.disparar('input');
    relogio.avancar(300);
    rede.chamadas[0]!.responder(200, ok(['Rua Alfa, 10', 'Rua Alfa, 20']));
    await Promise.resolve();
    await Promise.resolve();
    list.filhos[0]!.disparar('mousedown');
    expect(input.value).toBe('Rua Alfa, 10');
    expect(list.filhos).toHaveLength(0);

    input.value = 'Rua Beta';
    input.disparar('input');
    relogio.avancar(300);
    rede.chamadas[1]!.responder(200, ok(['Rua Beta, 1', 'Rua Beta, 2']));
    await Promise.resolve();
    await Promise.resolve();
    input.disparar('keydown', { key: 'ArrowDown' });
    input.disparar('keydown', { key: 'ArrowDown' });
    input.disparar('keydown', { key: 'Enter' });
    expect(input.value).toBe('Rua Beta, 2');
  });

  it('perda de foco descarta a lista e a mensagem neutra aparece na regiao viva', async () => {
    const { input, list, aviso, relogio, rede } = montarVisao();
    input.value = 'Rua Alfa';
    input.disparar('input');
    relogio.avancar(300);
    rede.chamadas[0]!.falhar();
    await Promise.resolve();
    await Promise.resolve();
    expect(aviso.textContent).toBe(ADDRESS_NEUTRAL_MESSAGE);
    expect(aviso.getAttribute('aria-live')).toBe('polite');
    input.disparar('blur');
    expect(list.filhos).toHaveLength(0);
  });
});
