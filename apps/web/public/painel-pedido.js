/* global document, fetch, location */
// Detalhe do pedido do cliente (/painel/pedido?id=<uuid>): le GET /api/v1/requests/:id (mesma origem, sessao do dono).
// Sem sessao (401/403) manda para a entrada; pedido de outro cliente, vencido ou inexistente: 404 uniforme da API.
// Sem innerHTML: so textContent. Nenhum dado vai para armazenamento do navegador.
import { decidirSonda, montarEntrada } from '/navegacao-logica.js';
import { PEDIDO_URGENCIAS } from '/pedido-logica.js';
import { ROTULO_STATUS, formatarDataCurta } from '/painel.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TEXTOS_DETALHE = Object.freeze({
  naoEncontrado: 'Pedido não encontrado. Ele pode ter sido encerrado ou não pertence a esta conta.',
  erro: 'Não foi possível carregar o pedido agora. Tente de novo em instantes.',
  naoInformado: 'Não informado',
  abertos: 'Abertos até',
  encerrados: 'Prazo encerrado',
  coberturaCom: 'Há profissionais atendendo a sua região',
  coberturaSem: 'Ainda não há profissionais atendendo a sua região',
});

/** Id do pedido na busca da URL (?id=), ou nulo se nao for um uuid. */
export function idDaBusca(busca) {
  const id = new globalThis.URLSearchParams(busca).get('id');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** Textos de cada campo do detalhe (valor fora do vocabulario nunca aparece cru). */
export function camposDoDetalhe(p, agora = new Date()) {
  const prazo = p.acceptanceDeadlineAt ? new Date(p.acceptanceDeadlineAt) : null;
  const prazoAberto = prazo && !Number.isNaN(prazo.getTime()) && prazo > agora && p.status === 'publicado';
  return {
    titulo: typeof p.serviceName === 'string' ? p.serviceName : 'Pedido',
    status: ROTULO_STATUS[p.status] ?? TEXTOS_DETALHE.naoInformado,
    prazo: prazoAberto
      ? `${TEXTOS_DETALHE.abertos} ${prazo.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
      : TEXTOS_DETALHE.encerrados,
    publicado: formatarDataCurta(p.publishedAt) ?? TEXTOS_DETALHE.naoInformado,
    urgencia: PEDIDO_URGENCIAS.find((u) => u.valor === p.urgency)?.rotulo ?? TEXTOS_DETALHE.naoInformado,
    descricao: typeof p.description === 'string' && p.description ? p.description : TEXTOS_DETALHE.naoInformado,
    endereco: typeof p.addressText === 'string' && p.addressText ? p.addressText : TEXTOS_DETALHE.naoInformado,
    cobertura:
      p.cobertura === 'com' ? TEXTOS_DETALHE.coberturaCom : p.cobertura === 'sem' ? TEXTOS_DETALHE.coberturaSem : null,
  };
}

export function iniciarDetalhe({ doc, busca, fetchFn, navegar }) {
  const el = (id) => doc.getElementById(id);
  const principal = el('conteudo');
  const estado = el('estado');
  const erro = el('erro-geral');
  const tentar = el('tentar');
  const detalhe = el('detalhe');
  const id = idDaBusca(busca);

  function falhar(texto, comTentar) {
    estado.textContent = '';
    erro.textContent = texto;
    tentar.hidden = !comTentar;
    principal.setAttribute('aria-busy', 'false');
  }

  async function carregar() {
    erro.textContent = '';
    tentar.hidden = true;
    if (id === null) return falhar(TEXTOS_DETALHE.naoEncontrado, false);
    estado.textContent = 'Carregando o pedido…';
    let r;
    try {
      r = await fetchFn(`/api/v1/requests/${id}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return falhar(TEXTOS_DETALHE.erro, true);
    }
    if (decidirSonda(r.status) === 'entrar') return navegar(montarEntrada('cliente', '/painel'));
    if (r.status === 404) return falhar(TEXTOS_DETALHE.naoEncontrado, false);
    if (r.status !== 200) return falhar(TEXTOS_DETALHE.erro, true);
    let corpo;
    try {
      corpo = await r.json();
    } catch {
      return falhar(TEXTOS_DETALHE.erro, true);
    }
    const c = camposDoDetalhe(corpo ?? {});
    el('titulo').textContent = c.titulo;
    el('d-status').textContent = c.status;
    el('d-prazo').textContent = c.prazo;
    el('d-publicado').textContent = c.publicado;
    el('d-urgencia').textContent = c.urgencia;
    el('d-descricao').textContent = c.descricao;
    el('d-endereco').textContent = c.endereco;
    const cobertura = el('d-cobertura');
    cobertura.textContent = c.cobertura ?? '';
    cobertura.hidden = c.cobertura === null;
    cobertura.previousElementSibling.hidden = c.cobertura === null;
    estado.textContent = '';
    detalhe.hidden = false;
    principal.setAttribute('aria-busy', 'false');
    el('titulo').focus({ preventScroll: true });
  }

  tentar.addEventListener('click', () => carregar());
  return carregar();
}

if (typeof document !== 'undefined' && document.getElementById('detalhe')) {
  iniciarDetalhe({
    doc: document,
    busca: location.search,
    fetchFn: (url, opcoes) => fetch(url, opcoes),
    navegar: (caminho) => location.replace(caminho),
  });
}
