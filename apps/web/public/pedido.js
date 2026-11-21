// H-030 (Issue #43) | Pagina /pedido (docs/factory/90-DESENHO-H030.md, §5.1 e §5.3). Visao: liga o DOM aos controladores de
// pedido-logica.js e desenha o estado que eles devolvem. Sem innerHTML (so textContent), sem armazenamento do navegador,
// sem envio de e-mail nesta etapa: o link e pedido pela rota de identificacao (#26). O clique em "Revisar pedido" e o
// unico gatilho do envio de identificacao; depois dele a pessoa segue para /fotos e, em seguida, para a revisao em /pedido/revisao.
import { mountAddressField, apiRequest } from './address-field.js';
import {
  PEDIDO_TEXTOS,
  PEDIDO_ROTULOS,
  criarControladorBusca,
  criarControladorEspera,
  criarControladorSalvamento,
  descricaoDentroDoLimite,
  faltandoParaRevisao,
  interpretarRevisao,
  PEDIDO_DESCRICAO_MAX,
} from './pedido-logica.js';

const CAMINHOS = Object.freeze({
  rascunho: '/api/v1/drafts',
  atual: '/api/v1/drafts/current',
  revisao: '/api/v1/drafts/current/review',
  identidade: '/api/v1/drafts/current/identity',
  busca: '/api/v1/catalog/service-search',
  desafio: '/api/v1/auth/challenges',
  verifica: '/api/v1/auth/challenges/verify',
  paginaFotos: '/fotos',
});

/** Campo da tela para cada campo da revisao (o id do erro e id + "-erro", exceto os de identificacao). */
const CAMPO_TELA = Object.freeze({
  service_id: 'servico',
  address_text: 'endereco',
  urgency: 'urgencia',
  description: 'descricao',
  first_name: 'nome',
  email: 'email',
});

const TEXTO = Object.freeze({
  aguarde: 'Aguarde…',
  codigoErro: 'Código inválido ou vencido. Confira e tente de novo.',
  codigoFormato: 'Digite os 6 dígitos do código.',
  escolhido: 'Serviço já escolhido. Para trocar, pesquise outro.',
  campoObrigatorio: 'Preencha este campo.',
  identidadeFalhou: 'Confira o nome e o e-mail e tente de novo.',
  contadorSufixo: `de ${PEDIDO_DESCRICAO_MAX} caracteres`,
});

const doc = globalThis.document;
const el = (id) => doc.getElementById(id);
const tempo = {
  agendar: (fn, ms) => globalThis.setTimeout(fn, ms),
  cancelar: (id) => globalThis.clearTimeout(id),
};

let servicoId = null;
let criado = false;
let emailAtual = '';

function setEstado(texto) {
  el('estado').textContent = texto;
}

/** Chamada a propria API (mesma origem, sem cache, sem redirecionamento). Devolve status e corpo JSON. */
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

const textoOuNulo = (valor) => (String(valor ?? '').trim() === '' ? null : valor);

function lerCampos() {
  return {
    service_id: servicoId,
    address_text: el('endereco').value,
    urgency: el('urgencia').value || null,
    description: el('descricao').value,
    first_name: el('nome').value.trim(),
    email: el('email').value.trim(),
  };
}

// ---------- erros por campo ----------

function erroCampo(campo, texto) {
  const entrada = el(campo);
  const erro = el(`${campo}-erro`);
  if (entrada) entrada.setAttribute('aria-invalid', texto ? 'true' : 'false');
  if (erro) erro.textContent = texto;
}

function limparErros() {
  for (const campo of Object.values(CAMPO_TELA)) erroCampo(campo, '');
  el('resumo-erro').textContent = '';
}

/** Resumo no topo com links para os campos, foco no resumo (CA-03, §5.3). */
function mostrarFaltando(faltantes) {
  const resumo = el('resumo-erro');
  resumo.textContent = '';
  resumo.appendChild(doc.createTextNode(PEDIDO_TEXTOS.faltaPrefixo));
  faltantes.forEach((campo, indice) => {
    if (indice > 0) resumo.appendChild(doc.createTextNode(', '));
    const link = doc.createElement('a');
    link.href = `#${CAMPO_TELA[campo]}`;
    link.textContent = PEDIDO_ROTULOS[campo] ?? campo;
    resumo.appendChild(link);
    erroCampo(CAMPO_TELA[campo], TEXTO.campoObrigatorio);
  });
  resumo.appendChild(doc.createTextNode('.'));
  resumo.focus();
}

// ---------- salvamento do rascunho ----------

const salvador = criarControladorSalvamento({
  enviar: async (parcial) => {
    const metodo = criado ? 'PATCH' : 'POST';
    const caminho = criado ? CAMINHOS.atual : CAMINHOS.rascunho;
    const resposta = await chamar(caminho, { method: metodo, body: JSON.stringify(parcial) });
    if (resposta.status >= 200 && resposta.status < 300) criado = true;
    return { status: resposta.status };
  },
  agendar: tempo.agendar,
  cancelar: tempo.cancelar,
  onEstado: ({ tipo }) => {
    if (tipo === 'erro_salvar') setEstado(PEDIDO_TEXTOS.salvarFalhou);
    if (tipo === 'vazio') criado = false;
  },
});

