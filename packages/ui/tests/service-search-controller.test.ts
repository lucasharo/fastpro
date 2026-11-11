// H-019 | Controlador do campo de busca de servico, sem tela (docs/factory/64-DESENHO-H019.md, §3.5, §5.1 T-H019-06
// e parte de T-H019-07). Relogio falso, consultas controladas por promessas. Dados sinteticos.
import { describe, it, expect, vi } from 'vitest';
import {
  announceCount,
  createServiceSearchController,
  SERVICE_SEARCH_LOADING_TEXT,
  SERVICE_SEARCH_MESSAGES,
  type ServiceSearchFetchResult,
  type ServiceSearchItem,
} from '../src/service-search/controller.js';

const ITEM_A: ServiceSearchItem = {
  service_id: 's-1',
  service_name: 'Pedreiro',
  group_id: 'g-1',
  group_name: 'Obras',
};
const ITEM_B: ServiceSearchItem = {
  service_id: 's-2',
  service_name: 'Servente de pedreiro',
  group_id: 'g-1',
  group_name: 'Obras',
};

function relogio() {
  let agora = 0;
  let proximo = 1;
  const pendentes = new Map<number, { at: number; fn: () => void }>();
  return {
    timer: {
      setTimeout(fn: () => void, ms: number): unknown {
        const id = proximo++;
        pendentes.set(id, { at: agora + ms, fn });
        return id;
      },
      clearTimeout(handle: unknown): void {
        pendentes.delete(handle as number);
      },
    },
    avancar(ms: number): void {
      agora += ms;
      for (const [id, p] of [...pendentes]) {
        if (p.at <= agora) {
          pendentes.delete(id);
          p.fn();
        }
      }
    },
    pendentes: () => pendentes.size,
  };
}

interface Chamada {
  readonly q: string;
  readonly signal: AbortSignal;
  resolve(r: ServiceSearchFetchResult): void;
  reject(e: unknown): void;
}

function consultaControlada() {
  const chamadas: Chamada[] = [];
  const fetchSearch = (q: string, signal: AbortSignal) =>
    new Promise<ServiceSearchFetchResult>((resolve, reject) => {
      chamadas.push({ q, signal, resolve, reject });
    });
  return { chamadas, fetchSearch };
}

/** Espera o fim de microtarefas pendentes (respostas ja resolvidas). */
const esperar = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function montar(overrides: { onSelect?: (i: ServiceSearchItem | null) => void } = {}) {
  const r = relogio();
  const c = consultaControlada();
  const atualizacoes: Array<ReturnType<ReturnType<typeof createServiceSearchController>['snapshot']>> = [];
  const selecoes: Array<ServiceSearchItem | null> = [];
  const ctrl = createServiceSearchController({
    fetchSearch: c.fetchSearch,
    onUpdate: (s) => atualizacoes.push(s),
    onSelect: (i) => {
      selecoes.push(i);
      overrides.onSelect?.(i);
    },
    timer: r.timer,
  });
  return { ctrl, r, c, selecoes, atualizacoes };
}

