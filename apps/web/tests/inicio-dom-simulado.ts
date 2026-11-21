// Issue #153 | DOM simulado para os testes da pagina inicial (sem navegador e sem dependencia nova). Os elementos
// saem dos ids e do atributo hidden reais de apps/web/public/index.html, para o teste usar a marcacao de verdade.
// A janela falsa registra cada chamada de rede e cada navegacao; os temporizadores so rodam quando o teste manda.
import { readFileSync } from 'node:fs';

export const HTML_INICIO = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
export const JS_INICIO = readFileSync(new URL('../public/inicio.js', import.meta.url), 'utf8');

export type Ouvinte = (evento: Record<string, unknown>) => void;

export class ElementoSimulado {
  id: string;
  value = '';
  hidden = false;
  disabled = false;
  children: ElementoSimulado[] = [];
  private texto = '';
  private atributos = new Map<string, string>();
  private ouvintes = new Map<string, Ouvinte[]>();

  constructor(
    readonly ownerDocument: DocumentoSimulado,
    id: string,
  ) {
    this.id = id;
  }

  get textContent(): string {
    return this.texto;
  }

  set textContent(valor: string) {
    this.texto = String(valor);
    if (this.texto === '') this.children.length = 0;
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

  appendChild(filho: ElementoSimulado): ElementoSimulado {
    this.children.push(filho);
    return filho;
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

export class DocumentoSimulado {
  activeElement: ElementoSimulado | null = null;
  private elementos = new Map<string, ElementoSimulado>();

  constructor() {
    const re = /<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g;
    for (const m of HTML_INICIO.matchAll(re)) {
      const el = new ElementoSimulado(this, m[3] ?? '');
      el.hidden = /\shidden(?=\s|\/|$)/.test(`${m[2] ?? ''}${m[4] ?? ''}`);
      this.elementos.set(el.id, el);
    }
  }

  getElementById(id: string): ElementoSimulado {
    const el = this.elementos.get(id);
    if (!el) throw new Error(`id ausente na marcacao: ${id}`);
    return el;
  }

  createElement(_tag: string): ElementoSimulado {
    return new ElementoSimulado(this, '');
  }
}

export interface Chamada {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  credentials?: string;
  redirect?: string;
  cache?: string;
  referrerPolicy?: string;
}

export type Resposta = { status: number; corpo?: unknown; semJson?: boolean };
export type Desfecho = Resposta | 'rede';
export type Roteador = (url: string, chamada: Chamada) => Desfecho | Promise<Desfecho> | undefined;

export const ITENS_BUSCA = [
  { service_id: 'svc-1', service_name: 'Eletricista' },
  { service_id: 'svc-2', service_name: 'Encanador' },
];

/** Rota de busca de servico: devolve os dois itens de ITENS_BUSCA. Outras rotas caem no roteador do teste. */
export function rotaComBusca(roteador: Roteador): Roteador {
  return (url, chamada) => {
    if (url === '/api/v1/catalog/service-search') return { status: 200, corpo: { status: 'ok', items: ITENS_BUSCA } };
    return roteador(url, chamada);
  };
}

export function criarJanela(roteador: Roteador) {
  const documento = new DocumentoSimulado();
  const chamadas: Chamada[] = [];
  const navegou: string[] = [];
  const pendentes = new Map<number, () => void>();
  let proximo = 1;
  const janela = {
    document: documento,
    location: {
      assign: (url: string) => {
        navegou.push(url);
      },
    },
    fetch: async (url: string, opcoes: Record<string, unknown>) => {
      const chamada: Chamada = {
        url,
        method: String(opcoes['method'] ?? 'GET'),
        body: opcoes['body'] as string | undefined,
        headers: opcoes['headers'] as Record<string, string> | undefined,
        credentials: opcoes['credentials'] as string | undefined,
        redirect: opcoes['redirect'] as string | undefined,
        cache: opcoes['cache'] as string | undefined,
        referrerPolicy: opcoes['referrerPolicy'] as string | undefined,
      };
      chamadas.push(chamada);
      const r = await roteador(url, chamada);
      if (r === undefined) throw new Error(`rota nao prevista no teste: ${chamada.method} ${url}`);
      if (r === 'rede') throw new TypeError('rede simulada');
      return {
        status: r.status,
        json: async () => {
          if (r.semJson || r.corpo === undefined) throw new SyntaxError('sem JSON');
          return r.corpo;
        },
      };
    },
    setTimeout: (fn: () => void) => {
      const id = proximo++;
      pendentes.set(id, fn);
      return id;
    },
    clearTimeout: (id: number) => {
      pendentes.delete(id);
    },
  };
  return {
    janela,
    documento,
    chamadas,
    navegou,
    rodarTimers(): void {
      for (const [id, fn] of [...pendentes]) {
        pendentes.delete(id);
        fn();
      }
    },
  };
}

/** Deixa as promessas da pagina assentarem (fila de microtarefas e de macrotarefas). */
export async function esperar(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((resolver) => setImmediate(resolver));
}

export function digitar(el: ElementoSimulado, texto: string): void {
  el.value = texto;
  el.disparar('input');
}

export function teclar(el: ElementoSimulado, tecla: string): void {
  el.disparar('keydown', { key: tecla });
}

/** Escolhe o primeiro servico da busca simulada (digita, espera o atraso, seta para baixo e Enter). */
export async function escolherPrimeiroServico(ctx: ReturnType<typeof criarJanela>): Promise<void> {
  const servico = ctx.documento.getElementById('servico');
  digitar(servico, 'el');
  ctx.rodarTimers();
  await esperar();
  teclar(servico, 'ArrowDown');
  teclar(servico, 'Enter');
}
