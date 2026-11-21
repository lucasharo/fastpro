// H-030 (Issue #43) | Pagina /pedido/revisao (docs/factory/90-DESENHO-H030.md, §5.2 e §5.3). A leitura so consulta a
// revisao (nao altera nada). Confirmar e o unico gatilho do POST de confirmacao, e so por clique (CA-06).
// Sem innerHTML, sem coordenada, sem armazenamento do navegador. Nada e publicado nesta etapa (CA-07).
import {
  PEDIDO_TEXTOS,
  PEDIDO_URGENCIAS,
  criarControladorConfirmacao,
  interpretarRevisao,
  PUBLICACAO_TEXTOS,
  interpretarPublicacao,
  resumoFaltando,
  textoDaPublicacao,
  ackDuplicidadeSobrevive,
} from '/pedido-logica.js';

const CAMINHOS = Object.freeze({
  revisao: '/api/v1/drafts/current/review',
  confirma: '/api/v1/drafts/current/confirm',
  publica: '/api/v1/requests',
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
    headers: {
      ...(opcoes.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Accept: 'application/json',
      ...(opcoes.headers ?? {}),
    },
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
  el('publicar').hidden = !confirmado;
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
    if (rascunho !== null && estado.contentRev !== undefined) rascunho.contentRev = estado.contentRev;
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

// ---------- publicacao do pedido (H-031, #44; 110 §8) ----------
// Uma tentativa logica tem uma Idempotency-Key: o novo envio do mesmo conteudo (retry de rede) reusa a chave;
// qualquer resposta do servidor a libera e a proxima tentativa recebe outra.

let rascunho = null;
let tentativa = null;
let ackDuplicidade = null;
let publicando = false;

function corpoPublicacao() {
  const corpo = { draft_id: rascunho.id, content_rev: rascunho.contentRev };
  if (ackDuplicidade !== null) corpo.duplicate_ack = ackDuplicidade;
  return JSON.stringify(corpo);
}

function chaveDaTentativa(corpo) {
  if (tentativa === null || tentativa.corpo !== corpo) {
    tentativa = { chave: globalThis.crypto.randomUUID(), corpo };
  }
  return tentativa.chave;
}

function aoEstadoPublicacao(estado) {
  const botao = el('publicar');
  const emCurso = estado.tipo === 'publicando';
  botao.disabled = emCurso;
  botao.textContent = emCurso ? PUBLICACAO_TEXTOS.publicando : PUBLICACAO_TEXTOS.publicar;
  el('pedido-raiz').setAttribute('aria-busy', String(emCurso));
  el('publicar-erro').textContent = '';
  el('publicar-acesso').hidden = true;
  if (estado.tipo !== 'duplicidade') el('secao-duplicidade').hidden = true;
  if (!emCurso && !ackDuplicidadeSobrevive(estado)) ackDuplicidade = null;
  if (emCurso) return;
  if (estado.tipo === 'publicado') {
    el('resultado-publicacao').textContent = `${PUBLICACAO_TEXTOS.publicado} ${PUBLICACAO_TEXTOS.aceitesAte(estado.acceptanceDeadlineAt)}`;
    el('resultado-publicacao').hidden = false;
    el('depois-publicar').hidden = false;
    botao.hidden = true;
    el('confirmado').hidden = true;
    el('editar-pedido').hidden = true;
    el('titulo').focus();
    return;
  }
  if (estado.tipo === 'duplicidade') {
    ackDuplicidade = estado.ackToken;
    el('secao-duplicidade').hidden = false;
    el('duplicidade-revisar').focus();
    return;
  }
  if (estado.tipo === 'conteudo_alterado') {
    el('publicar-erro').textContent = PUBLICACAO_TEXTOS.conteudoAlterado;
    carregar();
    return;
  }
  el('publicar-erro').textContent = estado.tipo === 'campos' ? resumoFaltando(estado.missing) : textoDaPublicacao(estado.tipo);
  if (estado.tipo === 'sessao') {
    el('publicar-acesso').hidden = false;
    el('titulo').focus();
  } else if (estado.tipo === 'vencido') {
    el('titulo').focus();
  } else if (estado.tipo === 'endereco' || estado.tipo === 'limite_enderecos') {
    el('e-endereco').focus();
  } else {
    botao.focus();
  }
}

async function publicar() {
  if (publicando || rascunho === null) return;
  const corpo = corpoPublicacao();
  const chave = chaveDaTentativa(corpo);
  publicando = true;
  aoEstadoPublicacao({ tipo: 'publicando' });
  let resposta;
  try {
    resposta = await chamar(CAMINHOS.publica, { method: 'POST', body: corpo, headers: { 'Idempotency-Key': chave } });
  } catch {
    // Falha de rede: a tentativa e o aviso de duplicidade ficam guardados; o proximo clique reusa a mesma chave.
    publicando = false;
    aoEstadoPublicacao({ tipo: 'indisponivel', manterAck: true });
    return;
  }
  publicando = false;
  tentativa = null;
  aoEstadoPublicacao(interpretarPublicacao(resposta.status, resposta.corpo));
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
      rascunho = { id: estado.view.id, contentRev: estado.view.content_rev };
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
  el('publicar').addEventListener('click', publicar);
  el('duplicidade-publicar').addEventListener('click', publicar);
  el('duplicidade-revisar').addEventListener('click', () => {
    ackDuplicidade = null;
    el('secao-duplicidade').hidden = true;
    el('publicar').focus();
  });
  el('confirmar').addEventListener('click', () => {
    if (contentRev === null) return;
    confirmacao.confirmar(contentRev);
  });
  el('carregar-de-novo').addEventListener('click', carregar);
  carregar();
}

ligar();
