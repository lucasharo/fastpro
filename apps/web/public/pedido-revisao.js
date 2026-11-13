// H-030 (Issue #43) | Pagina /pedido/revisao (docs/factory/90-DESENHO-H030.md, §5.2 e §5.3). A leitura so consulta a
// revisao (nao altera nada). Confirmar e o unico gatilho do POST de confirmacao, e so por clique (CA-06).
// Sem innerHTML, sem coordenada, sem armazenamento do navegador. Nada e publicado nesta etapa (CA-07).
import {
  PEDIDO_TEXTOS,
  PEDIDO_URGENCIAS,
  criarControladorConfirmacao,
  interpretarRevisao,
  resumoFaltando,
} from '/pedido-logica.js';

const CAMINHOS = Object.freeze({
  revisao: '/api/v1/drafts/current/review',
  confirma: '/api/v1/drafts/current/confirm',
});

const doc = globalThis.document;
const el = (id) => doc.getElementById(id);

let contentRev = null;

async function chamar(caminho, opcoes = {}) {
  const resposta = await globalThis.fetch(caminho, {
    method: opcoes.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers:
      opcoes.body === undefined
        ? { Accept: 'application/json' }
        : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: opcoes.body,
  });
  const corpo = await resposta.json().catch(() => null);
  return { status: resposta.status, corpo };
}

function setEstado(texto) {
  el('estado').textContent = texto;
}

function mostrarSecao(id) {
  for (const secao of ['secao-revisao', 'secao-vazia', 'secao-email', 'secao-campos']) {
    el(secao).hidden = secao !== id;
  }
}

function bloquearPagina(ativo, texto) {
  el('pedido-raiz').setAttribute('aria-busy', String(ativo));
  setEstado(texto);
}

function rotuloUrgencia(valor) {
  return PEDIDO_URGENCIAS.find((u) => u.valor === valor)?.rotulo ?? PEDIDO_TEXTOS.naoInformado;
}

/** Preenche os blocos de leitura com o texto exato do banco (sem campo de coordenada). */
function preencherBlocos(view) {
  el('v-servico').textContent = view.service?.name || PEDIDO_TEXTOS.naoInformado;
  el('v-endereco').textContent = view.address_text || PEDIDO_TEXTOS.naoInformado;
  el('v-urgencia').textContent = rotuloUrgencia(view.urgency);
  el('v-descricao').textContent = view.description || PEDIDO_TEXTOS.naoInformado;
  el('v-identificacao').textContent = `${view.first_name} · ${view.email}`;
}

function mostrarRevisao(confirmadoEm) {
  mostrarSecao('secao-revisao');
  const confirmado = Boolean(confirmadoEm);
  el('confirmado').hidden = !confirmado;
  el('confirmado').textContent = confirmado ? PEDIDO_TEXTOS.confirmado : '';
  el('confirmar').hidden = confirmado;
  el('editar-pedido').hidden = !confirmado;
  el('titulo').focus();
}

// ---------- confirmacao expressa (CA-06, CA-08) ----------

const confirmacao = criarControladorConfirmacao({
  enviar: (rev) => chamar(CAMINHOS.confirma, { method: 'POST', body: JSON.stringify({ content_rev: rev }) }),
  onEstado: aoEstadoConfirmacao,
});

function aoEstadoConfirmacao(estado) {
  const botao = el('confirmar');
  el('confirmar-erro').textContent = '';
  if (estado.tipo === 'confirmando') {
    botao.disabled = true;
    botao.textContent = PEDIDO_TEXTOS.confirmando;
    el('pedido-raiz').setAttribute('aria-busy', 'true');
    return;
  }
  botao.disabled = false;
  botao.textContent = PEDIDO_TEXTOS.confirmar;
  el('pedido-raiz').setAttribute('aria-busy', 'false');
  if (estado.tipo === 'confirmado') {
    setEstado('');
    mostrarRevisao(estado.confirmedAt ?? new Date().toISOString());
    el('confirmado').focus();
    return;
  }
  if (estado.tipo === 'conteudo_alterado') {
    el('confirmar-erro').textContent = PEDIDO_TEXTOS.conteudoAlterado;
    carregar();
    return;
  }
  if (estado.tipo === 'email') {
    mostrarSecao('secao-email');
    return;
  }
  if (estado.tipo === 'campos') {
    el('confirmar-erro').textContent = resumoFaltando(estado.missing);
    return;
  }
  if (estado.tipo === 'vazio') {
    mostrarSecao('secao-vazia');
    return;
  }
  if (estado.tipo === 'limite') {
    el('confirmar-erro').textContent = PEDIDO_TEXTOS.muitasTentativas;
    return;
  }
  el('confirmar-erro').textContent = PEDIDO_TEXTOS.falhaConfirmar;
}

// ---------- leitura da revisao ----------

function falhaCarregar() {
  bloquearPagina(false, PEDIDO_TEXTOS.carregandoFalhou);
  el('carregar-de-novo').hidden = false;
}

async function carregar() {
  el('carregar-de-novo').hidden = true;
  bloquearPagina(true, PEDIDO_TEXTOS.carregando);
  try {
    const resposta = await chamar(CAMINHOS.revisao);
    const estado = interpretarRevisao(resposta.status, resposta.corpo);
    if (estado.tipo === 'pronto') {
      preencherBlocos(estado.view);
      contentRev = estado.view.content_rev;
      bloquearPagina(false, '');
      mostrarRevisao(estado.view.confirmed_at);
      return;
    }
    bloquearPagina(false, '');
    if (estado.tipo === 'vazio') {
      mostrarSecao('secao-vazia');
    } else if (estado.tipo === 'aguardando') {
      mostrarSecao('secao-email');
    } else if (estado.tipo === 'campos') {
      mostrarSecao('secao-campos');
      el('campos-texto').textContent = resumoFaltando(estado.missing);
    } else if (estado.tipo === 'limite') {
      setEstado(PEDIDO_TEXTOS.muitasTentativas);
    } else {
      falhaCarregar();
    }
  } catch {
    falhaCarregar();
  }
}

function ligar() {
  el('confirmar').addEventListener('click', () => {
    if (contentRev === null) return;
    confirmacao.confirmar(contentRev);
  });
  el('carregar-de-novo').addEventListener('click', carregar);
  carregar();
}

ligar();
