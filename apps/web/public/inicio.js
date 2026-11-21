// Issue #153 | Visao da pagina inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §4, §5 e §8, fatias 2 e 3).
// Liga o DOM aos controladores: busca de servico (criarControladorBusca, de pedido-logica.js), sugestao de endereco
// (mountAddressField com contexto request_draft) e as regras de "Continuar" (inicio-logica.js). Sem HTML montado por texto (so
// textContent, sem HTML dinamico), sem armazenamento do navegador, sem cookie (o servidor cuida do cookie), sem log.
import { mountAddressField, apiRequest } from './address-field.js';
import { criarControladorBusca } from './pedido-logica.js';
import {
  INICIO_CAMPOS,
  INICIO_TEXTOS,
  decidirCriacao,
  interpretarEscrita,
  interpretarRascunhoAtual,
  montarCorpo,
  textoDoErro,
  validarCampos,
} from './inicio-logica.js';

const CAMINHOS = Object.freeze({
  atual: '/api/v1/drafts/current',
  rascunho: '/api/v1/drafts',
  busca: '/api/v1/catalog/service-search',
});
/** Destino literal: sem consulta, sem fragmento e sem dado pessoal na URL (desenho §7). */
const PAGINA_PEDIDO = '/pedido';

/**
 * Liga a pagina. `janela` e o objeto global (document, fetch, location, timers). Recebido por parametro
 * para o teste rodar sem navegador. No navegador, o modulo chama ligarPagina(globalThis) ao carregar.
 */
