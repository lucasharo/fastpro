// H-020 | Componente AddressField (docs/factory/56-DESENHO-H020.md, §1). Modulo ES do navegador, sem
// dependencias. Controlador (logica) separado da visao: o controlador recebe relogio, temporizador e
// cliente de rede por injecao, para testar com relogio falso. O navegador so fala com a propria API
// (POST /api/v1/geo/address-suggest), nunca com provedor externo. Nada e guardado em armazenamento do navegador.
// O campo continua sendo texto editavel: o envio do pedido nunca depende de sugestao.

export const ADDRESS_MIN_CHARS = 3;
export const ADDRESS_MAX_CHARS = 120;
export const ADDRESS_DEBOUNCE_MS = 300;
export const ADDRESS_ENDPOINT = '/api/v1/geo/address-suggest';
/** Mensagem neutra da falha (CA-10). Sem detalhe tecnico. */
export const ADDRESS_NEUTRAL_MESSAGE =
  'Não foi possível sugerir endereços agora. Digite o endereço normalmente.';
/** Tempo de espera quando a resposta traz limite sem retry_after_s (desenho §1, padrao 60 s). */
const LIMITE_PADRAO_S = 60;

/** Normaliza para contagem: NFC, sem controles, espacos colapsados (mesma regra da API). */
export function normalizeQuery(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contarCaracteres(texto) {
  return [...texto].length;
}

/**
 * Controlador puro. `request(body, signal)` devolve uma resposta com `ok`, `status` e `json()`.
 * `timers` = { setTimeout, clearTimeout }. `now()` devolve epoca em ms. `onState(estado)` recebe cada mudanca.
 */
export function createSuggestController({ context, request, timers, now, onState }) {
  let valor = '';
  let temporizador = null;
  let geracao = 0;
  let abortador = null;
  let bloqueadoAte = 0;
  let desligadoNestaPagina = false;
  let estado = { status: 'vazio', items: [], ativo: -1, mensagem: '' };

  const emitir = (mudanca) => {
    estado = { ...estado, ...mudanca };
    onState(estado);
  };

  /** Cancela timer e consulta em voo; qualquer resposta que chegar depois sera ignorada. */
  function cancelar() {
    if (temporizador !== null) {
      timers.clearTimeout(temporizador);
      temporizador = null;
    }
    if (abortador !== null) {
      abortador.abort();
      abortador = null;
    }
    geracao += 1;
  }

  async function consultar(q) {
    const minha = geracao;
    const ac = new globalThis.AbortController();
    abortador = ac;
    let resposta;
    let corpo;
    try {
      resposta = await request({ q, context }, ac.signal);
      corpo = await resposta.json();
    } catch {
      if (minha !== geracao) return;
      abortador = null;
      emitir({ status: 'falha', items: [], ativo: -1, mensagem: ADDRESS_NEUTRAL_MESSAGE });
      return;
    }
    if (minha !== geracao) return;
    abortador = null;
    tratarResposta(corpo);
  }

  function tratarResposta(corpo) {
    if (corpo && corpo.mode === 'ok' && Array.isArray(corpo.items)) {
      const labels = corpo.items
        .map((item) => (item && typeof item.label === 'string' ? item.label : null))
        .filter((label) => label !== null);
      if (labels.length === 0) {
        emitir({ status: 'sem_resultado', items: [], ativo: -1, mensagem: '' });
      } else {
        emitir({ status: 'lista', items: labels, ativo: -1, mensagem: '' });
      }
      return;
    }
    if (corpo && corpo.mode === 'texto_livre') {
      if (corpo.reason === 'limite') {
        const segundos = Number.isFinite(corpo.retry_after_s) ? corpo.retry_after_s : LIMITE_PADRAO_S;
        bloqueadoAte = now() + segundos * 1000;
        emitir({ status: 'texto_livre', items: [], ativo: -1, mensagem: '' });
        return;
      }
      if (corpo.reason === 'cota' || corpo.reason === 'desligado') {
        // Sem consulta ate recarregar a pagina; sem mensagem de erro (CA-08).
        desligadoNestaPagina = true;
        emitir({ status: 'texto_livre', items: [], ativo: -1, mensagem: '' });
        return;
      }
    }
    // indisponivel ou formato inesperado: mensagem neutra, sem nova tentativa (CA-10, CA-11).
    emitir({ status: 'falha', items: [], ativo: -1, mensagem: ADDRESS_NEUTRAL_MESSAGE });
  }

  return {
    /** Texto atual do campo (e o unico dado que vai ao formulario). */
    getValue() {
      return valor;
    },
    getState() {
      return estado;
    },
    /** Tecla digitada: cancela a anterior e agenda a consulta, respeitando o minimo e o limite. */
    input(texto) {
      valor = String(texto ?? '');
      cancelar();
      const q = normalizeQuery(valor);
      const n = contarCaracteres(q);
      if (n < ADDRESS_MIN_CHARS) {
        emitir({ status: 'vazio', items: [], ativo: -1, mensagem: '' });
        return;
      }
      if (n > ADDRESS_MAX_CHARS) {
        emitir({ status: 'vazio', items: [], ativo: -1, mensagem: '' });
        return;
      }
      if (desligadoNestaPagina || now() < bloqueadoAte) {
        emitir({ status: 'texto_livre', items: [], ativo: -1, mensagem: '' });
        return;
      }
      temporizador = timers.setTimeout(() => {
        temporizador = null;
        void consultar(q);
      }, ADDRESS_DEBOUNCE_MS);
    },
    /** Escolha de uma sugestao: copia o rotulo para o campo e descarta a lista. Nao consulta de novo. */
    choose(indice) {
      const rotulo = estado.items[indice];
      if (typeof rotulo !== 'string') return null;
      cancelar();
      valor = rotulo;
      emitir({ status: 'vazio', items: [], ativo: -1, mensagem: '' });
      return rotulo;
    },
    /** Esc, perda de foco e campo limpo: descartam a lista (CA-05). */
    discard() {
      cancelar();
      emitir({ status: 'vazio', items: [], ativo: -1, mensagem: '' });
    },
    /** Movimento do teclado dentro da lista (aria-activedescendant). */
    move(delta) {
      if (estado.items.length === 0) return;
      const total = estado.items.length;
      const atual = estado.ativo < 0 ? (delta > 0 ? -1 : 0) : estado.ativo;
      emitir({ ativo: (atual + delta + total) % total });
    },
  };
}

/**
 * Visao minima. `input` (campo de texto), `list` (lista de opcoes) e `aviso` (regiao viva) sao elementos
 * do DOM. Os rotulos entram sempre por textContent (nunca HTML). Padrao combobox: role, aria-controls,
 * aria-activedescendant. Retorna o controlador para quem chama (o formulario le getValue()).
 */
export function mountAddressField({ input, list, aviso, context, request, timers, now }) {
  const doc = list.ownerDocument;
  list.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  aviso.setAttribute('role', 'status');
  aviso.setAttribute('aria-live', 'polite');

  const controlador = createSuggestController({
    context,
    request,
    timers,
    now,
    onState: (estado) => render(estado),
  });

  function render(estado) {
    list.textContent = '';
    estado.items.forEach((rotulo, indice) => {
      const opcao = doc.createElement('li');
      opcao.setAttribute('role', 'option');
      opcao.setAttribute('id', `${list.id}-${indice}`);
      opcao.setAttribute('aria-selected', String(indice === estado.ativo));
      opcao.textContent = rotulo;
      // mousedown (e nao click) para escolher antes de o campo perder o foco.
      opcao.addEventListener('mousedown', (evento) => {
        evento.preventDefault();
        escolher(indice);
      });
      list.appendChild(opcao);
    });
    const aberta = estado.items.length > 0;
    input.setAttribute('aria-expanded', String(aberta));
    if (aberta && estado.ativo >= 0) {
      input.setAttribute('aria-activedescendant', `${list.id}-${estado.ativo}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    aviso.textContent = estado.mensagem ?? '';
  }

  function escolher(indice) {
    const rotulo = controlador.choose(indice);
    if (rotulo !== null) input.value = rotulo;
  }

  input.addEventListener('input', () => controlador.input(input.value));
  input.addEventListener('blur', () => controlador.discard());
  input.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      controlador.move(1);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      controlador.move(-1);
    } else if (evento.key === 'Enter') {
      const ativo = controlador.getState().ativo;
      if (ativo >= 0) {
        evento.preventDefault();
        escolher(ativo);
      }
    } else if (evento.key === 'Escape') {
      controlador.discard();
    }
  });

  return controlador;
}

/** Cliente de rede do navegador: so a propria API, mesma origem, sem cache. */
export function apiRequest(fetchImpl) {
  return (body, signal) =>
    fetchImpl(ADDRESS_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
}
