// H-019 | Controlador do campo de busca de servico (docs/factory/64-DESENHO-H019.md, §3.5, §4, §5.1 T-H019-06).
// Logica sem tela e sem armazenamento: nada e gravado em storage, cache ou URL. O termo vai so para
// fetchSearch. Mensagens vem da tabela de codigos (nunca de texto do servidor). @fastpro/ui so depende de
// @fastpro/tokens, por isso os tipos abaixo sao locais e espelham o contrato de H-019 §3.2.

export type ServiceSearchState = 'ocioso' | 'carregando' | 'resultados' | 'vazio' | 'falha' | 'limite';

/** Item escolhido: so estes quatro campos saem do campo (§3.5, item 5). */
export interface ServiceSearchItem {
  readonly service_id: string;
  readonly service_name: string;
  readonly group_id: string;
  readonly group_name: string;
}

/** Resposta do servidor, ja sem campos extras. Erro chega por codigo fixo (§3.2). */
export type ServiceSearchFetchResult =
  | { readonly status: 'ok'; readonly items: readonly ServiceSearchItem[] }
  | { readonly status: 'vazio' }
  | { readonly status: 'erro'; readonly code: string };

export const SERVICE_SEARCH_DEBOUNCE_MS = 250;
export const SERVICE_SEARCH_MIN_CHARS = 2;
export const SERVICE_SEARCH_MAX_RESULTS = 10;
export const SERVICE_SEARCH_LOADING_TEXT = 'Buscando…';

/** Textos da tabela de codigos (§4). Revisao de texto e uma edicao so aqui (dúvida g, BK-5). */
export const SERVICE_SEARCH_MESSAGES = {
  sem_resultado: 'Não encontramos esse serviço. Tente outra palavra.',
  falha: 'Não foi possível buscar agora. Tente de novo.',
  limite: 'Muitas buscas seguidas. Aguarde alguns segundos.',
} as const;

export interface ServiceSearchSnapshot {
  readonly state: ServiceSearchState;
  readonly items: readonly ServiceSearchItem[];
  /** Indice do item destacado pelo teclado; -1 quando nenhum. */
  readonly highlighted: number;
  readonly open: boolean;
  /** Texto visivel de vazio, falha, limite ou carregamento; null quando nao ha mensagem. */
  readonly message: string | null;
  /** Texto para a regiao aria-live (N sugestoes, vazio, falha, carregamento). */
  readonly announcement: string;
  readonly selected: ServiceSearchItem | null;
}

export interface ServiceSearchTimer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ServiceSearchControllerOptions {
  readonly fetchSearch: (q: string, signal: AbortSignal) => Promise<ServiceSearchFetchResult>;
  readonly onUpdate: (snapshot: ServiceSearchSnapshot) => void;
  /** Recebe o item escolhido, ou null quando a escolha e limpa (digitar de novo). */
  readonly onSelect: (item: ServiceSearchItem | null) => void;
  readonly debounceMs?: number;
  readonly minChars?: number;
  readonly timer?: ServiceSearchTimer;
}

const DEFAULT_TIMER: ServiceSearchTimer = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Plural de "sugestao" para a regiao viva: singular quando e exatamente 1 (§3.5, item 6). */
export function announceCount(n: number): string {
  return n === 1 ? '1 sugestão' : `${n} sugestões`;
}

export interface ServiceSearchController {
  /** Texto digitado. Menos de minChars: nada e consultado e nada e mostrado. */
  input(raw: string): void;
  moveHighlight(delta: 1 | -1): void;
  /** Escolhe o item no indice. Devolve false se o indice nao existe. */
  choose(index: number): boolean;
  /** Enter: escolhe o item destacado. Devolve false se nenhum esta destacado. */
  confirmHighlighted(): boolean;
  /** Esc: fecha a lista. O foco volta ao campo na camada de tela. */
  escape(): void;
  snapshot(): ServiceSearchSnapshot;
  /** Cancela temporizador e consulta em andamento. */
  dispose(): void;
}

