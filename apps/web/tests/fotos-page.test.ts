// H-029 (Issue #42) | G-11 (controlador /fotos com DOM simulado, fetch e relogio falsos) e G-12 (estatico da
// pagina, cabecalhos e entrada do vercel.json) (docs/factory/98-DESENHO-H029.md, §4 e §7; CA-01 a CA-15).
// O navegador real (teclado, leitor de tela, zoom, contraste) NAO roda aqui: fica NAO VERIFICADO (G-14).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MEDIA_MAX_BYTES } from '@fastpro/domain';
import { enviarFoto, type PortasNavegador } from '../src/media/reduzir-foto.js';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');
const FOTOS_JS = lerArquivo('../public/fotos.js');
const FOTOS_HTML = lerArquivo('../public/fotos.html');
const FOTOS_CSS = lerArquivo('../public/fotos.css');
const VERCEL = JSON.parse(lerArquivo('../vercel.json')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

// ---------- DOM simulado minimo (o controlador so usa este subconjunto) ----------
class El {
  attrs: Record<string, string> = {};
  children: El[] = [];
  textContent = '';
  open = false;
  chaveFoco?: string;
  listeners: Record<string, Array<(ev?: unknown) => unknown>> = {};
  constructor(
    public tag: string,
    public doc: Doc,
  ) {}
  get firstChild(): El | null {
    return this.children[0] ?? null;
  }
  appendChild(c: El) {
    this.children.push(c);
    return c;
  }
  removeChild(c: El) {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
    if (k === 'open') this.open = true;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
    if (k === 'open') this.open = false;
  }
  addEventListener(t: string, fn: (ev?: unknown) => unknown) {
    (this.listeners[t] ??= []).push(fn);
  }
  dispatch(t: string, ev: unknown = {}) {
    for (const fn of this.listeners[t] ?? []) fn(ev);
  }
  focus() {
    this.doc.activeElement = this;
  }
  click() {
    this.dispatch('click');
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatch('close');
  }
}

class Doc {
  activeElement: El | null = null;
  hidden = false;
  listeners: Record<string, Array<() => unknown>> = {};
  createElement(tag: string) {
    return new El(tag, this);
  }
  getElementById() {
    return null;
  }
  addEventListener(t: string, fn: () => unknown) {
    (this.listeners[t] ??= []).push(fn);
  }
}

function todos(raiz: El): El[] {
  const saida: El[] = [];
  const percorre = (e: El) => {
    saida.push(e);
    e.children.forEach(percorre);
  };
  percorre(raiz);
  return saida;
}
const achar = (raiz: El, texto: string) => todos(raiz).find((e) => e.textContent === texto);
const acharTodos = (raiz: El, texto: string) => todos(raiz).filter((e) => e.textContent === texto);
const cartao = (raiz: El, id: string) => todos(raiz).find((e) => e.attrs['data-foto'] === id);
const ordemNaTela = (raiz: El) => todos(raiz).filter((e) => e.attrs['data-foto']).map((e) => e.attrs['data-foto']);

// ---------- Fetch, relogio e Blob falsos ----------
interface Chamada {
  metodo: string;
  url: string;
  corpo?: unknown;
  /** Corpo binario (PUT ao Storage). */
  blob?: Blob;
  signal?: AbortSignal;
  credentials?: string;
}
interface Resp {
  status: number;
  dados?: unknown;
  retryAfter?: string;
  blob?: boolean;
}

function resposta(r: Resp) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? (r.retryAfter ?? null) : null) },
    text: async () => (r.dados === undefined ? '' : JSON.stringify(r.dados)),
    blob: async () => new Blob(['jpeg-sintetico']),
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((res) => setTimeout(res, 0));
};

