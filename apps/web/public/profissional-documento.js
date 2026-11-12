// H-035 | Tela do cadastro do documento profissional (docs/factory/75-DESENHO-H035.md §2, §3; CA-11, CA-12, CA-13).
// Modulo ES do navegador, sem dependencias. O controlador recebe o documento e a funcao de rede por injecao, para
// testar sem rede. So fala com a propria API (PUT /api/v1/professional/profile, mesma origem). Nada e guardado em
// localStorage, sessionStorage ou cookie. Sucesso e duplicidade chegam com o mesmo corpo da API: a tela nao tem
// texto proprio para duplicidade, e a mensagem e sempre a de recebimento.

export const CADASTRO_ENDPOINT = '/api/v1/professional/profile';

export const MENSAGENS = Object.freeze({
  vazio: 'Escolha o tipo de documento e preencha o nome público e o número para enviar seu cadastro.',
  enviando: 'Enviando seu cadastro...',
  sucesso: 'Recebemos seu cadastro. Vamos analisar e avisar você.',
  campos: 'Confira os campos destacados.',
  naoAutenticado: 'Entre na sua conta para continuar.',
  emailNaoVerificado: 'Confirme seu e-mail antes de enviar o documento.',
  rede: 'Não foi possível enviar agora. Verifique sua conexão e tente de novo. Os dados continuam preenchidos.',
  indisponivel: 'Não foi possível salvar agora. Tente de novo em alguns minutos. Os dados continuam preenchidos.'
});

/** Mensagem por campo e motivo (motivos da API; o valor digitado nunca entra na mensagem). */
export function motivoParaCampo(campo, motivo) {
  if (campo === 'document') {
    if (motivo === 'tamanho') return 'CPF tem 11 números e CNPJ tem 14. Confira o número.';
    if (motivo === 'formato') return 'Use apenas números. Pontos, traços e barras são aceitos.';
    if (motivo === 'obrigatorio') return 'Informe o número do documento.';
    if (motivo === 'sequencia_repetida' || motivo === 'digito_verificador') {
      return 'Este número não é válido. Confira os dígitos.';
    }
  }
  if (campo === 'publicName') {
    if (motivo === 'obrigatorio') return 'Informe o nome público.';
    if (motivo === 'tamanho') return 'O nome público deve ter de 2 a 80 caracteres.';
    return 'Confira o nome público.';
  }
  if (campo === 'documentType') {
    return 'Escolha CPF ou CNPJ.';
  }
  return 'Confira este campo.';
}

/** Corpo do PUT a partir dos valores da tela (sem máscara obrigatória: a API normaliza). */
export function montarCorpo(valores) {
  return {
    publicName: valores.nome,
    documentType: valores.tipo,
    document: valores.documento
  };
}

const CAMPOS_VALIDOS = ['publicName', 'documentType', 'document'];

/**
 * Converte o status e o corpo da API no que a tela mostra. Sucesso (201 ou 200 no reenvio) e duplicidade
 * (201 igual) caem na mesma mensagem. Nenhum texto revela outro perfil nem o valor enviado.
 */
export function interpretarResposta(status, corpo) {
  if (status === 201 || status === 200) {
    return { resultado: 'sucesso', mensagem: MENSAGENS.sucesso, campos: [] };
  }
  if (status === 422) {
    const brutos = corpo && Array.isArray(corpo.fields) ? corpo.fields : [];
    const campos = brutos
      .filter((c) => c && CAMPOS_VALIDOS.includes(c.field))
      .map((c) => ({ campo: c.field, mensagem: motivoParaCampo(c.field, c.reason) }));
    return { resultado: 'campos', mensagem: MENSAGENS.campos, campos };
  }
  if (status === 401) {
    return { resultado: 'erro', mensagem: MENSAGENS.naoAutenticado, campos: [] };
  }
  if (status === 403 && corpo && corpo.code === 'email_nao_verificado') {
    return { resultado: 'erro', mensagem: MENSAGENS.emailNaoVerificado, campos: [] };
  }
  return { resultado: 'erro', mensagem: MENSAGENS.indisponivel, campos: [] };
}

async function lerCorpo(resposta) {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

/**
 * Liga a tela: formulario, campos, erros por campo e avisos. `buscar(url, opcoes)` faz a chamada HTTP.
 * Envio duplo bloqueado enquanto a resposta nao chega (CA-11). Erro de rede mantem os campos (CA-13).
 */
export function iniciarCadastro(doc, buscar) {
  const form = doc.getElementById('cadastro');
  const campos = {
    publicName: doc.getElementById('nome'),
    documentType: doc.getElementById('tipo'),
    document: doc.getElementById('documento')
  };
  const erros = {
    publicName: doc.getElementById('erro-nome'),
    documentType: doc.getElementById('erro-tipo'),
    document: doc.getElementById('erro-documento')
  };
  const dicas = {
    publicName: 'dica-nome',
    documentType: null,
    document: 'dica-documento'
  };
  const botao = doc.getElementById('salvar');
  const aviso = doc.getElementById('aviso');
  const alerta = doc.getElementById('alerta');
  let enviando = false;

  function descricaoDe(nome) {
    return [dicas[nome]].filter(Boolean).join(' ');
  }

  function limparErros() {
    for (const nome of CAMPOS_VALIDOS) {
      erros[nome].textContent = '';
      campos[nome].removeAttribute('aria-invalid');
      const descricao = descricaoDe(nome);
      if (descricao) campos[nome].setAttribute('aria-describedby', descricao);
      else campos[nome].removeAttribute('aria-describedby');
    }
  }

  function marcarErro(nome, mensagem) {
    erros[nome].textContent = mensagem;
    campos[nome].setAttribute('aria-invalid', 'true');
    const erroId = erros[nome].id;
    const descricao = [descricaoDe(nome), erroId].filter(Boolean).join(' ');
    campos[nome].setAttribute('aria-describedby', descricao);
  }

  function aplicar(r) {
    if (r.resultado === 'sucesso') {
      alerta.textContent = '';
      aviso.textContent = r.mensagem;
      // Sai da tela o numero que ja foi enviado (ele nao fica exposto depois do envio).
      campos.document.value = '';
      return;
    }
    aviso.textContent = '';
    alerta.textContent = r.mensagem;
    let primeiro = null;
    for (const c of r.campos) {
      marcarErro(c.campo, c.mensagem);
      if (primeiro === null) primeiro = c.campo;
    }
    if (primeiro !== null) campos[primeiro].focus();
  }

  function lerValores() {
    return {
      nome: campos.publicName.value,
      tipo: campos.documentType.value,
      documento: campos.document.value
    };
  }

  aviso.textContent = MENSAGENS.vazio;

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (enviando) return;
    enviando = true;
    botao.disabled = true;
    aviso.textContent = MENSAGENS.enviando;
    alerta.textContent = '';
    limparErros();

    buscar(CADASTRO_ENDPOINT, {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(montarCorpo(lerValores()))
    }).then(
      async (resposta) => {
        const corpo = await lerCorpo(resposta);
        aplicar(interpretarResposta(resposta.status, corpo));
      },
      () => aplicar({ resultado: 'erro', mensagem: MENSAGENS.rede, campos: [] })
    ).finally(() => {
      enviando = false;
      botao.disabled = false;
    });
  });
}

// Navegador: liga a tela quando a pagina do cadastro esta carregada. Nos testes nao ha documento global.
if (typeof globalThis.document !== 'undefined' && globalThis.document.getElementById('cadastro')) {
  iniciarCadastro(globalThis.document, (url, opcoes) => globalThis.fetch(url, opcoes));
}