describe('termo curto e debounce (CA-07, §3.5 itens 1 e 2)', () => {
  it('menos de 2 caracteres: nenhuma consulta e nenhuma mensagem', () => {
    const { ctrl, r, c } = montar();
    ctrl.input('');
    ctrl.input('  p  ');
    r.avancar(1000);
    expect(c.chamadas).toEqual([]);
    expect(ctrl.snapshot()).toMatchObject({ state: 'ocioso', open: false, message: null, announcement: '' });
  });

  it('rajada de digitacao gera uma consulta depois de 250 ms, com o termo sem espacos das bordas', () => {
    const { ctrl, r, c } = montar();
    ctrl.input('p');
    ctrl.input('pe');
    r.avancar(200);
    ctrl.input('  pedr  ');
    r.avancar(249);
    expect(c.chamadas).toEqual([]);
    r.avancar(1);
    expect(c.chamadas.map((x) => x.q)).toEqual(['pedr']);
  });

  it('enquanto aguarda, mostra carregamento e nao trava o campo', () => {
    const { ctrl } = montar();
    ctrl.input('pedr');
    expect(ctrl.snapshot()).toMatchObject({
      state: 'carregando',
      message: SERVICE_SEARCH_LOADING_TEXT,
      announcement: SERVICE_SEARCH_LOADING_TEXT,
    });
  });

  it('nova digitacao aborta a consulta anterior e a resposta velha e ignorada', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    r.avancar(250);
    ctrl.input('pedre');
    r.avancar(250);
    expect(c.chamadas.map((x) => x.q)).toEqual(['pedr', 'pedre']);
    expect(c.chamadas[0]?.signal.aborted).toBe(true);
    expect(c.chamadas[1]?.signal.aborted).toBe(false);

    c.chamadas[1]?.resolve({ status: 'ok', items: [ITEM_A] });
    await esperar();
    c.chamadas[0]?.resolve({ status: 'ok', items: [ITEM_B] });
    await esperar();
    expect(ctrl.snapshot().items).toEqual([ITEM_A]);
  });
});

describe('estados da lista (CA-06, CA-07, §4)', () => {
  it('ok: lista com grupo e nome, anuncia o numero no plural e no singular', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();
    expect(ctrl.snapshot()).toMatchObject({ state: 'resultados', open: true, announcement: '2 sugestões' });
    expect(ctrl.snapshot().items[0]).toEqual(ITEM_A);

    ctrl.input('pedre');
    r.avancar(250);
    c.chamadas[1]?.resolve({ status: 'ok', items: [ITEM_A] });
    await esperar();
    expect(ctrl.snapshot().announcement).toBe('1 sugestão');
  });

  it('no maximo 10 sugestões aparecem', async () => {
    const { ctrl, r, c } = montar();
    const muitos = Array.from({ length: 12 }, (_, i) => ({ ...ITEM_A, service_id: `s-${i}` }));
    ctrl.input('ao');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'ok', items: muitos });
    await esperar();
    expect(ctrl.snapshot().items).toHaveLength(10);
    expect(ctrl.snapshot().announcement).toBe('10 sugestões');
  });

  it('vazio: mensagem de sem resultado (nunca lista vazia sem texto)', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('xyzw');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'vazio' });
    await esperar();
    expect(ctrl.snapshot()).toMatchObject({
      state: 'vazio',
      message: SERVICE_SEARCH_MESSAGES.sem_resultado,
      announcement: SERVICE_SEARCH_MESSAGES.sem_resultado,
    });
  });

  it('limite e falha usam mensagens proprias; falha de rede nunca vira "nenhum resultado"', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'erro', code: 'limite' });
    await esperar();
    expect(ctrl.snapshot()).toMatchObject({ state: 'limite', message: SERVICE_SEARCH_MESSAGES.limite });

    ctrl.input('pedre');
    r.avancar(250);
    c.chamadas[1]?.reject(new TypeError('rede caiu'));
    await esperar();
    expect(ctrl.snapshot()).toMatchObject({ state: 'falha', message: SERVICE_SEARCH_MESSAGES.falha });
    expect(ctrl.snapshot().message).not.toBe(SERVICE_SEARCH_MESSAGES.sem_resultado);
  });

  it('entrada_invalida do servidor volta a ocioso, sem texto', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'erro', code: 'entrada_invalida' });
    await esperar();
    expect(ctrl.snapshot()).toMatchObject({ state: 'ocioso', open: false, message: null });
  });

  it('o texto mostrado vem da tabela de codigos, nunca do servidor', async () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    r.avancar(250);
    c.chamadas[0]?.resolve({ status: 'erro', code: 'falha' });
    await esperar();
    expect(ctrl.snapshot().message).toBe('Não foi possível buscar agora. Tente de novo.');
  });
});

