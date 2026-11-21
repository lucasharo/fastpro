// #155 (desenho 178, §7.1, S5) | Tela "Meus pedidos": le a lista do proprio cliente em GET /api/v1/requests (mesma origem).
// Sem sessao (401/403) redireciona para a entrada e nao mostra dado. Falha de rede ou 5xx mostra "Tentar de novo".
// Sem telefone, e-mail, endereco nem foto: so o que PANEL_ITEM_KEYS entrega. Sem innerHTML: so textContent.
import { decidirSonda, montarEntrada } from '/navegacao-logica.js';

export const ROTULO_STATUS = Object.freeze({
  publicado: 'Publicado',
  selecionado: 'Profissional selecionado',
  concluido: 'Concluído',
  cancelado: 'Cancelado'
});

export const ROTULO_PRAZO = Object.freeze({
  aberto: 'Aceites abertos',
  encerrado: 'Prazo de aceites encerrado'
});

export const TEXTOS = Object.freeze({
  carregando: 'Carregando seus pedidos…',
  vazio: 'Você ainda não publicou pedidos.',
  erro: 'Não foi possível carregar seus pedidos agora. Tente de novo em instantes.',
  tentar: 'Tentar de novo',
  maisPedidos: 'Carregar mais',
  publicadoEm: 'Publicado em'
});

const CABECALHO_REQUISICAO = Object.freeze({
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  headers: { Accept: 'application/json' }
});

/** Data curta em portugues, ou nulo se o texto nao for uma data. */
export function formatarDataCurta(iso) {
  if (typeof iso !== 'string') return null;
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? null : data.toLocaleDateString('pt-BR');
}

/** Monta os textos de um item (so chaves conhecidas; valor fora do vocabulario vira nulo, nunca aparece cru). */
export function linhasDoItem(item) {
  const linhas = [];
  linhas.push({ papel: 'nome', texto: typeof item.serviceName === 'string' ? item.serviceName : 'Serviço' });
  if (Object.prototype.hasOwnProperty.call(ROTULO_STATUS, item.status)) {
    linhas.push({ papel: 'estado', texto: ROTULO_STATUS[item.status] });
  }
  if (Object.prototype.hasOwnProperty.call(ROTULO_PRAZO, item.prazo)) {
    linhas.push({ papel: 'prazo', texto: ROTULO_PRAZO[item.prazo] });
  }
  const data = formatarDataCurta(item.publishedAt);
  if (data) linhas.push({ papel: 'data', texto: `${TEXTOS.publicadoEm} ${data}` });
  return linhas;
}

/** Controlador da tela. `doc`, `fetchFn` e `navegar` entram por parametro (testavel sem navegador). */
export function iniciarPainel({ doc, fetchFn, navegar }) {
  const lista = doc.getElementById('lista');
  const estado = doc.getElementById('estado');
  const erroGeral = doc.getElementById('erro-geral');
  const tentar = doc.getElementById('tentar');
  const vazio = doc.getElementById('vazio');
  const mais = doc.getElementById('mais');
  const principal = doc.getElementById('conteudo');
  let proximoCursor = null;
  let primeiraCarga = true;

  function mostrarErro() {
    estado.textContent = '';
    erroGeral.textContent = TEXTOS.erro;
    tentar.hidden = false;
    principal.setAttribute('aria-busy', 'false');
  }

  function desenharItem(item) {
    const li = doc.createElement('li');
    li.className = 'painel-item';
    for (const linha of linhasDoItem(item)) {
      const p = doc.createElement('p');
      p.className = `painel-${linha.papel}`;
      p.textContent = linha.texto;
      li.appendChild(p);
    }
    return li;
  }

  async function carregar(cursor) {
    erroGeral.textContent = '';
    tentar.hidden = true;
    const url = cursor ? `/api/v1/requests?cursor=${encodeURIComponent(cursor)}` : '/api/v1/requests';
    let resposta;
    try {
      resposta = await fetchFn(url, CABECALHO_REQUISICAO);
    } catch {
      mostrarErro();
      return;
    }
    if (resposta.status !== 200) {
      if (decidirSonda(resposta.status) === 'entrar') {
        navegar(montarEntrada('cliente', '/painel'));
        return;
      }
      mostrarErro();
      return;
    }
    let corpo;
    try {
      corpo = await resposta.json();
    } catch {
      mostrarErro();
      return;
    }
    const itens = Array.isArray(corpo?.items) ? corpo.items : [];
    for (const item of itens) lista.appendChild(desenharItem(item));
    proximoCursor = typeof corpo?.nextCursor === 'string' && corpo.nextCursor ? corpo.nextCursor : null;
    mais.hidden = proximoCursor === null;
    estado.textContent = '';
    principal.setAttribute('aria-busy', 'false');
    vazio.hidden = lista.children.length > 0;
    if (primeiraCarga) {
      primeiraCarga = false;
      principal.querySelector('h1').focus();
    }
  }

  tentar.addEventListener('click', () => carregar(null));
  mais.addEventListener('click', () => {
    if (proximoCursor) carregar(proximoCursor);
  });

  return carregar(null);
}

if (typeof document !== 'undefined' && document.getElementById('lista')) {
  iniciarPainel({
    doc: document,
    fetchFn: (url, opcoes) => fetch(url, opcoes),
    navegar: (caminho) => location.replace(caminho)
  });
}