export function createServiceSearchController(
  opts: ServiceSearchControllerOptions,
): ServiceSearchController {
  const debounceMs = opts.debounceMs ?? SERVICE_SEARCH_DEBOUNCE_MS;
  const minChars = opts.minChars ?? SERVICE_SEARCH_MIN_CHARS;
  const timer = opts.timer ?? DEFAULT_TIMER;

  let estado: ServiceSearchSnapshot = {
    state: 'ocioso',
    items: [],
    highlighted: -1,
    open: false,
    message: null,
    announcement: '',
    selected: null,
  };
  let seq = 0;
  let agendado: unknown = undefined;
  let emVoo: AbortController | undefined;

  const emitir = (parcial: Partial<ServiceSearchSnapshot>): void => {
    estado = { ...estado, ...parcial };
    opts.onUpdate(estado);
  };

  const cancelarPendencias = (): void => {
    seq += 1;
    if (agendado !== undefined) timer.clearTimeout(agendado);
    agendado = undefined;
    emVoo?.abort();
    emVoo = undefined;
  };

  const aplicar = (r: ServiceSearchFetchResult): void => {
    if (r.status === 'ok') {
      const items = r.items.slice(0, SERVICE_SEARCH_MAX_RESULTS);
      if (items.length === 0) {
        emitir({
          state: 'vazio',
          items: [],
          highlighted: -1,
          open: true,
          message: SERVICE_SEARCH_MESSAGES.sem_resultado,
          announcement: SERVICE_SEARCH_MESSAGES.sem_resultado,
        });
        return;
      }
      emitir({
        state: 'resultados',
        items,
        highlighted: -1,
        open: true,
        message: null,
        announcement: announceCount(items.length),
      });
      return;
    }
    if (r.status === 'vazio') {
      emitir({
        state: 'vazio',
        items: [],
        highlighted: -1,
        open: true,
        message: SERVICE_SEARCH_MESSAGES.sem_resultado,
        announcement: SERVICE_SEARCH_MESSAGES.sem_resultado,
      });
      return;
    }
    // Erro: entrada_invalida volta a ocioso (§4); limite e falha tem mensagem propria (CA-07).
    if (r.code === 'entrada_invalida') {
      emitir({ state: 'ocioso', items: [], highlighted: -1, open: false, message: null, announcement: '' });
      return;
    }
    const estadoErro: 'limite' | 'falha' = r.code === 'limite' ? 'limite' : 'falha';
    const msg = SERVICE_SEARCH_MESSAGES[estadoErro];
    emitir({
      state: estadoErro,
      items: [],
      highlighted: -1,
      open: true,
      message: msg,
      announcement: msg,
    });
  };

  const executar = async (q: string, minha: number): Promise<void> => {
    const ctrl = new AbortController();
    emVoo = ctrl;
    let r: ServiceSearchFetchResult;
    try {
      r = await opts.fetchSearch(q, ctrl.signal);
    } catch {
      // Consulta cancelada por digitacao nova: a resposta velha nao conta (§3.5, item 2).
      if (minha !== seq) return;
      r = { status: 'erro', code: 'falha' };
    }
    if (minha !== seq) return;
    emVoo = undefined;
    aplicar(r);
  };

  const escolher = (indice: number): boolean => {
    const item = estado.items[indice];
    if (item === undefined) return false;
    emitir({ selected: item, open: false, highlighted: -1 });
    opts.onSelect(item);
    return true;
  };

  return {
    input(raw: string): void {
      cancelarPendencias();
      if (estado.selected !== null) {
        emitir({ selected: null });
        opts.onSelect(null);
      }
      const q = raw.trim();
      if ([...q].length < minChars) {
        emitir({ state: 'ocioso', items: [], highlighted: -1, open: false, message: null, announcement: '' });
        return;
      }
      emitir({
        state: 'carregando',
        items: [],
        highlighted: -1,
        open: true,
        message: SERVICE_SEARCH_LOADING_TEXT,
        announcement: SERVICE_SEARCH_LOADING_TEXT,
      });
      const minha = seq;
      agendado = timer.setTimeout(() => {
        agendado = undefined;
        void executar(q, minha);
      }, debounceMs);
    },

    moveHighlight(delta: 1 | -1): void {
      if (estado.items.length === 0) return;
      const max = estado.items.length - 1;
      const prox = Math.min(max, Math.max(0, estado.highlighted + delta));
      emitir({ highlighted: prox, open: true });
    },

    choose(index: number): boolean {
      return escolher(index);
    },

    confirmHighlighted(): boolean {
      if (estado.highlighted < 0) return false;
      return escolher(estado.highlighted);
    },

    escape(): void {
      emitir({ open: false, highlighted: -1 });
    },

    snapshot(): ServiceSearchSnapshot {
      return estado;
    },

    dispose(): void {
      cancelarPendencias();
    },
  };
}