function criarAmbiente(handler: (c: Chamada) => Resp | Promise<Resp>) {
  const doc = new Doc();
  const chamadas: Chamada[] = [];
  const timers: Array<{ id: number; fn: () => unknown; ms: number }> = [];
  let proximoId = 1;
  const urlsCriadas: string[] = [];
  const urlsRevogadas: string[] = [];
  const sandbox: Record<string, unknown> = {
    document: doc,
    addEventListener: () => undefined,
    URL: {
      createObjectURL: () => {
        const u = `blob:sintetico/${urlsCriadas.length + 1}`;
        urlsCriadas.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => urlsRevogadas.push(u),
    },
    fetch: undefined,
    AbortController,
  };
  vm.createContext(sandbox);
  vm.runInContext(FOTOS_JS, sandbox);
  const api = (sandbox as { FastProFotos: { montarFotos: (r: El, o: object) => Ctrl } }).FastProFotos;
  const fetch = async (
    url: string,
    opcoes: { method: string; body?: string | Blob; signal?: AbortSignal; credentials?: string },
  ) => {
    const c: Chamada = {
      metodo: opcoes.method,
      url,
      corpo: typeof opcoes.body === 'string' ? JSON.parse(opcoes.body) : undefined,
      blob: opcoes.body instanceof Blob ? opcoes.body : undefined,
      signal: opcoes.signal,
      credentials: opcoes.credentials,
    };
    chamadas.push(c);
    return resposta(await handler(c));
  };
  const montar = (opcoes: { adicionarFoto?: () => void; envio?: unknown; sortear?: () => string } = {}) => {
    const raiz = doc.createElement('main');
    const ctrl = api.montarFotos(raiz, {
      documento: doc,
      fetch,
      agendar: (fn: () => unknown, ms: number) => {
        const id = proximoId++;
        timers.push({ id, fn, ms });
        return id;
      },
      cancelarAgendamento: (id: number) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      criarUrlObjeto: () => sandbox.URL && (sandbox.URL as { createObjectURL: () => string }).createObjectURL(),
      revogarUrlObjeto: (u: string) => urlsRevogadas.push(u),
      ...opcoes,
    });
    return { raiz, ctrl };
  };
  const dispararTimer = async () => {
    const t = timers.shift();
    if (!t) throw new Error('sem timer agendado');
    await t.fn();
    await flush();
  };
  return { doc, chamadas, timers, montar, dispararTimer, urlsCriadas, urlsRevogadas, api, fetch };
}

interface Ctrl {
  estado: Record<string, unknown>;
  elementos: { dialogo: El; adicionar: El; status: El; contador: El; lista: El; pagina: El };
  carregarLista: (silencioso: boolean) => Promise<void>;
}

const fotoLista = (id: string, estado: string, posicao: number | null, motivo?: string) => ({
  id,
  estado,
  posicao,
  ...(motivo ? { motivo } : {}),
});
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const ID_C = '00000000-0000-4000-8000-00000000000c';

/** Resposta padrao da listagem a partir de fotos. */
const lista200 = (fotos: unknown[]): Resp => ({ status: 200, dados: { fotos } });

describe('G-11 controlador /fotos (CA-01 a CA-12)', () => {
  it('CA-01: mostra carregando, depois a lista na ordem, com contagem so das vivas e recusada com motivo fixo', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') {
        return lista200([
          fotoLista(ID_A, 'pronta', 1),
          fotoLista(ID_B, 'processando', 2),
          fotoLista(ID_C, 'recusada', null, 'imagem_invalida'),
        ]);
      }
      return { status: 200, blob: true };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    expect(amb.doc.activeElement).toBeNull();
    await flush();
    expect(achar(raiz, 'Carregando fotos')).toBeDefined();
    expect(todos(raiz).some((e) => e.textContent === '2 de 5 fotos')).toBe(true);
    expect(ordemNaTela(raiz)).toEqual([ID_A, ID_B, ID_C]);
    expect(achar(raiz, 'Foto 1 de 2')).toBeDefined();
    expect(achar(raiz, 'Foto 2 de 2')).toBeDefined();
    expect(achar(raiz, 'Não foi possível usar esta foto: o arquivo não é JPG, PNG ou WebP.')).toBeDefined();
  });

  it('CA-01: lista vazia e um estado vazio, nunca erro', async () => {
    const amb = criarAmbiente(() => lista200([]));
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(achar(raiz, 'Nenhuma foto adicionada. Fotos são opcionais.')).toBeDefined();
    expect(achar(raiz, 'Não foi possível carregar as fotos.')).toBeUndefined();
  });

  it('CA-09: 503 mostra erro e Tentar de novo; 429 sem numero de limite; 404 com rascunho vencido sem botao', async () => {
    let resp: Resp = { status: 503 };
    const amb = criarAmbiente(() => resp);
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(achar(raiz, 'Não foi possível carregar as fotos.')).toBeDefined();
    expect(achar(raiz, 'Tentar de novo')).toBeDefined();

    resp = { status: 429, retryAfter: '30' };
    const r429 = amb.montar({ adicionarFoto: () => undefined }).raiz;
    await flush();
    expect(acharTodos(r429,'Aguarde alguns instantes e tente de novo.').length).toBeGreaterThan(0);

    resp = { status: 404, dados: { code: 'nao_encontrado' } };
    const rv = amb.montar({ adicionarFoto: () => undefined }).raiz;
    await flush();
    expect(achar(rv, 'Este pedido não está mais disponível. Comece um novo pedido.')).toBeDefined();
    expect(achar(rv, 'Tentar de novo')).toBeUndefined();
    expect(achar(rv, 'Começar um novo pedido')?.attrs.href).toBe('/pedido');
  });

  it('404 da midia com rascunho vivo: fotos indisponiveis com Tentar de novo (nao diz que o pedido venceu)', async () => {
    const amb = criarAmbiente((c) => (c.url === '/api/v1/drafts/current' ? { status: 200, dados: { id: 'x' } } : { status: 404 }));
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(
      achar(raiz, 'As fotos estão indisponíveis no momento. Você pode tentar de novo ou continuar o pedido sem fotos.'),
    ).toBeDefined();
    expect(achar(raiz, 'Este pedido não está mais disponível. Comece um novo pedido.')).toBeUndefined();
    expect(achar(raiz, 'Tentar de novo')).toBeDefined();
    expect(amb.chamadas.some((c) => c.metodo === 'GET' && c.url === '/api/v1/drafts/current')).toBe(true);
  });

  it('CA-03: consulta a cada 3 s, no maximo 20 vezes, depois mostra Ainda preparando a foto com Tentar de novo', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'processando', 1)]);
      return { status: 200 };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(amb.timers).toHaveLength(1);
    expect(amb.timers[0]?.ms).toBe(3000);
    for (let i = 0; i < 20; i++) await amb.dispararTimer();
    expect(amb.timers).toHaveLength(0);
    expect(achar(raiz, 'Ainda preparando a foto.')).toBeDefined();
    expect(achar(raiz, 'Tentar de novo')).toBeDefined();
    const consultas = amb.chamadas.filter((c) => c.metodo === 'GET' && c.url === '/api/v1/media/photos');
    expect(consultas).toHaveLength(21);
  });

  it('CA-03: com a aba oculta nao agenda consulta', async () => {
    const amb = criarAmbiente(() => lista200([fotoLista(ID_A, 'processando', 1)]));
    amb.doc.hidden = true;
    amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(amb.timers).toHaveLength(0);
  });

  it('CA-03: foto aguardando recebe finalize uma so vez por episodio', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'aguardando', 1)]);
      if (c.url.endsWith('/finalize')) return { status: 409, dados: { code: 'processando' } };
      return { status: 200 };
    });
    amb.montar({ adicionarFoto: () => undefined });
    await flush();
    await amb.dispararTimer();
    const finais = amb.chamadas.filter((c) => c.url.endsWith('/finalize'));
    expect(finais).toHaveLength(1);
    expect(finais[0]?.metodo).toBe('POST');
  });

  it('CA-05: Excluir abre o dialogo com foco em Cancelar; Cancelar fecha e devolve o foco; nada sai antes da resposta', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'GET') return { status: 200, blob: true };
      return { status: 200, dados: { excluida: true } };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    const gatilho = achar(raiz, 'Excluir foto 1')!;
    gatilho.click();
    const dialogo = (ctrl as unknown as Ctrl).elementos.dialogo;
    expect(dialogo.open).toBe(true);
    expect(amb.doc.activeElement?.textContent).toBe('Cancelar');
    achar(dialogo, 'Cancelar')!.click();
    expect(dialogo.open).toBe(false);
    expect(amb.doc.activeElement?.textContent).toBe('Excluir foto 1');
    expect(gatilho.textContent).toBe('Excluir foto 1');
    expect(amb.chamadas.some((c) => c.metodo === 'DELETE')).toBe(false);
    expect(cartao(raiz, ID_A)).toBeDefined();
  });

  it('CA-06: confirmar duas vezes gera uma so exclusao; 200 remove, anuncia e atualiza a contagem', async () => {
    let liberar: (() => void) | null = null;
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'DELETE') {
        return new Promise<Resp>((res) => {
          liberar = () => res({ status: 200, dados: { excluida: true } });
        });
      }
      return { status: 200, blob: true };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Excluir foto 1')!.click();
    const dialogo = (ctrl as unknown as Ctrl).elementos.dialogo;
    const confirmar = achar(dialogo, 'Excluir')!;
    confirmar.click();
    confirmar.click();
    await flush();
    expect(amb.chamadas.filter((c) => c.metodo === 'DELETE')).toHaveLength(1);
    expect(cartao(raiz, ID_A)).toBeDefined();
    liberar!();
    await flush();
    expect(cartao(raiz, ID_A)).toBeUndefined();
    expect(achar(raiz, '1 de 5 fotos')).toBeDefined();
    expect((ctrl as unknown as Ctrl).elementos.status.textContent).toBe('Foto 1 excluída');
  });

  it('CA-06: falha na exclusao mantem a foto com o erro e Tentar de novo', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1)]);
      if (c.metodo === 'DELETE') return { status: 503, dados: { code: 'indisponivel' } };
      return { status: 200, blob: true };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Excluir foto 1')!.click();
    achar((ctrl as unknown as Ctrl).elementos.dialogo, 'Excluir')!.click();
    await flush();
    expect(cartao(raiz, ID_A)).toBeDefined();
    expect(achar(raiz, 'Não foi possível excluir a foto. Tente de novo.')).toBeDefined();
  });

  it('CA-04: com 5 vivas, Adicionar foto fica aria-disabled e explica o limite', async () => {
    const fotos = [1, 2, 3, 4, 5].map((n) => fotoLista(`00000000-0000-4000-8000-00000000000${n}`, 'pronta', n));
    const amb = criarAmbiente((c) => (c.url === '/api/v1/media/photos' ? lista200(fotos) : { status: 200, blob: true }));
    const { ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    const el = (ctrl as unknown as Ctrl).elementos;
    expect(el.adicionar.attrs['aria-disabled']).toBe('true');
    expect(achar(el.pagina, 'Você já tem 5 fotos. Para adicionar outra, exclua uma.')).toBeDefined();
  });

  it('CA-04: sem a porta de envio o botao fica indisponivel neste navegador (nada de outro canal)', async () => {
    const amb = criarAmbiente(() => lista200([]));
    const { ctrl } = amb.montar();
    await flush();
    const el = (ctrl as unknown as Ctrl).elementos;
    expect(el.adicionar.attrs['aria-disabled']).toBe('true');
    expect(achar(el.pagina, 'Envio de foto indisponível neste navegador.')).toBeDefined();
  });

  it('CA-07: mover para antes envia a permutacao, mostra Salvando ordem e anuncia a nova posicao', async () => {
    let liberar: (() => void) | null = null;
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'PUT') {
        return new Promise<Resp>((res) => {
          liberar = () =>
            res({ status: 200, dados: { fotos: [fotoLista(ID_B, 'pronta', 1), fotoLista(ID_A, 'pronta', 2)] } });
        });
      }
      return { status: 200, blob: true };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Mover foto 2 para antes')!.click();
    await flush();
    const put = amb.chamadas.find((c) => c.metodo === 'PUT');
    expect(put?.corpo).toEqual({ ordem_atual: [ID_A, ID_B], ordem_nova: [ID_B, ID_A] });
    expect(ordemNaTela(raiz)).toEqual([ID_B, ID_A]);
    expect(achar(raiz, 'Salvando ordem')).toBeDefined();
    expect(achar(raiz, 'Mover foto 1 para antes')!.attrs['aria-disabled']).toBe('true');
    liberar!();
    await flush();
    expect((ctrl as unknown as Ctrl).elementos.status.textContent).toBe('Foto 2 movida para a posição 1 de 2');
    expect(achar(raiz, 'Salvando ordem')).toBeUndefined();
  });

  it('CA-08: falha na gravacao volta a ordem gravada e mostra o erro', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'PUT') return { status: 503, dados: { code: 'indisponivel' } };
      return { status: 200, blob: true };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Mover foto 2 para antes')!.click();
    await flush();
    expect(ordemNaTela(raiz)).toEqual([ID_A, ID_B]);
    expect(achar(raiz, 'Não foi possível salvar a nova ordem. Ela voltou à anterior.')).toBeDefined();
  });

  it('CA-08: 409 com lista diferente substitui a lista e anuncia que a ordem mudou', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'PUT')
        return { status: 409, dados: { code: 'ordem_mudou', fotos: [fotoLista(ID_C, 'pronta', 1), fotoLista(ID_A, 'pronta', 2)] } };
      return { status: 200, blob: true };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Mover foto 2 para antes')!.click();
    await flush();
    expect(ordemNaTela(raiz)).toEqual([ID_C, ID_A]);
    expect((ctrl as unknown as Ctrl).elementos.status.textContent).toBe('A ordem das fotos mudou; a lista foi atualizada.');
  });

  it('CA-08: 409 cuja lista ja e a desejada e sucesso silencioso', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      if (c.metodo === 'PUT')
        return { status: 409, dados: { code: 'ordem_mudou', fotos: [fotoLista(ID_B, 'pronta', 1), fotoLista(ID_A, 'pronta', 2)] } };
      return { status: 200, blob: true };
    });
    const { raiz, ctrl } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    achar(raiz, 'Mover foto 2 para antes')!.click();
    await flush();
    expect(ordemNaTela(raiz)).toEqual([ID_B, ID_A]);
    expect((ctrl as unknown as Ctrl).elementos.status.textContent).toBe('Foto 2 movida para a posição 1 de 2');
  });

  it('CA-07: as pontas ficam aria-disabled e nao enviam nada', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'pronta', 2)]);
      return { status: 200, blob: true };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    const antes = achar(raiz, 'Mover foto 1 para antes')!;
    const depois = achar(raiz, 'Mover foto 2 para depois')!;
    expect(antes.attrs['aria-disabled']).toBe('true');
    expect(depois.attrs['aria-disabled']).toBe('true');
    antes.click();
    depois.click();
    await flush();
    expect(amb.chamadas.some((c) => c.metodo === 'PUT')).toBe(false);
  });

  it('CA-02: a miniatura usa o Blob da versao reduzida e o texto alternativo Foto N de M', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1)]);
      if (c.url === `/api/v1/media/${ID_A}/image`) return { status: 200, blob: true };
      return { status: 404 };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    const img = todos(raiz).find((e) => e.tag === 'img');
    expect(img?.attrs['alt']).toBe('Foto 1 de 1');
    expect(img?.attrs['src']).toMatch(/^blob:/);
    expect(amb.chamadas.find((c) => c.url.endsWith('/image'))?.metodo).toBe('GET');
  });

  it('CA-02: falha na miniatura mostra o erro e Tentar de novo', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1)]);
      return { status: 404 };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(achar(raiz, 'Não foi possível mostrar esta foto.')).toBeDefined();
    expect(achar(raiz, 'Tentar de novo')).toBeDefined();
  });

  it('CA-12: os textos de estado e os nomes dos botoes dizem a qual foto se referem', async () => {
    const amb = criarAmbiente((c) => {
      if (c.url === '/api/v1/media/photos') return lista200([fotoLista(ID_A, 'pronta', 1), fotoLista(ID_B, 'enviando', 2)]);
      return { status: 200, blob: true };
    });
    const { raiz } = amb.montar({ adicionarFoto: () => undefined });
    await flush();
    expect(achar(raiz, 'Excluir foto 1')).toBeDefined();
    expect(achar(raiz, 'Excluir foto 2')).toBeDefined();
    expect(achar(raiz, 'Mover foto 1 para depois')).toBeDefined();
    expect(achar(raiz, 'O envio desta foto não foi concluído.')).toBeDefined();
  });

  it('CA-10/CA-16: o controlador so chama rotas da galeria, sem URL de original ou de Storage', async () => {
    const amb = criarAmbiente((c) => (c.url === '/api/v1/media/photos' ? lista200([fotoLista(ID_A, 'pronta', 1)]) : { status: 200, blob: true }));
    amb.montar({ adicionarFoto: () => undefined });
    await flush();
    for (const c of amb.chamadas) {
      expect(c.url.startsWith('/api/v1/media/')).toBe(true);
      expect(c.url).not.toMatch(/quarantine|storage|\/d\//);
    }
  });
});