// ---------- busca de servico (H-019) ----------

function renderizarBusca(estado) {
  const lista = el('servico-lista');
  const aviso = el('servico-aviso');
  lista.textContent = '';
  aviso.textContent = '';
  if (estado.tipo === 'resultado') {
    for (const item of estado.items) {
      const li = doc.createElement('li');
      const botao = doc.createElement('button');
      botao.type = 'button';
      botao.textContent = item.service_name;
      botao.addEventListener('click', () => escolherServico(item));
      li.appendChild(botao);
      lista.appendChild(li);
    }
  } else if (estado.tipo === 'sem_resultado') {
    aviso.textContent = PEDIDO_TEXTOS.buscaSemResultado;
  } else if (estado.tipo === 'erro') {
    aviso.textContent = PEDIDO_TEXTOS.buscaFalhou;
  } else if (estado.tipo === 'limite') {
    aviso.textContent = PEDIDO_TEXTOS.muitasTentativas;
  }
}

const busca = criarControladorBusca({
  enviar: (q) => chamar(CAMINHOS.busca, { method: 'POST', body: JSON.stringify({ q }) }),
  agendar: tempo.agendar,
  cancelar: tempo.cancelar,
  onEstado: renderizarBusca,
});

function escolherServico(item) {
  servicoId = item.service_id;
  el('servico').value = item.service_name;
  el('servico-lista').textContent = '';
  el('servico-aviso').textContent = '';
  erroCampo('servico', '');
  salvador.alterar({ service_id: servicoId });
}

// ---------- preenchimento e carregamento ----------

function bloquear(ativo, texto) {
  el('pedido-raiz').setAttribute('aria-busy', String(ativo));
  for (const controle of el('formulario').querySelectorAll('input, select, textarea, button')) {
    controle.disabled = ativo;
  }
  setEstado(texto);
}

function atualizarContador() {
  const tamanho = el('descricao').value.length;
  el('descricao-contador').textContent = `${tamanho} ${TEXTO.contadorSufixo}`;
}

function preencher(view) {
  servicoId = view.service_id ?? null;
  el('servico-aviso').textContent = servicoId ? TEXTO.escolhido : '';
  el('endereco').value = view.address_text ?? '';
  if (view.urgency) el('urgencia').value = view.urgency;
  else el('urgencia').selectedIndex = -1;
  el('descricao').value = view.description ?? '';
  atualizarContador();
}

function falhaCarregar() {
  bloquear(false, PEDIDO_TEXTOS.carregandoFalhou);
  el('carregar-de-novo').hidden = false;
}

async function carregar() {
  el('carregar-de-novo').hidden = true;
  bloquear(true, PEDIDO_TEXTOS.carregando);
  try {
    const atual = await chamar(CAMINHOS.atual);
    if (atual.status === 200) {
      preencher(atual.corpo);
      criado = true;
    } else if (atual.status === 404) {
      criado = false;
    } else {
      falhaCarregar();
      return;
    }
    const identidade = await chamar(CAMINHOS.identidade);
    if (identidade.status === 200) {
      el('nome').value = identidade.corpo.first_name ?? '';
      el('email').value = identidade.corpo.email ?? '';
    }
    bloquear(false, '');
  } catch {
    falhaCarregar();
  }
}

// ---------- espera do e-mail (Confira seu e-mail) ----------

function mostrarFormulario() {
  espera.parar();
  el('secao-email').hidden = true;
  el('secao-formulario').hidden = false;
}

function mostrarEspera(email) {
  emailAtual = email;
  el('secao-formulario').hidden = true;
  el('secao-email').hidden = false;
  el('email-texto').textContent = `Se ${email} estiver correto, o código de 6 dígitos chega em alguns minutos. Confira também a caixa de spam.`;
  el('titulo-email').focus();
  espera.iniciar();
}

async function consultarRevisao() {
  const resposta = await chamar(CAMINHOS.revisao);
  return interpretarRevisao(resposta.status, resposta.corpo);
}

function aoFimDaEspera(estado) {
  if (estado.tipo === 'pronto') {
    globalThis.location.assign(CAMINHOS.paginaFotos);
    return;
  }
  if (estado.tipo === 'campos') {
    mostrarFormulario();
    mostrarFaltando(estado.missing);
    return;
  }
  if (estado.tipo === 'vazio') {
    mostrarFormulario();
    criado = false;
    setEstado(PEDIDO_TEXTOS.vazioRevisao);
    return;
  }
  if (estado.tipo === 'expirou') {
    setEstado(PEDIDO_TEXTOS.expirou);
  }
}

const espera = criarControladorEspera({
  consultar: consultarRevisao,
  agendar: tempo.agendar,
  cancelar: tempo.cancelar,
  agora: () => Date.now(),
  visivel: () => doc.visibilityState === 'visible',
  onEstado: aoFimDaEspera,
});

