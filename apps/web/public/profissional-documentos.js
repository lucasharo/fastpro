// H-037 (#50) | Tela de envio do documento de identidade (docs/factory/107-DESENHO-H037.md §3, §8; CA-20).
// Modulo ES do navegador, sem dependencias. O controlador recebe a funcao de rede e a de envio ao Storage por
// injecao, para testar sem rede. So fala com a propria API (mesma origem) e com a URL de envio de uso unico.
// Nao reduz no navegador nesta fase (decisao 223): o original (ate 5 MiB) vai ao Storage e o servidor reduz.
// Nada e guardado em localStorage, sessionStorage ou cookie. O nome do arquivo nunca sai do navegador.

export const DOCUMENTOS_ENDPOINT = '/api/v1/professional/documents';
export const EMISSAO_ENDPOINT = DOCUMENTOS_ENDPOINT + '/uploads';
export const LIMITE_IMAGEM_BYTES = 5242880;
export const LIMITE_PDF_BYTES = 2097152;
export const TIPOS_ACEITOS = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

// Codigos de 422 que significam "o arquivo nao serve" (107 §3). Os demais 422 sao falha nossa, nao do arquivo.
const CODIGOS_DE_CONTEUDO = Object.freeze([
  'pdf_invalido',
  'pdf_protegido',
  'pdf_ativo',
  'imagem_invalida',
  'imagem_grande_demais',
  'nao_cabe_no_limite'
]);

// Textos vem de packages/domain/src/identity-docs/textos.ts (IDOC_TEXTOS); a tela nao inventa texto. Unica excecao:
// 'enviando', aprovado em 107 §6 e ausente de textos.ts (lacuna a fechar no dominio; o teste estatico registra a excecao).
export const MENSAGENS = Object.freeze({
  vazio: 'Envie seu documento de identidade. Aceitos: foto JPG, PNG ou WebP de até 5 MB, ou PDF de até 2 MB.',
  enviando: 'Enviando documento...',
  recebido: 'Documento recebido. A equipe de verificação vai analisar.',
  tipo: 'Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF.',
  tamanhoImagem: 'Esta imagem é grande demais. Escolha uma imagem de até 5 MB.',
  tamanhoPdf: 'Este PDF tem mais de 2 MB. Envie um arquivo menor.',
  limite: 'Você já enviou o máximo de 5 documentos.',
  falha: 'Não foi possível enviar. Tente de novo.',
  muitas: 'Muitas tentativas. Tente mais tarde.',
  sessao: 'Entre de novo para enviar.',
  conteudo: 'Não foi possível aceitar este arquivo. Envie outra foto ou outro PDF do documento.',
  estadoPerfil: 'Não é possível enviar documentos agora. Fale com a equipe de verificação.'
});

/** Tipo declarado pelo navegador, se for um dos quatro aceitos; senao null (sem envio). */
export function tipoDeclarado(arquivo) {
  const tipo = arquivo && typeof arquivo.type === 'string' ? arquivo.type : '';
  return TIPOS_ACEITOS.includes(tipo) ? tipo : null;
}

export function limiteDoTipo(tipo) {
  return tipo === 'application/pdf' ? LIMITE_PDF_BYTES : LIMITE_IMAGEM_BYTES;
}

/** Conferencia local antes de qualquer chamada: tipo e tamanho declarados. A decisao final e do servidor. */
export function verificarArquivo(arquivo) {
  const tipo = tipoDeclarado(arquivo);
  if (tipo === null) return { ok: false, mensagem: MENSAGENS.tipo };
  if (!Number.isInteger(arquivo.size) || arquivo.size < 1) return { ok: false, mensagem: MENSAGENS.conteudo };
  if (arquivo.size > limiteDoTipo(tipo)) {
    return { ok: false, mensagem: tipo === 'application/pdf' ? MENSAGENS.tamanhoPdf : MENSAGENS.tamanhoImagem };
  }
  return { ok: true, tipo };
}

/** Corpo da emissao: so estas tres chaves. O nome do arquivo nunca e enviado. */
export function corpoEmissao(clientUploadId, tipo, bytes) {
  return { client_upload_id: clientUploadId, content_type: tipo, size_bytes: bytes };
}

