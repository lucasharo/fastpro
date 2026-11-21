// #154 (desenho 176 §4.2) | Funcoes comuns das telas de entrada (cliente e profissional).
// Expoe window.FastProEntrada. Sem armazenamento, sem console, sem innerHTML: so textContent e atributos fixos.
// E-mail, senha e token ficam so em memoria da pagina; nunca vao para URL, storage ou cookie da tela.
(function (janela) {
  'use strict';

  // Destino depois do login do profissional com e-mail confirmado. A #155 troca o valor quando existir a pagina
  // de situacao (desenho 176, AD-154-02).
  var DESTINO_PROFISSIONAL = '/profissional-documentos';
  // Lista fixa de retorno (AD-154-07). Qualquer outro valor e ignorado.
  var DESTINOS_VOLTAR = ['/pedido/revisao', '/pedido', '/'];
  // Mesma forma aceita pelo servidor (packages do dominio, password/e-mail).
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var ESPERA_PADRAO_S = 30;
  var ESPERA_MINIMA_S = 5;
  var ESPERA_MAXIMA_S = 900;
  var ESPERA_LINK_MS = 1000;

  var TEXTOS = {
    erroPrefixo: 'Erro: ',
    indisponivelGenerico: 'Não foi possível concluir agora. Tente de novo em instantes.',

    // Cliente: /entrar, /acesso e /codigo.
    entrarTitulo: 'Entrar',
    entrarApoio: 'Informe seu e-mail. Enviamos um acesso para você continuar.',
    rotuloEmail: 'E-mail',
    enviarAcesso: 'Enviar acesso',
    emailInvalidoCliente: 'Informe um e-mail válido para pedir o código.',
    enviado: 'Se o e-mail estiver cadastrado, enviamos um novo código.',
    enviadoOuLink: 'Ou abra o link que enviamos ao seu e-mail.',
    limitePedido: 'Muitos pedidos. Aguarde alguns minutos antes de pedir outro código.',
    indisponivelPedido: 'Não foi possível enviar agora. Tente de novo em instantes.',
    digitarCodigo: 'Digitar o código',
    souProfissional: 'Sou profissional',
    novoAcesso: 'Pedir novo acesso',
    voltar: 'Voltar',

    // Profissional: cadastro, entrada, recuperação, confirmação e troca de senha.
    cadastroTitulo: 'Criar conta de profissional',
    cadastroApoio: 'Crie sua conta com e-mail e senha.',
    rotuloSenha: 'Senha',
    regraSenha: 'Mínimo de 8 caracteres.',
    mostrarSenha: 'Mostrar senha',
    ocultarSenha: 'Ocultar senha',
    criarConta: 'Criar conta',
    jaTenhoConta: 'Já tenho conta',
    emailInvalido: 'Informe um e-mail válido.',
    senhaVazia: 'Informe sua senha.',
    senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
    confiraTitulo: 'Confira seu e-mail',
    confiraTexto:
      'Se este e-mail puder ser usado, enviamos um link para confirmar. Abra o link no seu e-mail.',
    reenviarLink: 'Reenviar link',
    reenviado: 'Se este e-mail puder ser usado, enviamos o link de novo.',
    cadastroIndisponivel: 'Não foi possível criar sua conta agora. Tente de novo em instantes.',
    limiteGeral: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',

    entrarProfTitulo: 'Entrar como profissional',
    entrarProfApoio: 'Use o e-mail e a senha do seu cadastro.',
    entrarBotao: 'Entrar',
    esqueciSenha: 'Esqueci minha senha',
    criarContaLink: 'Criar conta',
    souCliente: 'Sou cliente',
    dadosIncorretos: 'E-mail ou senha incorretos.',
    contaIndisponivel: 'Esta conta não pode entrar agora.',
    confirmeEmail: 'Confirme seu e-mail para continuar.',
    entrarIndisponivel: 'Não foi possível entrar agora. Tente de novo em instantes.',

    recuperarTitulo: 'Esqueci minha senha',
    recuperarApoio: 'Informe o e-mail do cadastro. Enviamos um link para criar uma nova senha.',
    enviarLink: 'Enviar link',
    recuperarEnviado: 'Se este e-mail puder ser usado, enviamos um link para criar uma nova senha.',
    recuperarIndisponivel: 'Não foi possível enviar agora. Tente de novo em instantes.',

    verificarTitulo: 'Confirmar e-mail',
    verificarApoio: 'Confirme que este e-mail é seu para continuar.',
    confirmarEmail: 'Confirmar e-mail',
    verificarSemLink:
      'Este link não está completo. Abra o link que enviamos ao seu e-mail ou peça um novo.',
    verificarConfirmado: 'E-mail confirmado. Agora você pode enviar seus documentos.',
    linkInvalido: 'Este link não pode mais ser usado. Peça um novo link.',
    pedirNovoLink: 'Pedir novo link',
    verificarIndisponivel: 'Não foi possível confirmar agora. Tente de novo em instantes.',
    continuar: 'Continuar',

    redefinirTitulo: 'Criar nova senha',
    redefinirApoio: 'Escolha uma senha nova para entrar.',
    salvarSenha: 'Salvar nova senha',
    redefinirSemLink: 'Este link não está completo. Peça uma nova redefinição de senha.',
    senhaTrocada: 'Senha trocada. Agora você pode entrar com a nova senha.',
    linkRedefinicaoInvalido: 'Este link não pode mais ser usado. Peça uma nova redefinição.',
    pedirRedefinicao: 'Pedir nova redefinição',
    redefinirIndisponivel: 'Não foi possível trocar a senha agora. Tente de novo em instantes.',

    motivoSenhaTipo: 'Escolha outra senha.',
    motivoSenhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
    motivoSenhaLonga: 'A senha é longa demais. Escolha uma mais curta.',
    motivoSenhaControle: 'A senha tem um caractere que não pode ser usado. Escolha outra.',
    motivoSenhaIgualEmail: 'A senha não pode ser igual ao seu e-mail.',
    motivoSenhaComum: 'Esta senha é comum demais. Escolha outra mais difícil de adivinhar.',
    motivoSenhaGenerico: 'Escolha outra senha.'
  };

  var MOTIVOS_SENHA = {
    tipo: TEXTOS.motivoSenhaTipo,
    curta: TEXTOS.motivoSenhaCurta,
    longa: TEXTOS.motivoSenhaLonga,
    controle: TEXTOS.motivoSenhaControle,
    igual_email: TEXTOS.motivoSenhaIgualEmail,
    comum: TEXTOS.motivoSenhaComum
  };

  /** Forma do e-mail, igual ao servidor. Quem chama deve passar o texto ja sem espacos nas pontas. */
  function emailValido(texto) {
    return typeof texto === 'string' && EMAIL_RE.test(texto);
  }

  /** Texto fixo para o motivo devolvido pelo servidor (6 motivos de senha). Motivo desconhecido vira texto generico. */
  function motivoSenha(motivo) {
    return Object.prototype.hasOwnProperty.call(MOTIVOS_SENHA, motivo)
      ? MOTIVOS_SENHA[motivo]
      : TEXTOS.motivoSenhaGenerico;
  }

  /** Segundos de espera depois de 429, limitados (AD-154-08). Sem cabecalho, 30 s. Nunca mostrado na tela. */
  function esperaLimite(retryAfter) {
    var n = parseInt(retryAfter, 10);
    if (isNaN(n)) return ESPERA_PADRAO_S;
    return Math.min(ESPERA_MAXIMA_S, Math.max(ESPERA_MINIMA_S, n));
  }

  /** Caminho de retorno aceito somente se estiver na lista fixa (AD-154-07). Caso contrario, nulo. */
  function destinoSeguro(valor) {
    return DESTINOS_VOLTAR.indexOf(valor) >= 0 ? valor : null;
  }

  /** Le o token do fragmento (#t=...). Mesma forma de acesso.js. Qualquer outra forma devolve nulo. */
  function extrairToken(fragmento) {
    var m = /(?:^#|&)t=([A-Za-z0-9_-]{1,512})(?=&|$)/.exec(fragmento || '');
    return m ? m[1] : null;
  }

  /** Opcoes comuns de rede: mesma origem, sem cache, sem referrer, sem seguir redirecionamento. */
  function opcoesJson(objeto) {
    return {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(objeto === undefined ? {} : objeto)
    };
  }

  /**
   * POST JSON. Resolve sempre com { status, retryAfter, corpo }:
   * - falha de rede ou excecao vira status 0;
   * - corpo vazio ou nao JSON vira corpo nulo (204 e normal);
   * - quem chama decide o que cada status significa.
   */
  function enviarJson(buscar, caminho, objeto) {
    var opcoes = opcoesJson(objeto);
    return Promise.resolve()
      .then(function () {
        return buscar(caminho, opcoes);
      })
      .then(function (resposta) {
        var status = resposta && typeof resposta.status === 'number' ? resposta.status : 0;
        var retry = null;
        if (resposta && resposta.headers && typeof resposta.headers.get === 'function') {
          retry = resposta.headers.get('Retry-After');
        }
        return Promise.resolve()
          .then(function () {
            return resposta.json();
          })
          .then(
            function (corpo) {
              return { status: status, retryAfter: retry, corpo: corpo };
            },
            function () {
              return { status: status, retryAfter: retry, corpo: null };
            }
          );
      })
      .catch(function () {
        return { status: 0, retryAfter: null, corpo: null };
      });
  }

  /** Botao ocupado: desabilitado e anunciado como ocupado (sem trocar o texto). */
  function ocupado(botao, valor) {
    botao.disabled = !!valor;
    if (valor) botao.setAttribute('aria-busy', 'true');
    else botao.removeAttribute('aria-busy');
  }

  /** Erro junto ao campo: texto com prefixo "Erro:" (nao so cor), campo marcado como invalido. */
  function mostrarErro(campo, erro, texto) {
    erro.textContent = TEXTOS.erroPrefixo + texto;
    campo.setAttribute('aria-invalid', 'true');
  }

  function limparErro(campo, erro) {
    erro.textContent = '';
    campo.removeAttribute('aria-invalid');
  }

  /** Desabilita o botao por Retry-After segundos e libera sozinho depois. */
  function esperarLiberar(botao, segundos, agendar) {
    botao.disabled = true;
    agendar(function () {
      botao.disabled = false;
    }, segundos * 1000);
  }

  /** Espera curta antes de habilitar o botao de confirmacao (reduz clique automatico de leitor de e-mail). */
  function esperaLink(botao, agendar, aoLiberar) {
    botao.disabled = true;
    agendar(function () {
      botao.disabled = false;
      if (aoLiberar) aoLiberar();
    }, ESPERA_LINK_MS);
  }

  var api = {
    TEXTOS: TEXTOS,
    DESTINO_PROFISSIONAL: DESTINO_PROFISSIONAL,
    emailValido: emailValido,
    motivoSenha: motivoSenha,
    esperaLimite: esperaLimite,
    destinoSeguro: destinoSeguro,
    extrairToken: extrairToken,
    opcoesJson: opcoesJson,
    enviarJson: enviarJson,
    ocupado: ocupado,
    mostrarErro: mostrarErro,
    limparErro: limparErro,
    esperarLiberar: esperarLiberar,
    esperaLink: esperaLink
  };

  janela.FastProEntrada = api;
})(globalThis);
