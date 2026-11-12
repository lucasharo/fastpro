// H-013 (Issue #26) | Modulo do codigo de 6 digitos (docs/factory/91-DESENHO-H013.md, §5; CA-12).
// montarCodigo(raiz, { email?, purpose?, buscar?, aoConfirmar?, mensagemFinal? }) monta o formulario dentro de raiz.
// Reutilizavel: a etapa "Confira seu e-mail" da #43 so embute o modulo. Na pagina isolada (/codigo), o modulo
// liga sozinho ao elemento #codigo-raiz.
// Nada sensivel fica no navegador: e-mail e codigo so em memoria; nunca em URL, localStorage, sessionStorage,
// cookie ou console. Textos fixos por status: a resposta nunca mostra motivo nem tentativas restantes.
(function (janela) {
  'use strict';

  var CAMINHO_PEDIDO = '/api/v1/auth/challenges';
  var CAMINHO_VERIFICA = '/api/v1/auth/challenges/verify';
  var CAMINHO_SESSAO = '/api/v1/auth/session';
  var ERROS_ATE_AJUDA = 3;

  var TEXTOS = {
    rotuloCodigo: 'Código de 6 dígitos',
    instrucaoCodigo: 'Digite os 6 números do e-mail. Cole também vale.',
    rotuloEmail: 'E-mail',
    confirmar: 'Confirmar código',
    novo: 'Pedir novo código',
    confirmado: 'Código confirmado.',
    acessoConfirmado: 'Acesso confirmado. A próxima etapa será liberada em breve.',
    enviado: 'Se o e-mail estiver cadastrado, enviamos um novo código.',
    emailInvalido: 'Informe um e-mail válido para pedir o código.',
    invalido: 'Código incorreto ou vencido. Confira e tente de novo.',
    ajuda: 'Se não funcionar, peça um novo código.',
    limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    limitePedido: 'Muitos pedidos. Aguarde alguns minutos antes de pedir outro código.',
    indisponivel: 'Não foi possível confirmar agora. Tente de novo em instantes.',
    indisponivelPedido: 'Não foi possível enviar agora. Tente de novo em instantes.'
  };

  /** So digitos, no maximo 6: colar com espacos ou traco e aceito. */
  function soDigitos(valor) {
    return String(valor == null ? '' : valor).replace(/[^0-9]/g, '').slice(0, 6);
  }

  /** Texto fixo para a resposta de verificacao. 422 e o mesmo para os seis casos (91 §1.2). */
  function mensagemDeVerificacao(status) {
    if (status === 422) return TEXTOS.invalido;
    if (status === 429) return TEXTOS.limite;
    return TEXTOS.indisponivel;
  }

  /** Texto fixo para a resposta do pedido de codigo (limites de H-015). */
  function mensagemDePedido(status) {
    if (status === 202) return TEXTOS.enviado;
    if (status === 429) return TEXTOS.limitePedido;
    if (status === 422) return TEXTOS.emailInvalido;
    return TEXTOS.indisponivelPedido;
  }

  /** Opcoes comuns de rede: mesma origem, sem cache, sem referrer, sem seguir redirecionamento. */
  function opcoesJson(corpo) {
    return {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: corpo
    };
  }

  function montarCodigo(raiz, opcoes) {
    var doc = raiz.ownerDocument;
    var buscar = opcoes.buscar || function (url, init) {
      return janela.fetch(url, init);
    };
    var finalidade = opcoes.purpose || 'login';
    var mensagemFinal = opcoes.mensagemFinal || TEXTOS.acessoConfirmado;
    var emailFixo = typeof opcoes.email === 'string' && opcoes.email !== '' ? opcoes.email : null;

    var enviando = false;
    var errosSeguidos = 0;

    // Marcacao criada pelo proprio modulo (reutilizavel: a #43 nao precisa repetir o formulario).
    var form = doc.createElement('form');
    form.setAttribute('novalidate', '');

    var campoEmail = null;
    var emailEntrada = null;
    if (emailFixo === null) {
      var grupoEmail = doc.createElement('div');
      grupoEmail.setAttribute('class', 'codigo-campo');
      var rotuloEmail = doc.createElement('label');
      rotuloEmail.setAttribute('for', 'codigo-email');
      rotuloEmail.textContent = TEXTOS.rotuloEmail;
      emailEntrada = doc.createElement('input');
      emailEntrada.setAttribute('id', 'codigo-email');
      emailEntrada.setAttribute('type', 'email');
      emailEntrada.setAttribute('autocomplete', 'email');
      emailEntrada.setAttribute('name', 'email');
      grupoEmail.appendChild(rotuloEmail);
      grupoEmail.appendChild(emailEntrada);
      form.appendChild(grupoEmail);
      campoEmail = emailEntrada;
    }

    var grupo = doc.createElement('div');
    grupo.setAttribute('class', 'codigo-campo');
    var rotulo = doc.createElement('label');
    rotulo.setAttribute('for', 'codigo-campo');
    rotulo.textContent = TEXTOS.rotuloCodigo;
    var instrucao = doc.createElement('p');
    instrucao.setAttribute('id', 'codigo-instrucao');
    instrucao.textContent = TEXTOS.instrucaoCodigo;
    var campo = doc.createElement('input');
    campo.setAttribute('id', 'codigo-campo');
    campo.setAttribute('type', 'text');
    campo.setAttribute('inputmode', 'numeric');
    campo.setAttribute('autocomplete', 'one-time-code');
    campo.setAttribute('maxlength', '6');
    campo.setAttribute('pattern', '[0-9]{6}');
    campo.setAttribute('aria-describedby', 'codigo-instrucao');
    grupo.appendChild(rotulo);
    grupo.appendChild(instrucao);
    grupo.appendChild(campo);
    form.appendChild(grupo);

    var erro = doc.createElement('p');
    erro.setAttribute('id', 'codigo-erro');
    erro.setAttribute('class', 'codigo-erro');
    erro.setAttribute('role', 'alert');
    erro.textContent = '';
    form.appendChild(erro);

    var status = doc.createElement('p');
    status.setAttribute('id', 'codigo-status');
    status.setAttribute('class', 'codigo-status');
    status.setAttribute('role', 'status');
    status.textContent = '';
    form.appendChild(status);

    var acoes = doc.createElement('div');
    acoes.setAttribute('class', 'codigo-acoes');
    var botao = doc.createElement('button');
    botao.setAttribute('type', 'submit');
    botao.textContent = TEXTOS.confirmar;
    botao.disabled = true;
    var novo = doc.createElement('button');
    novo.setAttribute('type', 'button');
    novo.setAttribute('class', 'secundario');
    novo.textContent = TEXTOS.novo;
    acoes.appendChild(botao);
    acoes.appendChild(novo);
    form.appendChild(acoes);

    raiz.appendChild(form);

    function atualizarBotao() {
      botao.disabled = enviando || campo.value.length !== 6;
    }

    function mostrarErro(texto) {
      erro.textContent = texto;
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
    }

    function limparErro() {
      erro.textContent = '';
      campo.removeAttribute('aria-invalid');
    }

    function ocupado(valor) {
      enviando = valor;
      if (valor) botao.setAttribute('aria-busy', 'true');
      else botao.removeAttribute('aria-busy');
      atualizarBotao();
      novo.disabled = valor;
    }

    campo.addEventListener('input', function () {
      var limpo = soDigitos(campo.value);
      if (campo.value !== limpo) campo.value = limpo;
      atualizarBotao();
    });

    function enviarCodigo() {
      if (enviando || campo.value.length !== 6) return;
      var email = emailFixo !== null ? emailFixo : (campoEmail ? campoEmail.value : '');
      var codigo = campo.value;
      ocupado(true);
      status.textContent = '';
      limparErro();

      buscar(CAMINHO_VERIFICA, opcoesJson(JSON.stringify({ email: email, code: codigo, purpose: finalidade }))).then(
        function (resposta) {
          if (resposta.status !== 200) {
            errosSeguidos = resposta.status === 422 ? errosSeguidos + 1 : 0;
            var texto = mensagemDeVerificacao(resposta.status);
            if (resposta.status === 422 && errosSeguidos >= ERROS_ATE_AJUDA) texto += ' ' + TEXTOS.ajuda;
            mostrarErro(texto);
            ocupado(false);
            return;
          }
          errosSeguidos = 0;
          status.textContent = TEXTOS.confirmado;
          return buscar(CAMINHO_SESSAO, opcoesJson('{}')).then(
            function (sessao) {
              if (sessao.status === 200) {
                status.textContent = mensagemFinal;
                if (typeof opcoes.aoConfirmar === 'function') opcoes.aoConfirmar();
              } else {
                mostrarErro(TEXTOS.indisponivel);
              }
              ocupado(false);
            },
            function () {
              mostrarErro(TEXTOS.indisponivel);
              ocupado(false);
            }
          );
        },
        function () {
          mostrarErro(TEXTOS.indisponivel);
          ocupado(false);
        }
      );
    }

    form.addEventListener('submit', function (evento) {
      if (evento && evento.preventDefault) evento.preventDefault();
      enviarCodigo();
    });

    novo.addEventListener('click', function () {
      var email = emailFixo !== null ? emailFixo : (campoEmail ? campoEmail.value : '');
      if (enviando) return;
      if (typeof email !== 'string' || email.indexOf('@') < 1) {
        mostrarErro(TEXTOS.emailInvalido);
        return;
      }
      ocupado(true);
      status.textContent = '';
      limparErro();
      buscar(CAMINHO_PEDIDO, opcoesJson(JSON.stringify({ email: email, purpose: finalidade }))).then(
        function (resposta) {
          var texto = mensagemDePedido(resposta.status);
          if (resposta.status === 202) {
            status.textContent = texto;
            errosSeguidos = 0;
          } else {
            mostrarErro(texto);
          }
          ocupado(false);
        },
        function () {
          mostrarErro(TEXTOS.indisponivelPedido);
          ocupado(false);
        }
      );
    });

    return { form: form, campo: campo, botao: botao, erro: erro, status: status, novo: novo };
  }

  var api = {
    montarCodigo: montarCodigo,
    soDigitos: soDigitos,
    mensagemDeVerificacao: mensagemDeVerificacao,
    mensagemDePedido: mensagemDePedido,
    TEXTOS: TEXTOS
  };
  janela.FastProCodigo = api;

  // Pagina isolada: liga o modulo ao elemento de entrada, sem e-mail pre-preenchido.
  var doc = janela.document;
  var raizPagina = doc && doc.getElementById ? doc.getElementById('codigo-raiz') : null;
  if (raizPagina) {
    montarCodigo(raizPagina, { purpose: 'login' });
  }
})(globalThis);
