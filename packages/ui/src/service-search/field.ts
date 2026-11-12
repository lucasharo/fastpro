// H-019 | Elemento de tela do campo de busca de servico (docs/factory/64-DESENHO-H019.md, §3.5 itens 4 a 6).
// Padrao combobox/listbox: o foco fica no campo e o item destacado vai por aria-activedescendant. Texto
// sempre por textContent (nunca innerHTML). Toda a decisao (debounce, estados, teclado) fica no controlador.
import {
  createServiceSearchController,
  type ServiceSearchController,
  type ServiceSearchFetchResult,
  type ServiceSearchItem,
  type ServiceSearchSnapshot,
  type ServiceSearchTimer,
} from './controller.js';

export const SERVICE_SEARCH_LABEL = 'Qual serviço você precisa?' as const;

export interface ServiceSearchFieldOptions {
  readonly fetchSearch: (q: string, signal: AbortSignal) => Promise<ServiceSearchFetchResult>;
  readonly onSelect: (item: ServiceSearchItem | null) => void;
  readonly label?: string;
  readonly idPrefix?: string;
  readonly debounceMs?: number;
  readonly minChars?: number;
  readonly timer?: ServiceSearchTimer;
}

export interface ServiceSearchField {
  readonly input: HTMLInputElement;
  readonly listbox: HTMLElement;
  readonly liveRegion: HTMLElement;
  /** Remove a tela e cancela consultas e temporizadores. */
  destroy(): void;
}

let sequencia = 0;

function criarElemento<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  atributos: Readonly<Record<string, string>> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [nome, valor] of Object.entries(atributos)) el.setAttribute(nome, valor);
  return el;
}

/** Monta o campo dentro do contenedor e liga o teclado, o toque e o controlador. */
export function mountServiceSearchField(
  container: HTMLElement,
  opts: ServiceSearchFieldOptions,
): ServiceSearchField {
  sequencia += 1;
  const id = opts.idPrefix ?? `servico-busca-${sequencia}`;
  const idLista = `${id}-lista`;
  const idOpcao = (i: number) => `${id}-opcao-${i}`;

  const raiz = criarElemento('div', { class: 'service-search' });
  const rotulo = criarElemento('label', { for: `${id}-campo` });
  rotulo.textContent = opts.label ?? SERVICE_SEARCH_LABEL;
  const input = criarElemento('input', {
    id: `${id}-campo`,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': idLista,
  });
  const listbox = criarElemento('ul', { id: idLista, role: 'listbox', hidden: '' });
  const mensagem = criarElemento('p', { id: `${id}-mensagem`, class: 'service-search-message', hidden: '' });
  // Regiao viva: so anuncia (quantidade, vazio, falha, limite, carregamento). Nao e a lista.
  const liveRegion = criarElemento('div', { role: 'status', 'aria-live': 'polite', id: `${id}-anuncio` });

  raiz.append(rotulo, input, listbox, mensagem, liveRegion);
  container.append(raiz);

  let itensMontados: readonly ServiceSearchItem[] | null = null;
  let anuncioAnterior = '';

  const desenhar = (s: ServiceSearchSnapshot): void => {
    const mostrarLista = s.open && s.items.length > 0;
    input.setAttribute('aria-expanded', String(mostrarLista));
    listbox.hidden = !mostrarLista;

    if (itensMontados !== s.items) {
      itensMontados = s.items;
      listbox.replaceChildren();
      s.items.forEach((item, i) => {
        const li = criarElemento('li', { id: idOpcao(i), role: 'option', 'aria-selected': 'false' });
        const nome = criarElemento('span', { class: 'service-search-name' });
        nome.textContent = item.service_name;
        const grupo = criarElemento('span', { class: 'service-search-group' });
        grupo.textContent = item.group_name;
        li.append(nome, ' · ', grupo);
        li.addEventListener('mousedown', (ev) => ev.preventDefault());
        li.addEventListener('click', () => ctrl.choose(i));
        listbox.append(li);
      });
    }

    listbox.querySelectorAll('[role="option"]').forEach((li, i) => {
      li.setAttribute('aria-selected', String(i === s.highlighted));
    });
    if (mostrarLista && s.highlighted >= 0) {
      input.setAttribute('aria-activedescendant', idOpcao(s.highlighted));
    } else {
      input.removeAttribute('aria-activedescendant');
    }

    if (s.message !== null) {
      mensagem.textContent = s.message;
      mensagem.hidden = false;
    } else {
      mensagem.textContent = '';
      mensagem.hidden = true;
    }

    if (s.announcement !== anuncioAnterior) {
      anuncioAnterior = s.announcement;
      liveRegion.textContent = s.announcement;
    }

    if (s.selected !== null) {
      input.value = s.selected.service_name;
    }
  };

  const ctrl: ServiceSearchController = createServiceSearchController({
    fetchSearch: opts.fetchSearch,
    onUpdate: desenhar,
    onSelect: opts.onSelect,
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
    ...(opts.minChars !== undefined ? { minChars: opts.minChars } : {}),
    ...(opts.timer !== undefined ? { timer: opts.timer } : {}),
  });

  const aoDigitar = (): void => ctrl.input(input.value);
  const aoTeclar = (ev: KeyboardEvent): void => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      ctrl.moveHighlight(1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      ctrl.moveHighlight(-1);
    } else if (ev.key === 'Enter') {
      if (ctrl.confirmHighlighted()) ev.preventDefault();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ctrl.escape();
      input.focus();
    }
  };
  input.addEventListener('input', aoDigitar);
  input.addEventListener('keydown', aoTeclar);

  desenhar(ctrl.snapshot());

  return {
    input,
    listbox,
    liveRegion,
    destroy(): void {
      input.removeEventListener('input', aoDigitar);
      input.removeEventListener('keydown', aoTeclar);
      ctrl.dispose();
      raiz.remove();
    },
  };
}