// ---------- CA-04: fluxo completo "adicionar foto" (reduzir no navegador, emitir, PUT ao Storage, finalize, lista) ----------
// O fluxo usa enviarFoto (src/media/reduzir-foto.ts) com a API e o Storage falsos. O teste nao faz rede real:
// a URL de envio e sintetica e o PUT vai para um fake. A ordem das chamadas fica registrada em um unico diario.
class ErroFluxo extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const URL_ENVIO_SINTETICA = 'https://storage-sintetico.test/upload/sintetico';
const ID_NOVA = '00000000-0000-4000-8000-0000000000ff';

const arquivoSintetico = (tamanho: number, tipo: string): Blob => new Blob([new Uint8Array(tamanho)], { type: tipo });

/** Portas de navegador falsas: a decodificacao funciona e a codificacao devolve um JPEG de `tamanho` bytes. */
function portasReducao(tamanho: number): PortasNavegador {
  return {
    decodificar: async () => ({ width: 4000, height: 3000, recurso: {} }),
    codificar: async () => new Blob([new Uint8Array(tamanho)], { type: 'image/jpeg' }),
  };
}

/** Portas sem decodificacao (navegador sem suporte ou formato sem reducao): o original segue. */
const portasSemReducao: PortasNavegador = {
  decodificar: async () => null,
  codificar: async () => null,
};

