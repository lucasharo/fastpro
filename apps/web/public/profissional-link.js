// #154 (desenho 176 §4.1, §5.1, §5.2; S5 e S6) | Telas que recebem o link enviado ao e-mail do profissional.
// O modo vem do data-pagina do body: "verificar" (/profissional/verificar, confirma o e-mail).
// O token vem do fragmento (#t=...), fica so na memoria deste script e sai da barra de endereco logo na carga.
// Nada chama a API antes do clique do usuario. Nada vai para URL, localStorage, sessionStorage ou cookie.
// Usa window.FastProEntrada (entrada-comum.js).
(function (janela) {
  'use strict';

  var CAMINHOS = {
    verificar: '/profissional/verificar',
    redefinir: '/profissional/redefinir'
  };
  // Mesma origem: o web encaminha /api/* a API (a API tira o prefixo /api).
  var CAMINHO_CONFIRMAR = '/api/v1/auth/professional/verification/confirm';
  var CAMINHO_REENVIO = '/api/v1/auth/professional/verification/resend';
  var CAMINHO_REDEFINIR = '/api/v1/auth/password/reset';
  var SENHA_MINIMA = 8;

  /**
   * Confirmacao do e-mail (S5). 204 confirma; 410 link que nao serve mais (oferece novo link); qualquer outra
   * resposta (503, 404, rede) vira "indisponivel" e o token continua na memoria para nova tentativa pelo botao.
   */
  function iniciarVerificar(doc, loc, hist, buscar, agendar) {
    var E = janela.FastProEntrada;
    var T = E.TEXTOS;
    var botao = doc.getElementById('confirmar');
    var aviso = doc.getElementById('aviso');
    var erroGeral = doc.getElementById('erro-geral');
    var proximo = doc.getElementById('proximo');
    var continuar = doc.getElementById('continuar');
    var novoLink = doc.getElementById('novo-link');
    var formularioNovo = doc.getElementById('formulario-novo');
    var campoEmail = doc.getElementById('email');
    var erroEmail = doc.getElementById('erro-email');
    var reenviar = doc.getElementById('reenviar');
    var resultado = doc.getElementById('resultado');
    var token = E.extrairToken(loc.hash);
    var enviando = false;
    var enviandoNovo = false;

    // Tira o token da barra de endereco: a URL fica so no caminho da pagina.
    hist.replaceState(null, '', CAMINHOS.verificar);

    continuar.setAttribute('href', E.DESTINO_PROFISSIONAL);
    botao.disabled = true;
    proximo.hidden = true;
    novoLink.hidden = true;

    // Pedido de novo link (RN-154: resposta igual para e-mail cadastrado ou nao). Fica ligado antes do
    // teste do token: o formulario tambem serve quando a pagina abre sem link.
    formularioNovo.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (enviandoNovo) return; // um pedido por vez
      resultado.textContent = '';
      E.limparErro(campoEmail, erroEmail);
      var email = campoEmail.value.trim();
      if (!E.emailValido(email)) {
        E.mostrarErro(campoEmail, erroEmail, T.emailInvalido);
        campoEmail.focus();
        return;
      }
      enviandoNovo = true;
      E.ocupado(reenviar, true);
      E.enviarJson(buscar, CAMINHO_REENVIO, { email: email }).then(function (r) {
        enviandoNovo = false;
        E.ocupado(reenviar, false);
        if (r.status === 202) {
          resultado.textContent = T.reenviado;
          return;
        }
        if (r.status === 429) {
          resultado.textContent = T.erroPrefixo + T.limiteGeral;
          E.esperarLiberar(reenviar, E.esperaLimite(r.retryAfter), agendar);
          return;
        }
        resultado.textContent = T.erroPrefixo + T.recuperarIndisponivel;
      });
    });

    if (!token) {
      erroGeral.textContent = T.erroPrefixo + T.verificarSemLink;
      novoLink.hidden = false;
      return;
    }

    // Espera curta antes de habilitar o botao: reduz clique automatico de leitor de e-mail.
    // Nao e controle de seguranca; o unico gatilho do envio continua sendo o clique.
    E.esperaLink(botao, agendar, null);

    botao.addEventListener('click', function () {
      if (enviando || token === null || botao.disabled) return;
      enviando = true;
      erroGeral.textContent = '';
      E.ocupado(botao, true);

      E.enviarJson(buscar, CAMINHO_CONFIRMAR, { token: token }).then(function (r) {
        enviando = false;
        E.ocupado(botao, false);
        if (r.status === 204) {
          token = null; // uso unico: depois do sucesso o script nao guarda mais o token
          botao.disabled = true;
          aviso.textContent = T.verificarConfirmado;
          proximo.hidden = false;
          return;
        }
        if (r.status === 410) {
          token = null;
          botao.disabled = true;
          erroGeral.textContent = T.erroPrefixo + T.linkInvalido;
          novoLink.hidden = false;
          return;
        }
        // Qualquer outra resposta: indisponivel. O token fica na memoria para o botao tentar de novo.
        erroGeral.textContent = T.erroPrefixo + T.verificarIndisponivel;
      });
    });
  }

  /** Mostrar ou ocultar a senha (mesma regra de profissional-acesso.js: botao com aria-pressed). */
  function alternarSenha(botao, senha) {
    botao.addEventListener('click', function () {
      var mostrar = senha.getAttribute('type') !== 'text';
      senha.setAttribute('type', mostrar ? 'text' : 'password');
      botao.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
    });
  }

  /**
   * Troca de senha pelo link do e-mail (S6). 204 troca e nao abre sessao; 410 link que nao serve mais;
   * 422 senha fora da regra (o link continua valido e a senha digitada fica no campo); 503 e rede viram
   * indisponivel e apagam a senha (o link segue na memoria). Sem espera de 1 s: o envio exige a senha digitada.
   */
  function iniciarRedefinir(doc, loc, hist, buscar) {
    var E = janela.FastProEntrada;
    var T = E.TEXTOS;
    var formulario = doc.getElementById('formulario');
    var campoSenha = doc.getElementById('senha');
    var erroSenha = doc.getElementById('erro-senha');
    var erroGeral = doc.getElementById('erro-geral');
    var alternar = doc.getElementById('alternar-senha');
    var botao = doc.getElementById('enviar');
    var trocada = doc.getElementById('trocada');
    var aviso = doc.getElementById('aviso');
    var novoLink = doc.getElementById('novo-link');
    var token = E.extrairToken(loc.hash);
    var enviando = false;

    // Tira o token da barra de endereco: a URL fica so no caminho da pagina.
    hist.replaceState(null, '', CAMINHOS.redefinir);
    alternarSenha(alternar, campoSenha);
    trocada.hidden = true;
    novoLink.hidden = true;

    if (!token) {
      erroGeral.textContent = T.erroPrefixo + T.redefinirSemLink;
      novoLink.hidden = false;
      botao.disabled = true;
      return;
    }

    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (enviando || token === null) return;
      erroGeral.textContent = '';
      E.limparErro(campoSenha, erroSenha);

      var senha = campoSenha.value;
      // Checagem de forma so para poupar chamada; o servidor continua a autoridade.
      if (senha === '') {
        E.mostrarErro(campoSenha, erroSenha, T.senhaVazia);
        campoSenha.focus();
        return;
      }
      if (Array.from(senha).length < SENHA_MINIMA) {
        E.mostrarErro(campoSenha, erroSenha, E.motivoSenha('curta'));
        campoSenha.focus();
        return;
      }

      enviando = true;
      E.ocupado(botao, true);
      E.enviarJson(buscar, CAMINHO_REDEFINIR, { token: token, new_password: senha }).then(function (r) {
        enviando = false;
        E.ocupado(botao, false);
        if (r.status === 204) {
          token = null; // uso unico
          campoSenha.value = '';
          formulario.hidden = true;
          trocada.hidden = false;
          aviso.textContent = T.senhaTrocada;
          return;
        }
        if (r.status === 410) {
          token = null;
          campoSenha.value = '';
          botao.disabled = true;
          erroGeral.textContent = T.erroPrefixo + T.linkRedefinicaoInvalido;
          novoLink.hidden = false;
          return;
        }
        if (r.status === 422) {
          // Senha fora da regra do servidor: mostra o motivo; o link continua valido e a senha fica no campo.
          E.mostrarErro(campoSenha, erroSenha, E.motivoSenha(r.corpo && r.corpo.motivo));
          campoSenha.focus();
          return;
        }
        // Falha de rede, 503 ou outra resposta: a senha nao volta preenchida; o link segue na memoria.
        campoSenha.value = '';
        erroGeral.textContent = T.erroPrefixo + T.redefinirIndisponivel;
      });
    });
  }

  var MODOS = {
    verificar: iniciarVerificar,
    redefinir: iniciarRedefinir
  };

  var doc = janela.document;
  var agendar = function (fn, ms) {
    janela.setTimeout(fn, ms);
  };
  var buscar = function (url, opcoes) {
    return janela.fetch(url, opcoes);
  };
  var modo = MODOS[doc.body.dataset.pagina];
  if (modo) modo(doc, janela.location, janela.history, buscar, agendar);
})(globalThis);
