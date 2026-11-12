// @vitest-environment happy-dom
// H-019 | Elemento de tela do campo de busca (docs/factory/64-DESENHO-H019.md, §3.5 itens 4 a 6, T-H019-07).
// DOM simulado (happy-dom) e relogio falso. Dados sinteticos. Sem rede e sem armazenamento.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountServiceSearchField,
  SERVICE_SEARCH_LABEL,
  type ServiceSearchField,
} from '../src/service-search/field.js';
import {
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

let container: HTMLElement;
let campo: ServiceSearchField | undefined;
let pendentes: Array<{ q: string; resolve(r: ServiceSearchFetchResult): void; signal: AbortSignal }>;
let selecoes: Array<ServiceSearchItem | null>;

function montar(overrides: { idPrefix?: string } = {}): ServiceSearchField {
  campo = mountServiceSearchField(container, {
    fetchSearch: (q, signal) =>
      new Promise<ServiceSearchFetchResult>((resolve) => {
        pendentes.push({ q, resolve, signal });
      }),
    onSelect: (item) => selecoes.push(item),
    idPrefix: overrides.idPrefix ?? 'busca',
  });
  return campo;
}

const digitar = (input: HTMLInputElement, texto: string) => {
  input.value = texto;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const tecla = (el: HTMLElement, key: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};
const esperar = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
  pendentes = [];
  selecoes = [];
});

afterEach(() => {
  campo?.destroy();
  campo = undefined;
  vi.useRealTimers();
});

describe('estrutura de acessibilidade (padrao combobox/listbox)', () => {
  it('campo e combobox, rotulado, com listbox controlado e fechado no inicio', () => {
    const f = montar();
    const input = f.input;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('aria-controls')).toBe(f.listbox.id);
    expect(f.listbox.getAttribute('role')).toBe('listbox');
    expect(f.listbox.hidden).toBe(true);
    const rotulo = container.querySelector('label');
    expect(rotulo?.textContent).toBe(SERVICE_SEARCH_LABEL);
    expect(rotulo?.getAttribute('for')).toBe(input.id);
  });

  it('a regiao viva tem role status e aria-live polite', () => {
    const f = montar();
    expect(f.liveRegion.getAttribute('role')).toBe('status');
    expect(f.liveRegion.getAttribute('aria-live')).toBe('polite');
  });
});

describe('resultados, teclado e escolha', () => {
  it('mostra opcoes com nome e grupo, anuncia a quantidade e marca aria-expanded', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();
    expect(f.input.getAttribute('aria-expanded')).toBe('true');
    expect(f.listbox.hidden).toBe(false);
    const opcoes = f.listbox.querySelectorAll('[role="option"]');
    expect(opcoes).toHaveLength(2);
    expect(opcoes[0]?.textContent).toBe('Pedreiro · Obras');
    expect(f.liveRegion.textContent).toBe('2 sugestões');
  });

  it('setas movem o destaque por aria-activedescendant; Enter escolhe e preenche o campo', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();

    tecla(f.input, 'ArrowDown');
    expect(f.input.getAttribute('aria-activedescendant')).toBe(`${f.listbox.id.replace('-lista', '')}-opcao-0`);
    expect(f.listbox.querySelectorAll('[role="option"]')[0]?.getAttribute('aria-selected')).toBe('true');
    tecla(f.input, 'ArrowDown');
    expect(f.listbox.querySelectorAll('[role="option"]')[1]?.getAttribute('aria-selected')).toBe('true');

    tecla(f.input, 'Enter');
    expect(f.input.value).toBe('Servente de pedreiro');
    expect(selecoes).toEqual([ITEM_B]);
    expect(Object.keys(selecoes[0] ?? {}).sort()).toEqual(['group_id', 'group_name', 'service_id', 'service_name']);
    expect(f.listbox.hidden).toBe(true);
    expect(f.input.getAttribute('aria-expanded')).toBe('false');
    expect(f.input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('Esc fecha a lista, limpa o destaque e devolve o foco ao campo', async () => {
    const outro = document.createElement('button');
    container.append(outro);
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();
    outro.focus();
    f.input.focus();
    tecla(f.input, 'ArrowDown');
    tecla(f.input, 'Escape');
    expect(f.listbox.hidden).toBe(true);
    expect(f.input.getAttribute('aria-expanded')).toBe('false');
    expect(f.input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.activeElement).toBe(f.input);
    expect(selecoes).toEqual([]);
  });

  it('clicar numa opcao escolhe o item sem tirar o foco do campo', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'ok', items: [ITEM_A, ITEM_B] });
    await esperar();
    const opcao = f.listbox.querySelectorAll('[role="option"]')[0] as HTMLElement;
    opcao.dispatchEvent(new Event('mousedown', { bubbles: true, cancelable: true }));
    opcao.click();
    expect(selecoes).toEqual([ITEM_A]);
    expect(f.input.value).toBe('Pedreiro');
  });

  it('digitar de novo depois de escolher emite a limpeza da escolha (null)', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'ok', items: [ITEM_A] });
    await esperar();
    tecla(f.input, 'Enter');
    expect(selecoes).toEqual([]);
    tecla(f.input, 'ArrowDown');
    tecla(f.input, 'Enter');
    digitar(f.input, 'pedreir');
    expect(selecoes.at(-1)).toBeNull();
  });
});

describe('vazio, falha e termo curto', () => {
  it('vazio mostra a mensagem visivel e a mesma frase na regiao viva', async () => {
    const f = montar();
    digitar(f.input, 'xyzw');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({ status: 'vazio' });
    await esperar();
    const msg = container.querySelector('.service-search-message') as HTMLElement;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toBe(SERVICE_SEARCH_MESSAGES.sem_resultado);
    expect(f.liveRegion.textContent).toBe(SERVICE_SEARCH_MESSAGES.sem_resultado);
    expect(f.listbox.hidden).toBe(true);
  });

  it('falha do servidor mostra mensagem de falha, nunca "nenhum resultado"', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    // Resposta de erro do servidor: o controlador mostra a mensagem de falha.
    pendentes[0]?.resolve({ status: 'erro', code: 'falha' });
    await esperar();
    expect(f.liveRegion.textContent).toBe(SERVICE_SEARCH_MESSAGES.falha);
  });

  it('termo com menos de 2 caracteres nao consulta e nao mostra nada', async () => {
    const f = montar();
    digitar(f.input, 'p');
    await vi.advanceTimersByTimeAsync(1000);
    expect(pendentes).toHaveLength(0);
    expect(f.listbox.hidden).toBe(true);
    expect(f.liveRegion.textContent).toBe('');
  });
});

describe('seguranca do texto na tela', () => {
  it('nome com marcacao vira texto literal (sem elemento criado)', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    await vi.advanceTimersByTimeAsync(250);
    pendentes[0]?.resolve({
      status: 'ok',
      items: [{ ...ITEM_A, service_name: '<b>x</b><img src=x>' }],
    });
    await esperar();
    const opcao = f.listbox.querySelector('[role="option"]');
    expect(opcao?.querySelector('b')).toBeNull();
    expect(opcao?.querySelector('img')).toBeNull();
    expect(opcao?.textContent).toContain('<b>x</b><img src=x>');
  });
});

describe('ciclo de vida', () => {
  it('destroy remove a tela e cancela a consulta pendente', async () => {
    const f = montar();
    digitar(f.input, 'pedr');
    f.destroy();
    campo = undefined;
    await vi.advanceTimersByTimeAsync(1000);
    expect(pendentes).toHaveLength(0);
    expect(container.querySelector('.service-search')).toBeNull();
  });
});