async function lerJson(res: { text: () => Promise<string> }): Promise<unknown> {
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

function codigoDe(status: number, dados: unknown): string {
  const code = (dados as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return status === 429 ? 'muitas' : 'falha';
}

interface CenarioAdicionar {
  arquivo: Blob;
  portas: PortasNavegador;
  emissao?: Resp;
  storage?: number;
  finalizacao?: Resp;
  atualizacao?: Resp;
}

/** Pagina montada com fakes; clicarAdicionar() usa o botao real e espera o fluxo terminar. */
async function cenarioAdicionar(cfg: CenarioAdicionar) {
  const ordem: string[] = [];
  const emitidos: Array<{ content_type: string; size_bytes: number }> = [];
  const blobsEnviados: Blob[] = [];
  let fotos: unknown[] = [];
  let finalizada = false;
  let resultado: { ok: true; reduzida: boolean } | { erro: string } | null = null;

  const amb = criarAmbiente((c) => {
    if (c.url === '/api/v1/media/photos' && c.metodo === 'GET') {
      ordem.push('lista');
      if (finalizada && cfg.atualizacao) return cfg.atualizacao;
      return lista200(fotos);
    }
    if (c.url === '/api/v1/media/uploads' && c.metodo === 'POST') {
      ordem.push('emitir');
      emitidos.push(c.corpo as { content_type: string; size_bytes: number });
      return (
        cfg.emissao ?? {
          status: 201,
          dados: { id: ID_NOVA, status: 'pendente', upload_url: URL_ENVIO_SINTETICA, upload_expires_at: '2026-11-12T12:00:00.000Z' },
        }
      );
    }
    if (c.url === `/api/v1/media/${ID_NOVA}/finalize` && c.metodo === 'POST') {
      ordem.push('finalizar');
      const resp = cfg.finalizacao ?? { status: 200, dados: { id: ID_NOVA, status: 'processando' } };
      if (resp.status === 200) {
        fotos = [...fotos, fotoLista(ID_NOVA, 'processando', fotos.length + 1)];
        finalizada = true;
      }
      return resp;
    }
    return { status: 404 };
  });

  const put = async (_url: string, blob: Blob): Promise<number> => {
    ordem.push('put');
    blobsEnviados.push(blob);
    return cfg.storage ?? 200;
  };

  const { raiz, ctrl } = amb.montar({
    adicionarFoto: () => {
      void adicionar();
    },
  });
  await flush();

  async function adicionar(): Promise<void> {
    let urlEnvio = '';
    let id = '';
    try {
      const r = await enviarFoto({
        arquivo: cfg.arquivo,
        tipoDeclarado: cfg.arquivo.type,
        portas: cfg.portas,
        emitir: async (corpo) => {
          const res = await amb.fetch('/api/v1/media/uploads', { method: 'POST', body: JSON.stringify(corpo) });
          const dados = (await lerJson(res)) as { upload_url?: string; id?: string } | null;
          if (!res.ok) throw new ErroFluxo(codigoDe(res.status, dados));
          urlEnvio = dados?.upload_url ?? '';
          id = dados?.id ?? '';
        },
        enviar: async (blob) => {
          const status = await put(urlEnvio, blob);
          if (status < 200 || status > 299) throw new ErroFluxo('envio');
        },
      });
      if ('code' in r) throw new ErroFluxo(r.code);
      const fin = await amb.fetch(`/api/v1/media/${id}/finalize`, { method: 'POST' });
      if (!fin.ok) throw new ErroFluxo(codigoDe(fin.status, await lerJson(fin)));
      await ctrl.carregarLista(true);
      resultado = { ok: true, reduzida: r.reduzida };
    } catch (e) {
      if (!(e instanceof ErroFluxo)) throw e;
      resultado = { erro: e.code };
    }
  }

  return {
    raiz,
    ctrl,
    ordem,
    emitidos,
    blobsEnviados,
    resultado: () => resultado,
    clicarAdicionar: async () => {
      ctrl.elementos.adicionar.click();
      await flush();
    },
  };
}

describe('CA-04 fluxo completo adicionar foto (reduzir, emitir, PUT ao Storage, finalize, atualizar lista, erros)', () => {
  it('CA-04 sucesso: reduz, emite com o tamanho do blob reduzido, envia ao Storage, finaliza e atualiza a lista', async () => {
    const c = await cenarioAdicionar({ arquivo: arquivoSintetico(4_000_000, 'image/jpeg'), portas: portasReducao(420_000) });
    await c.clicarAdicionar();
    expect(c.ordem).toEqual(['lista', 'emitir', 'put', 'finalizar', 'lista']);
    expect(c.emitidos).toEqual([{ content_type: 'image/jpeg', size_bytes: 420_000 }]);
    expect(c.blobsEnviados.map((b) => b.size)).toEqual([420_000]);
    expect(c.resultado()).toEqual({ ok: true, reduzida: true });
    expect(c.ctrl.elementos.contador.textContent).toBe('1 de 5 fotos');
    expect(cartao(c.raiz, ID_NOVA)).toBeDefined();
  });

  it('CA-04 sem reducao possivel: emite e envia o original com o tipo declarado e o tamanho dele', async () => {
    const c = await cenarioAdicionar({ arquivo: arquivoSintetico(2_000_000, 'image/png'), portas: portasSemReducao });
    await c.clicarAdicionar();
    expect(c.emitidos).toEqual([{ content_type: 'image/png', size_bytes: 2_000_000 }]);
    expect(c.blobsEnviados.map((b) => b.size)).toEqual([2_000_000]);
    expect(c.resultado()).toEqual({ ok: true, reduzida: false });
    expect(c.ordem).toEqual(['lista', 'emitir', 'put', 'finalizar', 'lista']);
  });

  it('CA-04 erro: arquivo acima de 10 MB sem reducao e recusado localmente, sem emitir nem enviar', async () => {
    const c = await cenarioAdicionar({ arquivo: arquivoSintetico(MEDIA_MAX_BYTES + 1, 'image/jpeg'), portas: portasSemReducao });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ erro: 'arquivo_grande' });
    expect(c.ordem).toEqual(['lista']);
    expect(c.emitidos).toEqual([]);
  });

  it('CA-04 erro: 422 photo_limit na emissao nao envia, nao finaliza e nao mostra a foto', async () => {
    const c = await cenarioAdicionar({
      arquivo: arquivoSintetico(4_000_000, 'image/jpeg'),
      portas: portasReducao(420_000),
      emissao: { status: 422, dados: { code: 'photo_limit' } },
    });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ erro: 'photo_limit' });
    expect(c.ordem).toEqual(['lista', 'emitir']);
    expect(cartao(c.raiz, ID_NOVA)).toBeUndefined();
  });

  it('CA-04 erro: 429 na emissao devolve o codigo muitas e nao envia ao Storage', async () => {
    const c = await cenarioAdicionar({
      arquivo: arquivoSintetico(4_000_000, 'image/jpeg'),
      portas: portasReducao(420_000),
      emissao: { status: 429, retryAfter: '60' },
    });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ erro: 'muitas' });
    expect(c.ordem).toEqual(['lista', 'emitir']);
  });

  it('CA-04 erro: PUT ao Storage recusado para antes do finalize e nao muda a lista', async () => {
    const c = await cenarioAdicionar({ arquivo: arquivoSintetico(4_000_000, 'image/jpeg'), portas: portasReducao(420_000), storage: 403 });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ erro: 'envio' });
    expect(c.ordem).toEqual(['lista', 'emitir', 'put']);
    expect(cartao(c.raiz, ID_NOVA)).toBeUndefined();
  });

  it('CA-04 erro: finalize 409 upload_expirado devolve o codigo e a lista continua sem a foto', async () => {
    const c = await cenarioAdicionar({
      arquivo: arquivoSintetico(4_000_000, 'image/jpeg'),
      portas: portasReducao(420_000),
      finalizacao: { status: 409, dados: { code: 'upload_expirado' } },
    });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ erro: 'upload_expirado' });
    expect(c.ordem).toEqual(['lista', 'emitir', 'put', 'finalizar']);
    expect(cartao(c.raiz, ID_NOVA)).toBeUndefined();
  });

  it('CA-04 erro: foto aceita, mas a atualizacao da lista falha: a pagina mostra o erro e Tentar de novo', async () => {
    const c = await cenarioAdicionar({
      arquivo: arquivoSintetico(4_000_000, 'image/jpeg'),
      portas: portasReducao(420_000),
      atualizacao: { status: 503 },
    });
    await c.clicarAdicionar();
    expect(c.resultado()).toEqual({ ok: true, reduzida: true });
    expect(c.ordem).toEqual(['lista', 'emitir', 'put', 'finalizar', 'lista']);
    expect(achar(c.raiz, 'Não foi possível carregar as fotos.')).toBeDefined();
    expect(achar(c.raiz, 'Tentar de novo')).toBeDefined();
  });
});