/** Mensagem fixa por contexto, status e codigo da API. Nenhum texto ecoa o valor enviado. */
export function mensagemDeErro(contexto, status, codigo, tipo) {
  if (status === 401) return MENSAGENS.sessao;
  if (status === 429) return MENSAGENS.muitas;
  if (status === 403 && codigo === 'estado_perfil') return MENSAGENS.estadoPerfil;
  if (status === 415) return MENSAGENS.tipo;
  if (status === 413) return tipo === 'application/pdf' ? MENSAGENS.tamanhoPdf : MENSAGENS.tamanhoImagem;
  if (status === 422 && codigo === 'limite_documentos') return MENSAGENS.limite;
  if (status === 422 && CODIGOS_DE_CONTEUDO.includes(codigo)) return MENSAGENS.conteudo;
  return MENSAGENS.falha;
}

export function rotuloDeTipo(kind) {
  if (kind === 'imagem') return 'Foto';
  if (kind === 'pdf') return 'PDF';
  return 'Documento';
}

function codigoDe(resposta) {
  return resposta && resposta.corpo && typeof resposta.corpo.code === 'string' ? resposta.corpo.code : '';
}

function dataCurta(iso) {
  if (typeof iso !== 'string') return '';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR');
}

/**
 * Liga a tela: lista do dono, envio em duas etapas (emitir, PUT ao Storage, finalizar), cancelamento e repeticao
 * com o mesmo client_upload_id (107 §4). `buscar(url, opcoes)` devolve { status, corpo }. `enviarAoStorage(url,
 * arquivo, tipo, sinal)` devolve { ok }. `gerarId()` devolve um uuid novo. Envio duplo bloqueado (CA-11 de H-035).
 */