describe('teclado e escolha (§3.5 itens 5 e 6)', () => {
  async function comResultados() {
    const m = montar();
    m.ctrl.input('pedr');
    m.r.avancar(250);
    m.c.chamadas[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();
    return m;
  }

  it('setas movem entre itens com limite nas pontas; Enter escolhe o destacado', async () => {
    const { ctrl } = await comResultados();
    ctrl.moveHighlight(1);
    expect(ctrl.snapshot().highlighted).toBe(0);
    ctrl.moveHighlight(1);
    ctrl.moveHighlight(1);
    expect(ctrl.snapshot().highlighted).toBe(1);
    ctrl.moveHighlight(-1);
    ctrl.moveHighlight(-1);
    ctrl.moveHighlight(-1);
    expect(ctrl.snapshot().highlighted).toBe(0);
    expect(ctrl.confirmHighlighted()).toBe(true);
    expect(ctrl.snapshot().selected).toEqual(ITEM_A);
    expect(ctrl.snapshot().open).toBe(false);
  });

  it('Enter sem item destacado nao escolhe nada', async () => {
    const { ctrl, selecoes } = await comResultados();
    expect(ctrl.confirmHighlighted()).toBe(false);
    expect(selecoes).toEqual([]);
  });

  it('Esc fecha a lista e limpa o destaque, mantendo os itens', async () => {
    const { ctrl } = await comResultados();
    ctrl.moveHighlight(1);
    ctrl.escape();
    expect(ctrl.snapshot()).toMatchObject({ open: false, highlighted: -1 });
    expect(ctrl.snapshot().items).toHaveLength(2);
    expect(ctrl.confirmHighlighted()).toBe(false);
  });

  it('a escolha emite exatamente service_id, service_name, group_id e group_name', async () => {
    const { ctrl, selecoes } = await comResultados();
    ctrl.choose(1);
    expect(selecoes).toHaveLength(1);
    expect(Object.keys(selecoes[0] ?? {}).sort()).toEqual(
      ['group_id', 'group_name', 'service_id', 'service_name'],
    );
    expect(ctrl.choose(9)).toBe(false);
  });

  it('digitar de novo depois de escolher limpa a escolha e emite null', async () => {
    const { ctrl, selecoes } = await comResultados();
    ctrl.choose(0);
    ctrl.input('pedre');
    expect(ctrl.snapshot().selected).toBeNull();
    expect(selecoes).toEqual([ITEM_A, null]);
  });
});

describe('sem armazenamento e sem URL (§3.5 item 7)', () => {
  it('nao escreve em localStorage, sessionStorage nem Cache, e o termo nao vai a nenhuma URL', async () => {
    const espioes = {
      setItem: vi.fn(),
      put: vi.fn(),
    };
    const g = globalThis as unknown as Record<string, unknown>;
    const antigos = { localStorage: g['localStorage'], sessionStorage: g['sessionStorage'], caches: g['caches'] };
    g['localStorage'] = { setItem: espioes.setItem };
    g['sessionStorage'] = { setItem: espioes.setItem };
    g['caches'] = { open: espioes.put };
    try {
      const { ctrl, r, c } = montar();
      ctrl.input('pedr');
      r.avancar(250);
      expect(c.chamadas[0]?.q).toBe('pedr');
      c.chamadas[0]?.resolve({ status: 'ok', items: [ITEM_A] });
      await esperar();
      expect(espioes.setItem).not.toHaveBeenCalled();
      expect(espioes.put).not.toHaveBeenCalled();
    } finally {
      g['localStorage'] = antigos.localStorage;
      g['sessionStorage'] = antigos.sessionStorage;
      g['caches'] = antigos.caches;
    }
  });

  it('dispose cancela o temporizador pendente', () => {
    const { ctrl, r, c } = montar();
    ctrl.input('pedr');
    ctrl.dispose();
    r.avancar(1000);
    expect(c.chamadas).toEqual([]);
    expect(r.pendentes()).toBe(0);
  });
});

describe('announceCount', () => {
  it('singular para 1 e plural para os demais', () => {
    expect(announceCount(1)).toBe('1 sugestão');
    expect(announceCount(0)).toBe('0 sugestões');
    expect(announceCount(7)).toBe('7 sugestões');
  });
});