describe('G-12 estatico da pagina /fotos (CA-13, CA-15, CA-16)', () => {
  it('sem cor hexadecimal nem funcao de cor em CSS, HTML e JS (so tokens)', () => {
    for (const arquivo of [FOTOS_CSS, FOTOS_HTML, FOTOS_JS]) {
      expect(arquivo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(arquivo).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\s*\(/i);
    }
  });

  it('CSS: cores e fundos so por var(--...), sem valor literal', () => {
    const declaracoesDeCor = FOTOS_CSS.match(/^\s*(color|background|border(?:-[a-z]+)?|outline)\s*:[^;]+;/gim) ?? [];
    expect(declaracoesDeCor.length).toBeGreaterThan(5);
    for (const d of declaracoesDeCor) {
      const valor = d.split(':').slice(1).join(':');
      const literal = valor.replace(/var\(--[a-z0-9-]+\)/g, '').replace(/\b(none|transparent|solid|inherit|0|1px|3px|2px|currentColor)\b/g, '');
      expect(literal.replace(/[\s;]/g, '')).not.toMatch(/[a-zA-Z]/);
    }
  });

  it('HTML: idioma pt-BR, noindex, tokens e a folha da pagina; o titulo e o h1 ficam no controlador', () => {
    expect(FOTOS_HTML).toContain('lang="pt-BR"');
    expect(FOTOS_HTML).toContain('name="robots" content="noindex"');
    expect(FOTOS_HTML).toContain('href="/tokens.css"');
    expect(FOTOS_HTML).toContain('href="/fotos.css"');
    expect(FOTOS_HTML).toContain('src="/fotos.js"');
    expect(FOTOS_JS).toContain("h1.textContent = TEXTOS.titulo");
  });

  it('regioes de status e alerta, dialogo nativo e nada de innerHTML', () => {
    expect(FOTOS_JS).toContain("setAttribute('role', 'status')");
    expect(FOTOS_JS).toContain("setAttribute('aria-live', 'polite')");
    expect(FOTOS_JS).toContain("createElement('dialog')");
    expect(FOTOS_JS).toContain("setAttribute('role', 'alert')");
    expect(FOTOS_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('textos aprovados: aviso de fachada, interior e rostos sempre visivel, e os textos da 98 §5', () => {
    expect(FOTOS_JS).toContain("aviso: 'Evite fotos que mostrem fachada, interior ou rostos.'");
    expect(FOTOS_JS).toContain("vazio: 'Nenhuma foto adicionada. Fotos são opcionais.'");
    expect(FOTOS_JS).toContain("processando: 'Preparando a foto. Isso leva alguns segundos.'");
    expect(FOTOS_JS).toContain("erroOrdem: 'Não foi possível salvar a nova ordem. Ela voltou à anterior.'");
    expect(FOTOS_JS).toContain("limite: 'Você já tem 5 fotos. Para adicionar outra, exclua uma.'");
    expect(FOTOS_JS).toContain("ainda: 'Ainda preparando a foto.'");
  });

  it('a pagina chama somente rotas da galeria e a leitura do rascunho (sem pedido, revisao ou publicacao)', () => {
    const rotas = FOTOS_JS.match(/'\/api\/[^']*'/g) ?? [];
    expect(rotas.length).toBeGreaterThan(0);
    // Leitura do rascunho: so para distinguir pedido vencido de fotos fora do ar no 404 uniforme da midia.
    for (const r of rotas) expect(r).toMatch(/^'\/api\/v1\/media\/|^'\/api\/v1\/drafts\/current'$/);
    expect(FOTOS_JS).not.toMatch(/publica|revisa|\/v1\/orders|\/v1\/pedido/i);
  });

  it('vercel.json: /fotos com no-store, noindex, CSP sem origem externa exceto o Storage e img-src blob:', () => {
    const entrada = VERCEL.headers.find((h) => h.source === '/fotos');
    expect(entrada).toBeDefined();
    const valor = (k: string) => entrada!.headers.find((h) => h.key === k)?.value ?? '';
    expect(valor('Cache-Control')).toBe('no-store');
    expect(valor('X-Robots-Tag')).toBe('noindex');
    expect(valor('Referrer-Policy')).toBe('no-referrer');
    const csp = valor('Content-Security-Policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('img-src blob:');
    expect(csp).toMatch(/connect-src 'self' https:\/\/[a-z0-9.-]+\.supabase\.co(?=;)/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

// ---------- E3 (Issue 141): envio ligado na pagina (fotos-envio.js), PUT sem cookie, polling e exclusao com cancelamento ----------
const ID_CLIENTE = '00000000-0000-4000-8000-0000000000c1';

async function esperarTudo(n = 60): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((res) => setTimeout(res, 0));
}

/** Porta de envio com a reducao real (reduzir-foto.ts), com portas de navegador falsas. */
function envioReal(portas: PortasNavegador) {
  return {
    disponivel: () => true,
    enviar: (
      arquivo: Blob,
      tipo: string,
      g: { emitir: (c: { content_type: string; size_bytes: number }) => Promise<void>; enviar: (b: Blob) => Promise<void> },
    ) => enviarFoto({ arquivo, tipoDeclarado: tipo, portas, emitir: g.emitir, enviar: g.enviar }),
  };
}

function escolherArquivo(ctrl: Ctrl, arquivo: Blob): void {
  const seletor = todos(ctrl.elementos.pagina).find((e) => e.tag === 'input');
  if (!seletor) throw new Error('seletor de arquivo ausente');
  (seletor as unknown as { files: Blob[] }).files = [arquivo];
  seletor.dispatch('change');
}

const abortErro = () => Object.assign(new Error('abortado'), { name: 'AbortError' });

describe('E3 (Issue 141) envio ligado na pagina', () => {
  it('Adicionar foto abre o seletor (JPG, PNG, WebP); a escolha segue emitir com o tamanho reduzido, PUT sem cookie, finalize e lista', async () => {
    const ordem: string[] = [];
    let lista: ReturnType<typeof fotoLista>[] = [];
    const amb = criarAmbiente((c) => {
      if (c.metodo === 'GET' && c.url === '/api/v1/media/photos') return lista200(lista);
      if (c.metodo === 'POST' && c.url === '/api/v1/media/uploads') {
        ordem.push('emitir');
        lista = [fotoLista(ID_NOVA, 'enviando', 1)];
        return { status: 201, dados: { id: ID_NOVA, status: 'pendente', upload_url: URL_ENVIO_SINTETICA } };
      }
      if (c.metodo === 'PUT') {
        ordem.push('put');
        return { status: 200 };
      }
      if (c.metodo === 'POST' && c.url === `/api/v1/media/${ID_NOVA}/finalize`) {
        ordem.push('finalize');
        lista = [fotoLista(ID_NOVA, 'processando', 1)];
        return { status: 200, dados: { id: ID_NOVA, status: 'processando' } };
      }
      return { status: 404 };
    });
    const { ctrl, raiz } = amb.montar({ envio: envioReal(portasReducao(2000)), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    const seletor = todos(ctrl.elementos.pagina).find((e) => e.tag === 'input')!;
    expect(seletor.attrs['type']).toBe('file');
    expect(seletor.attrs['accept']).toBe('image/jpeg,image/png,image/webp');
    escolherArquivo(ctrl, arquivoSintetico(5000, 'image/png'));
    await esperarTudo();

    expect(ordem).toEqual(['emitir', 'put', 'finalize']);
    const emissao = amb.chamadas.find((c) => c.metodo === 'POST' && c.url === '/api/v1/media/uploads');
    expect(emissao?.corpo).toEqual({ client_upload_id: ID_CLIENTE, content_type: 'image/jpeg', size_bytes: 2000 });
    const put = amb.chamadas.find((c) => c.metodo === 'PUT');
    expect(put?.url).toBe(URL_ENVIO_SINTETICA);
    expect(put?.credentials).toBe('omit');
    expect(put?.signal).toBeDefined();
    expect(put?.blob?.size).toBe(2000);
    expect(cartao(raiz, ID_NOVA)).toBeDefined();
    expect(Object.keys(ctrl.estado.envios as object)).toHaveLength(0);
  });

  it('o polling nao finaliza a foto que esta aba ainda envia; finaliza uma so vez depois do PUT', async () => {
    const ordem: string[] = [];
    let lista: ReturnType<typeof fotoLista>[] = [];
    let liberarPut: () => void = () => undefined;
    const amb = criarAmbiente((c) => {
      if (c.metodo === 'GET' && c.url === '/api/v1/media/photos') return lista200(lista);
      if (c.metodo === 'POST' && c.url === '/api/v1/media/uploads') {
        ordem.push('emitir');
        lista = [fotoLista(ID_NOVA, 'aguardando', 1)];
        return { status: 201, dados: { id: ID_NOVA, status: 'aguardando', upload_url: URL_ENVIO_SINTETICA } };
      }
      if (c.metodo === 'PUT') {
        ordem.push('put');
        return new Promise<Resp>((res) => {
          liberarPut = () => res({ status: 200 });
        });
      }
      if (c.metodo === 'POST' && c.url === `/api/v1/media/${ID_NOVA}/finalize`) {
        ordem.push('finalize');
        return { status: 200, dados: { id: ID_NOVA, status: 'processando' } };
      }
      return { status: 404 };
    });
    const { ctrl } = amb.montar({ envio: envioReal(portasReducao(2000)), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    escolherArquivo(ctrl, arquivoSintetico(5000, 'image/jpeg'));
    await esperarTudo();
    expect(ordem).toEqual(['emitir', 'put']);

    await amb.dispararTimer();
    await esperarTudo();
    expect(ordem).not.toContain('finalize');

    liberarPut();
    await esperarTudo();
    expect(ordem.filter((o) => o === 'finalize')).toHaveLength(1);
  });

  it('excluir uma foto em envio cancela o PUT (AbortController) antes do DELETE e so depois remove a foto da lista', async () => {
    const ordem: string[] = [];
    let lista: ReturnType<typeof fotoLista>[] = [];
    const amb = criarAmbiente((c) => {
      if (c.metodo === 'GET' && c.url === '/api/v1/media/photos') return lista200(lista);
      if (c.metodo === 'POST' && c.url === '/api/v1/media/uploads') {
        ordem.push('emitir');
        lista = [fotoLista(ID_NOVA, 'enviando', 1)];
        return { status: 201, dados: { id: ID_NOVA, status: 'pendente', upload_url: URL_ENVIO_SINTETICA } };
      }
      if (c.metodo === 'PUT') {
        return new Promise<Resp>((_, rejeitar) => {
          (c.signal as AbortSignal).addEventListener('abort', () => {
            ordem.push('abort');
            rejeitar(abortErro());
          });
        });
      }
      if (c.metodo === 'DELETE') {
        ordem.push('delete');
        lista = [];
        return { status: 200, dados: { excluida: true } };
      }
      return { status: 404 };
    });
    const { ctrl, raiz } = amb.montar({ envio: envioReal(portasReducao(2000)), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    escolherArquivo(ctrl, arquivoSintetico(5000, 'image/jpeg'));
    await esperarTudo();
    expect(cartao(raiz, ID_NOVA)).toBeDefined();

    achar(raiz, 'Excluir foto 1')!.click();
    achar(ctrl.elementos.dialogo, 'Excluir')!.click();
    await esperarTudo();

    expect(ordem).toEqual(['emitir', 'abort', 'delete']);
    expect(cartao(raiz, ID_NOVA)).toBeUndefined();
    expect(Object.keys(ctrl.estado.envios as object)).toHaveLength(0);
    expect(achar(raiz, 'Não foi possível enviar esta foto. Tente de novo.')).toBeUndefined();
  });

  it('falha no PUT mostra o texto aprovado, nao finaliza e deixa a foto para excluir', async () => {
    const ordem: string[] = [];
    let lista: ReturnType<typeof fotoLista>[] = [];
    const amb = criarAmbiente((c) => {
      if (c.metodo === 'GET' && c.url === '/api/v1/media/photos') return lista200(lista);
      if (c.metodo === 'POST' && c.url === '/api/v1/media/uploads') {
        ordem.push('emitir');
        lista = [fotoLista(ID_NOVA, 'enviando', 1)];
        return { status: 201, dados: { id: ID_NOVA, status: 'pendente', upload_url: URL_ENVIO_SINTETICA } };
      }
      if (c.metodo === 'PUT') {
        ordem.push('put');
        return { status: 503 };
      }
      if (c.metodo === 'POST' && c.url.endsWith('/finalize')) ordem.push('finalize');
      return { status: 404 };
    });
    const { ctrl, raiz } = amb.montar({ envio: envioReal(portasReducao(2000)), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    escolherArquivo(ctrl, arquivoSintetico(5000, 'image/jpeg'));
    await esperarTudo();
    expect(ordem).toEqual(['emitir', 'put']);
    expect(achar(ctrl.elementos.pagina, 'Não foi possível enviar esta foto. Tente de novo.')).toBeDefined();
    expect(cartao(raiz, ID_NOVA)).toBeDefined();
  });

  it('arquivo acima de 10 MB sem reducao: recusa no navegador com o texto aprovado, sem chamar a API', async () => {
    const amb = criarAmbiente(() => ({ status: 200, dados: { fotos: [] } }));
    const { ctrl } = amb.montar({ envio: envioReal(portasSemReducao), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    escolherArquivo(ctrl, arquivoSintetico(MEDIA_MAX_BYTES + 1, 'image/jpeg'));
    await esperarTudo();
    expect(amb.chamadas.some((c) => c.url === '/api/v1/media/uploads')).toBe(false);
    expect(achar(ctrl.elementos.pagina, 'Esta foto é grande demais. Escolha uma foto de até 10 MB.')).toBeDefined();
  });

  it('tipo que o servidor nao aceita (415): mostra o texto de tipo nao aceito e nao envia ao Storage', async () => {
    const amb = criarAmbiente((c) => {
      if (c.metodo === 'GET') return lista200([]);
      if (c.metodo === 'POST' && c.url === '/api/v1/media/uploads') return { status: 415, dados: { code: 'tipo_invalido' } };
      return { status: 404 };
    });
    const { ctrl } = amb.montar({ envio: envioReal(portasSemReducao), sortear: () => ID_CLIENTE });
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    await esperarTudo();
    escolherArquivo(ctrl, arquivoSintetico(3000, 'image/gif'));
    await esperarTudo();
    expect(amb.chamadas.some((c) => c.metodo === 'PUT')).toBe(false);
    expect(achar(ctrl.elementos.pagina, 'Este tipo de arquivo não é aceito. Use JPG, PNG ou WebP.')).toBeDefined();
  });

  it('sem a porta de envio o botao segue indisponivel e nenhum seletor de arquivo e criado', async () => {
    const amb = criarAmbiente(() => ({ status: 200, dados: { fotos: [] } }));
    const { ctrl } = amb.montar();
    await esperarTudo();
    ctrl.elementos.adicionar.click();
    expect(ctrl.elementos.adicionar.attrs['aria-disabled']).toBe('true');
    expect(todos(ctrl.elementos.pagina).some((e) => e.tag === 'input')).toBe(false);
  });
});