async function enviarDesafio(email) {
  const resposta = await chamar(CAMINHOS.desafio, {
    method: 'POST',
    body: JSON.stringify({ email, purpose: 'publish' }),
  });
  if (resposta.status >= 200 && resposta.status < 300) {
    mostrarEspera(email);
    return true;
  }
  setEstado(resposta.status === 429 ? PEDIDO_TEXTOS.muitasTentativas : PEDIDO_TEXTOS.enviarLinkFalhou);
  return false;
}

async function validarCodigo() {
  const codigo = el('codigo').value.trim();
  el('codigo-erro').textContent = '';
  if (!/^[0-9]{6}$/.test(codigo)) {
    el('codigo-erro').textContent = TEXTO.codigoFormato;
    return;
  }
  const resposta = await chamar(CAMINHOS.verifica, {
    method: 'POST',
    body: JSON.stringify({ email: emailAtual, code: codigo, purpose: 'publish' }),
  });
  if (resposta.status >= 200 && resposta.status < 300) {
    espera.consultarAgora();
    return;
  }
  el('codigo-erro').textContent = resposta.status === 429 ? PEDIDO_TEXTOS.muitasTentativas : TEXTO.codigoErro;
}

// ---------- "Revisar pedido" ----------

async function revisar() {
  limparErros();
  const campos = lerCampos();
  const faltantes = faltandoParaRevisao(campos);
  if (faltantes.length > 0) {
    mostrarFaltando(faltantes);
    return;
  }
  if (!descricaoDentroDoLimite(campos.description)) {
    erroCampo('descricao', `A descrição tem no máximo ${PEDIDO_DESCRICAO_MAX} caracteres.`);
    el('descricao').focus();
    return;
  }
  const botao = el('revisar');
  botao.disabled = true;
  botao.textContent = TEXTO.aguarde;
  try {
    const salvou = await salvador.liberar();
    if (!salvou) {
      setEstado(PEDIDO_TEXTOS.salvarFalhou);
      return;
    }
    const identidade = await chamar(CAMINHOS.identidade, {
      method: 'PUT',
      body: JSON.stringify({ first_name: campos.first_name, email: campos.email }),
    });
    if (identidade.status === 200) {
      await enviarDesafio(campos.email);
    } else if (identidade.status === 404) {
      criado = false;
      setEstado(PEDIDO_TEXTOS.vazioRevisao);
    } else if (identidade.status === 429) {
      setEstado(PEDIDO_TEXTOS.muitasTentativas);
    } else if (identidade.status === 422 || identidade.status === 400) {
      erroCampo('nome', identidade.status === 422 ? TEXTO.identidadeFalhou : '');
      setEstado(TEXTO.identidadeFalhou);
    } else {
      setEstado(PEDIDO_TEXTOS.salvarFalhou);
    }
  } catch {
    setEstado(PEDIDO_TEXTOS.salvarFalhou);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Revisar pedido';
  }
}

// ---------- ligacao ----------

function ligar() {
  el('urgencia').selectedIndex = -1;

  el('servico').addEventListener('input', () => {
    servicoId = null;
    salvador.alterar({ service_id: null });
    busca.digitar(el('servico').value);
  });

  mountAddressField({
    input: el('endereco'),
    list: el('endereco-lista'),
    aviso: el('endereco-aviso'),
    context: 'request_draft',
    request: apiRequest((...args) => globalThis.fetch(...args)),
    timers: { setTimeout: tempo.agendar, clearTimeout: tempo.cancelar },
    now: () => Date.now(),
  });
  const salvarEndereco = () => salvador.alterar({ address_text: textoOuNulo(el('endereco').value) });
  el('endereco').addEventListener('input', salvarEndereco);
  el('endereco').addEventListener('change', salvarEndereco);
  el('endereco').addEventListener('blur', salvarEndereco);
  // A escolha de uma sugestao muda o valor sem evento de digitacao: salva logo depois do clique.
  el('endereco-lista').addEventListener('mousedown', () => tempo.agendar(salvarEndereco, 0));

  el('urgencia').addEventListener('change', () => salvador.alterar({ urgency: el('urgencia').value || null }));

  el('descricao').addEventListener('input', () => {
    atualizarContador();
    salvador.alterar({ description: textoOuNulo(el('descricao').value) });
  });

  el('formulario').addEventListener('submit', (evento) => {
    evento.preventDefault();
    revisar();
  });

  el('carregar-de-novo').addEventListener('click', carregar);
  el('validar-codigo').addEventListener('click', validarCodigo);
  el('ja-confirmei').addEventListener('click', () => espera.consultarAgora());
  el('reenviar').addEventListener('click', () => enviarDesafio(emailAtual));
  el('corrigir-email').addEventListener('click', () => {
    mostrarFormulario();
    el('email').focus();
  });
  doc.addEventListener('visibilitychange', () => espera.aoVisibilidade(doc.visibilityState === 'visible'));

  carregar();
}

ligar();