export function ligarPagina(janela) {
  const doc = janela.document;
  const el = (id) => doc.getElementById(id);
  const tempo = {
    setTimeout: (fn, ms) => janela.setTimeout(fn, ms),
    clearTimeout: (id) => janela.clearTimeout(id),
  };
  const fetchImpl = (...args) => janela.fetch(...args);

  let servicoId = null;
  let opcoes = [];
  let ativo = -1;
  let ocupado = false;
  let corpoPendente = null;

  /** Chamada a propria API (mesma origem, sem cache, sem redirecionamento). Devolve status e corpo JSON ou null. */
  async function chamar(caminho, opc = {}) {
    const resposta = await fetchImpl(caminho, {
      method: opc.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers:
        opc.body === undefined
          ? { Accept: 'application/json' }
          : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: opc.body,
    });
    const corpo = await resposta.json().catch(() => null);
    return { status: resposta.status, corpo };
  }

  // ---------- erros por campo e aviso geral ----------

  function erroCampo(campo, texto) {
    el(campo).setAttribute('aria-invalid', texto ? 'true' : 'false');
    el(`${campo}-erro`).textContent = texto;
  }

  function limparErros() {
    erroCampo(INICIO_CAMPOS.servico, '');
    erroCampo(INICIO_CAMPOS.endereco, '');
  }

  function mostrarErros(erros) {
    for (const erro of erros) erroCampo(erro.campo, erro.texto);
    el(erros[0].campo).focus();
  }

  function setEstado(texto) {
    el('estado').textContent = texto;
  }

  /** Botao "Continuar" desabilitado e "Aguarde…" durante o envio (aria-busy na raiz). */
  function travar(ativoAgora) {
    ocupado = ativoAgora;
    el('inicio-raiz').setAttribute('aria-busy', String(ativoAgora));
    const botao = el('continuar');
    botao.disabled = ativoAgora;
    botao.textContent = ativoAgora ? INICIO_TEXTOS.aguarde : INICIO_TEXTOS.continuar;
  }

  function falhar(tipo) {
    travar(false);
    setEstado(textoDoErro(tipo));
  }

  // ---------- busca de servico (lista com teclado, padrao combobox) ----------

  function desenharLista() {
    const lista = el('servico-lista');
    const campo = el('servico');
    lista.textContent = '';
    opcoes.forEach((item, indice) => {
      const li = doc.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('id', `servico-lista-${indice}`);
      li.setAttribute('aria-selected', String(indice === ativo));
      li.textContent = item.service_name;
      // mousedown (e nao click) para escolher antes de o campo perder o foco.
      li.addEventListener('mousedown', (evento) => {
        evento.preventDefault();
        escolherServico(indice);
      });
      lista.appendChild(li);
    });
    campo.setAttribute('aria-expanded', String(opcoes.length > 0));
    if (opcoes.length > 0 && ativo >= 0) campo.setAttribute('aria-activedescendant', `servico-lista-${ativo}`);
    else campo.removeAttribute('aria-activedescendant');
  }

  function limparLista() {
    opcoes = [];
    ativo = -1;
    desenharLista();
  }

  function renderizarBusca(estado) {
    const aviso = el('servico-aviso');
    aviso.textContent = '';
    opcoes = [];
    ativo = -1;
    if (estado.tipo === 'resultado') {
      opcoes = (estado.items ?? []).filter(
        (item) => item && typeof item.service_id === 'string' && typeof item.service_name === 'string',
      );
      if (opcoes.length === 0) aviso.textContent = INICIO_TEXTOS.buscaSemResultado;
    } else if (estado.tipo === 'sem_resultado') {
      aviso.textContent = INICIO_TEXTOS.buscaSemResultado;
    } else if (estado.tipo === 'erro') {
      aviso.textContent = INICIO_TEXTOS.buscaFalhou;
    } else if (estado.tipo === 'limite') {
      aviso.textContent = INICIO_TEXTOS.muitasTentativas;
    }
    desenharLista();
  }

  const busca = criarControladorBusca({
    enviar: (q) => chamar(CAMINHOS.busca, { method: 'POST', body: JSON.stringify({ q }) }),
    agendar: tempo.setTimeout,
    cancelar: tempo.clearTimeout,
    onEstado: renderizarBusca,
  });

  function escolherServico(indice) {
    const item = opcoes[indice];
    if (!item) return;
    servicoId = item.service_id;
    el('servico').value = item.service_name;
    limparLista();
    el('servico-aviso').textContent = INICIO_TEXTOS.servicoEscolhido;
    erroCampo(INICIO_CAMPOS.servico, '');
  }

  function teclarServico(evento) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      if (opcoes.length === 0) return;
      evento.preventDefault();
      const total = opcoes.length;
      const passo = evento.key === 'ArrowDown' ? 1 : -1;
      const base = ativo < 0 ? (passo > 0 ? -1 : 0) : ativo;
      ativo = (base + passo + total) % total;
      desenharLista();
    } else if (evento.key === 'Enter') {
      if (ativo >= 0) {
        evento.preventDefault();
        escolherServico(ativo);
      }
    } else if (evento.key === 'Escape') {
      limparLista();
    }
  }

  // ---------- endereco (componente compartilhado, contexto do rascunho) ----------

  mountAddressField({
    input: el('endereco'),
    list: el('endereco-lista'),
    aviso: el('endereco-aviso'),
    context: 'request_draft',
    request: apiRequest(fetchImpl),
    timers: tempo,
    now: () => Date.now(),
  });

  // ---------- "Continuar" (ramos da decisao 941) ----------

  async function gravar(metodo, corpo) {
    const caminho = metodo === 'POST' ? CAMINHOS.rascunho : CAMINHOS.atual;
    const resposta = await chamar(caminho, { method: metodo, body: JSON.stringify(corpo) });
    return interpretarEscrita(resposta.status);
  }

  function mostrarConfirmacao() {
    travar(false);
    el('continuar').hidden = true;
    el('substituir').hidden = false;
    el('substituir-titulo').focus();
  }

  function esconderConfirmacao() {
    el('substituir').hidden = true;
    el('continuar').hidden = false;
  }

  async function continuar() {
    if (ocupado) return;
    limparErros();
    setEstado('');
    const campos = { servicoId, endereco: el('endereco').value };
    const erros = validarCampos(campos);
    if (erros.length > 0) {
      mostrarErros(erros);
      return;
    }
    travar(true);
    const corpo = montarCorpo(campos);
    try {
      const resposta = await chamar(CAMINHOS.atual);
      const atual = interpretarRascunhoAtual(resposta.status, resposta.corpo);
      if (atual.tipo === 'indisponivel') return falhar('falha');
      const decisao = decidirCriacao({ atual: atual.tipo === 'rascunho' ? atual.view : null, servicoId });
      if (decisao === 'confirmar') {
        corpoPendente = corpo;
        mostrarConfirmacao();
        return;
      }
      const escrita = await gravar(decisao === 'criar' ? 'POST' : 'PATCH', corpo);
      if (escrita.tipo !== 'ok') return falhar(escrita.tipo);
      janela.location.assign(PAGINA_PEDIDO);
    } catch {
      falhar('falha');
    }
  }

  async function trocarEContinuar() {
    if (ocupado || corpoPendente === null) return;
    travar(true);
    try {
      const escrita = await gravar('PATCH', corpoPendente);
      if (escrita.tipo !== 'ok') {
        esconderConfirmacao();
        return falhar(escrita.tipo);
      }
      janela.location.assign(PAGINA_PEDIDO);
    } catch {
      esconderConfirmacao();
      falhar('falha');
    }
  }

  // ---------- ligacao ----------

  el('formulario').addEventListener('submit', (evento) => {
    evento.preventDefault();
    continuar();
  });

  el('servico').addEventListener('input', () => {
    servicoId = null;
    const digitado = el('servico').value;
    el('servico-aviso').textContent = digitado.trim().length >= 2 ? INICIO_TEXTOS.buscando : '';
    busca.digitar(digitado);
  });
  el('servico').addEventListener('keydown', teclarServico);
  el('servico').addEventListener('blur', () => limparLista());

  el('substituir-trocar').addEventListener('click', trocarEContinuar);
  el('substituir-voltar').addEventListener('click', () => janela.location.assign(PAGINA_PEDIDO));

  limparLista();
}

// Carrega sozinho no navegador. Os testes chamam ligarPagina() com um DOM simulado.
if (typeof globalThis.document !== 'undefined' && typeof globalThis.location !== 'undefined') {
  ligarPagina(globalThis);
}