export function iniciarDocumentos(doc, buscar, enviarAoStorage, gerarId) {
  const el = (id) => doc.getElementById(id);
  const estado = el('estado');
  const alerta = el('alerta');
  const arquivo = el('arquivo');
  const cancelar = el('cancelar');
  const repetir = el('repetir');
  const lista = el('lista');
  const tituloLista = el('titulo-lista');

  let ocupado = false;
  let controle = null;
  let cancelado = false;
  let tentativa = null;

  function avisar(texto) {
    alerta.textContent = '';
    estado.textContent = texto;
  }

  function alertar(texto) {
    estado.textContent = '';
    alerta.textContent = texto;
  }

  function sincronizarBotoes() {
    arquivo.disabled = ocupado;
    cancelar.hidden = !ocupado;
    repetir.hidden = ocupado || tentativa === null;
    repetir.disabled = ocupado;
  }

  /** Solta o envio e atualiza os botoes. Chamada ANTES de qualquer foco: foco so cai em elemento visivel e habilitado. */
  function liberar() {
    ocupado = false;
    controle = null;
    sincronizarBotoes();
  }

  function renderizar(documentos) {
    lista.replaceChildren();
    for (const d of documentos) {
      const item = doc.createElement('li');
      const partes = [rotuloDeTipo(d.kind)];
      if (d.status !== 'em_envio' && dataCurta(d.receivedAt)) partes.push('recebido em ' + dataCurta(d.receivedAt));
      item.textContent = partes.join(' · ');
      if (d.deletable) {
        const excluir = doc.createElement('button');
        excluir.type = 'button';
        excluir.textContent = 'Excluir';
        excluir.addEventListener('click', () => excluirDocumento(d.id));
        item.appendChild(excluir);
      }
      lista.appendChild(item);
    }
  }

  /** Le a lista do dono. Devolve os documentos, ou null (com aviso de erro) quando a API nao respondeu 200. */
  async function carregarLista() {
    try {
      const resposta = await buscar(DOCUMENTOS_ENDPOINT, { method: 'GET' });
      if (resposta.status !== 200 || !resposta.corpo || !Array.isArray(resposta.corpo.documents)) {
        alertar(mensagemDeErro('lista', resposta.status, codigoDe(resposta), null));
        renderizar([]);
        return null;
      }
      renderizar(resposta.corpo.documents);
      return resposta.corpo.documents;
    } catch {
      alertar(MENSAGENS.falha);
      renderizar([]);
      return null;
    }
  }

  function erroDe(contexto, resposta, tipo) {
    return { mensagem: mensagemDeErro(contexto, resposta.status, codigoDe(resposta), tipo) };
  }

  function focarRecuperacao() {
    if (tentativa !== null) repetir.focus();
    else arquivo.focus();
  }

  async function enviar(arquivoEscolhido, clientUploadId) {
    const conferido = verificarArquivo(arquivoEscolhido);
    if (!conferido.ok) {
      alertar(conferido.mensagem);
      arquivo.focus();
      return;
    }
    const tipo = conferido.tipo;
    tentativa = { arquivo: arquivoEscolhido, clientUploadId };
    ocupado = true;
    cancelado = false;
    controle = new globalThis.AbortController();
    const sinal = controle.signal;
    avisar(MENSAGENS.enviando);
    sincronizarBotoes();
    try {
      const emissao = await buscar(EMISSAO_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoEmissao(clientUploadId, tipo, arquivoEscolhido.size)),
        signal: sinal
      });
      if (emissao.status !== 200 && emissao.status !== 201) throw erroDe('emissao', emissao, tipo);
      const corpo = emissao.corpo || {};
      if (typeof corpo.upload_url !== 'string') {
        // Repeticao de um envio ja recebido (200 sem URL): nada a enviar, so atualizar a lista.
        tentativa = null;
        await carregarLista();
        avisar(MENSAGENS.recebido);
        tituloLista.focus();
        return;
      }
      const envio = await enviarAoStorage(corpo.upload_url, arquivoEscolhido, tipo, sinal);
      if (!envio || envio.ok !== true) throw { mensagem: MENSAGENS.falha };
      const finalizacao = await buscar(DOCUMENTOS_ENDPOINT + '/' + encodeURIComponent(corpo.id) + '/finalize', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: sinal
      });
      if (finalizacao.status !== 200) throw erroDe('finalizacao', finalizacao, tipo);
      tentativa = null;
      await carregarLista();
      avisar(MENSAGENS.recebido);
      tituloLista.focus();
    } catch (erro) {
      if (cancelado) {
        tentativa = null;
        liberar();
        avisar(MENSAGENS.vazio);
        arquivo.focus();
        return;
      }
      alertar(erro && typeof erro.mensagem === 'string' ? erro.mensagem : MENSAGENS.falha);
      liberar();
      focarRecuperacao();
    } finally {
      liberar();
    }
  }

  async function excluirDocumento(id) {
    if (ocupado) return;
    ocupado = true;
    sincronizarBotoes();
    try {
      const resposta = await buscar(DOCUMENTOS_ENDPOINT + '/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
      if (resposta.status !== 204 && resposta.status !== 200) {
        alertar(mensagemDeErro('exclusao', resposta.status, codigoDe(resposta), null));
        alerta.focus();
        return;
      }
      const documentos = await carregarLista();
      if (documentos !== null) {
        avisar('');
        tituloLista.focus();
      }
    } catch {
      alertar(MENSAGENS.falha);
      alerta.focus();
    } finally {
      ocupado = false;
      sincronizarBotoes();
    }
  }

  arquivo.addEventListener('change', () => {
    const escolhido = arquivo.files && arquivo.files[0];
    if (!escolhido || ocupado) return;
    enviar(escolhido, gerarId());
  });

  cancelar.addEventListener('click', () => {
    if (controle === null) return;
    cancelado = true;
    controle.abort();
  });

  repetir.addEventListener('click', () => {
    if (ocupado || tentativa === null) return;
    enviar(tentativa.arquivo, tentativa.clientUploadId);
  });

  sincronizarBotoes();
  carregarLista().then((documentos) => {
    if (documentos !== null && documentos.length === 0) avisar(MENSAGENS.vazio);
  });
}

/** Rede do navegador: chamadas a /api/v1 (mesma origem, sem cookie de terceiros, sem referrer). */
export async function buscarNaApi(url, opcoes) {
  const resposta = await globalThis.fetch(url, opcoes);
  let corpo;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }
  return { status: resposta.status, corpo };
}

/** PUT direto ao Storage: sem cookie, sem referrer, o tipo declarado vai no cabecalho. */
export async function enviarAoStorageNavegador(url, arquivo, tipo, sinal) {
  const resposta = await globalThis.fetch(url, {
    method: 'PUT',
    body: arquivo,
    headers: { 'Content-Type': tipo },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: sinal
  });
  return { ok: resposta.ok === true };
}

// Navegador: liga a tela quando a pagina esta carregada. Nos testes nao ha documento global.
if (typeof globalThis.document !== 'undefined' && globalThis.document.getElementById('documentos')) {
  iniciarDocumentos(globalThis.document, buscarNaApi, enviarAoStorageNavegador, () => globalThis.crypto.randomUUID());
}
