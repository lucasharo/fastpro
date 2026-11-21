// #154 | Simulacao minima de DOM para as paginas de entrada, rodando em node:vm (sem jsdom: nao instalado).
// Implementa so o que as paginas usam: id, textContent, value, disabled, hidden, atributos, eventos e focus.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export type Ouvinte = (evento: Evento) => void;
export interface Evento {
  prevented: boolean;
  preventDefault(): void;
  [chave: string]: unknown;
}

export class ElementoFalso {
  textContent = '';
  value = '';
  disabled = false;
  hidden = false;
  focos = 0;
  readonly attrs: Record<string, string> = {};
  private readonly ouvintes = new Map<string, Ouvinte[]>();

  constructor(readonly id: string) {}

  addEventListener(tipo: string, fn: Ouvinte): void {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(fn);
    this.ouvintes.set(tipo, lista);
  }

  disparar(tipo: string, extra: Record<string, unknown> = {}): Evento {
    const evento: Evento = {
      prevented: false,
      preventDefault() {
        evento.prevented = true;
      },
      ...extra,
    };
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(evento);
    return evento;
  }

  setAttribute(nome: string, valor: string): void {
    this.attrs[nome] = String(valor);
  }

  removeAttribute(nome: string): void {
    delete this.attrs[nome];
  }

  getAttribute(nome: string): string | null {
    return this.attrs[nome] ?? null;
  }

  focus(): void {
    this.focos += 1;
  }
}

export interface DocumentoFalso {
  body: { dataset: { pagina: string } };
  getElementById(id: string): ElementoFalso | null;
  el(id: string): ElementoFalso;
}

export function documentoFalso(ids: string[], pagina = ''): DocumentoFalso {
  const elementos = new Map(ids.map((id) => [id, new ElementoFalso(id)] as const));
  return {
    body: { dataset: { pagina } },
    getElementById: (id: string) => elementos.get(id) ?? null,
    el(id: string) {
      const e = elementos.get(id);
      if (!e) throw new Error(`elemento ausente na simulacao: ${id}`);
      return e;
    },
  };
}

export interface RespostaFalsa {
  status: number;
  headers?: { get(nome: string): string | null };
  json?: () => Promise<unknown>;
}

/** Resposta de API simulada. Sem corpo, json() rejeita (como um 204 real). */
export function resposta(status: number, corpo?: unknown, retryAfter?: string): RespostaFalsa {
  return {
    status,
    headers: { get: (nome: string) => (nome.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
    json: () => (corpo === undefined ? Promise.reject(new SyntaxError('sem corpo')) : Promise.resolve(corpo)),
  };
}

export type Responder = (url: string, opcoes: Record<string, unknown>) => Promise<RespostaFalsa>;

/**
 * Roda os scripts de public/ numa mesma maquina virtual, com o documento simulado e o fetch informado.
 * Registra chamadas de rede, temporizadores, redirecionamentos, trocas de URL e uso de armazenamento.
 */
export function carregarPagina(scripts: string[], doc: DocumentoFalso, responder: Responder, hash = '') {
  const chamadas: Array<[string, Record<string, unknown>]> = [];
  const timers: Array<[() => void, number]> = [];
  const redirecionamentos: string[] = [];
  const trocas: string[] = [];
  const armazenou: string[] = [];

  const janela: Record<string, unknown> = {
    document: doc,
    location: {
      hash,
      assign(url: string) {
        redirecionamentos.push(url);
      },
    },
    history: {
      replaceState(_estado: unknown, _titulo: string, url: string) {
        trocas.push(url);
      },
    },
    fetch(url: string, opcoes: Record<string, unknown>) {
      chamadas.push([url, opcoes]);
      return responder(url, opcoes);
    },
    setTimeout(fn: () => void, ms: number) {
      timers.push([fn, ms]);
    },
    localStorage: { setItem: () => armazenou.push('localStorage') },
    sessionStorage: { setItem: () => armazenou.push('sessionStorage') },
  };

  const contexto = vm.createContext(janela);
  for (const script of scripts) {
    vm.runInContext(readFileSync(new URL(`../public/${script}`, import.meta.url), 'utf8'), contexto);
  }

  return {
    janela,
    chamadas,
    timers,
    redirecionamentos,
    trocas,
    armazenou,
    /** Espera todas as microtarefas pendentes (respostas simuladas). */
    esperar: () => new Promise<void>((resolve) => setImmediate(resolve)),
  };
}
