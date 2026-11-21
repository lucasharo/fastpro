// #154 (desenho 176 §4.4, §4.5, §5.1; S3 e S4) | Telas do profissional: cadastro e entrada com e-mail e senha.
// O modo vem do data-pagina do body: "cadastro" (/profissional/cadastro) ou "entrar" (/profissional/entrar).
// A recuperacao de senha entra na fatia S6 neste mesmo arquivo. Senha so no campo, nunca em URL, armazenamento
// ou mensagem. E-mail fica so na memoria da pagina. Usa window.FastProEntrada (entrada-comum.js).
(function (janela) {
  'use strict';

  var CAMINHO_CADASTRO = '/api/v1/auth/professional/register';
  var CAMINHO_ENTRADA = '/api/v1/auth/professional/login';
  var CAMINHO_REENVIO = '/api/v1/auth/professional/verification/resend';
  var SENHA_MINIMA = 8;

  /** Mostrar ou ocultar a senha: botao com aria-pressed; colar continua liberado (WCAG 3.3.8). */
  function alternarSenha(botao, senha) {
    botao.addEventListener('click', function () {
      var mostrar = senha.getAttribute('type') !== 'text';
      senha.setAttribute('type', mostrar ? 'text' : 'password');
      botao.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
    });
  }

  /** Um envio por vez por botao: enquanto a resposta nao chega, a chamada seguinte nao sai (CA-154-04). */
  function criarEnvio(E, buscar, botao) {
    var emAndamento = false;
    return function (caminho, corpo) {
      if (emAndamento) return null;
      emAndamento = true;
      E.ocupado(botao, true);
      return E.enviarJson(buscar, caminho, corpo).then(function (r) {
        emAndamento = false;
        E.ocupado(botao, false);
        return r;
      });
    };
  }

  function iniciarCadastro(doc, buscar, agendar) {
    var E = janela.FastProEntrada;
    var T = E.TEXTOS;
    var formulario = doc.getElementById('formulario');
    var campoEmail = doc.getElementById('email');
    var erroEmail = doc.getElementById('erro-email');
    var campoSenha = doc.getElementById('senha');
    var erroSenha = doc.getElementById('erro-senha');
    var erroGeral = doc.getElementById('erro-geral');
    var botao = doc.getElementById('enviar');
    var alternar = doc.getElementById('alternar-senha');
    var confira = doc.getElementById('confira');
    var tituloConfira = doc.getElementById('confira-titulo');
    var resultado = doc.getElementById('resultado');
    var reenviar = doc.getElementById('reenviar');
    var emailEnviado = '';
    var enviarCadastro = criarEnvio(E, buscar, botao);
    var enviarReenvio = criarEnvio(E, buscar, reenviar);

    alternarSenha(alternar, campoSenha);

    function geral(texto) {
      erroGeral.textContent = texto ? T.erroPrefixo + texto : '';
    }

    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      geral('');
      E.limparErro(campoEmail, erroEmail);
      E.limparErro(campoSenha, erroSenha);

      var email = campoEmail.value.trim();
      var senha = campoSenha.value;
      var primeiro = null;
      if (!E.emailValido(email)) {
        E.mostrarErro(campoEmail, erroEmail, T.emailInvalido);
        primeiro = campoEmail;
      }
      if (senha === '') {
        E.mostrarErro(campoSenha, erroSenha, T.senhaVazia);
        primeiro = primeiro || campoSenha;
      } else if (Array.from(senha).length < SENHA_MINIMA) {
        // Checagem de forma so para poupar chamada; o servidor continua a autoridade.
        E.mostrarErro(campoSenha, erroSenha, E.motivoSenha('curta'));
        primeiro = primeiro || campoSenha;
      }
      if (primeiro) {
        primeiro.focus();
        return;
      }

      var pedido = enviarCadastro(CAMINHO_CADASTRO, { email: email, password: senha });
      if (!pedido) return;
      pedido.then(function (r) {
        if (r.status === 202) {
          // Mesma resposta para e-mail novo e ja cadastrado (decisao 953): a tela nao diz qual e o caso.
          emailEnviado = email;
          campoSenha.value = '';
          formulario.hidden = true;
          confira.hidden = false;
          tituloConfira.focus();
          return;
        }
        if (r.status === 422) {
          if (r.corpo && r.corpo.campo === 'email') {
            E.mostrarErro(campoEmail, erroEmail, T.emailInvalido);
            campoEmail.focus();
          } else {
            E.mostrarErro(campoSenha, erroSenha, E.motivoSenha(r.corpo && r.corpo.motivo));
            campoSenha.focus();
          }
          return;
        }
        if (r.status === 429) {
          geral(T.limiteGeral);
          E.esperarLiberar(botao, E.esperaLimite(r.retryAfter), agendar);
          return;
        }
        // Falha de rede ou erro do servidor: a senha nunca volta preenchida; o e-mail continua.
        campoSenha.value = '';
        geral(T.cadastroIndisponivel);
      });
    });

    reenviar.addEventListener('click', function () {
      resultado.textContent = '';
      var pedido = enviarReenvio(CAMINHO_REENVIO, { email: emailEnviado });
      if (!pedido) return;
      pedido.then(function (r) {
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
  }

  function iniciarEntrar(doc, buscar, agendar) {
    var E = janela.FastProEntrada;
    var T = E.TEXTOS;
    var formulario = doc.getElementById('formulario');
    var campoEmail = doc.getElementById('email');
    var erroEmail = doc.getElementById('erro-email');
    var campoSenha = doc.getElementById('senha');
    var erroSenha = doc.getElementById('erro-senha');
    var erroGeral = doc.getElementById('erro-geral');
    var botao = doc.getElementById('enviar');
    var alternar = doc.getElementById('alternar-senha');
    var confirma = doc.getElementById('confirma');
    var resultado = doc.getElementById('resultado');
    var reenviar = doc.getElementById('reenviar');
    var emailEntrada = '';
    var enviarEntrada = criarEnvio(E, buscar, botao);
    var enviarReenvio = criarEnvio(E, buscar, reenviar);

    alternarSenha(alternar, campoSenha);

    function geral(texto) {
      erroGeral.textContent = texto ? T.erroPrefixo + texto : '';
    }

    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      geral('');
      confirma.hidden = true;
      E.limparErro(campoEmail, erroEmail);
      E.limparErro(campoSenha, erroSenha);

      var email = campoEmail.value.trim();
      var senha = campoSenha.value;
      if (!E.emailValido(email)) {
        E.mostrarErro(campoEmail, erroEmail, T.emailInvalido);
        campoEmail.focus();
        return;
      }
      if (senha === '') {
        E.mostrarErro(campoSenha, erroSenha, T.senhaVazia);
        campoSenha.focus();
        return;
      }

      emailEntrada = email;
      var pedido = enviarEntrada(CAMINHO_ENTRADA, { email: email, password: senha });
      if (!pedido) return;
      pedido.then(function (r) {
        // A senha so existe no campo: apaga depois de qualquer resposta.
        campoSenha.value = '';
        if (r.status === 200) {
          var c = r.corpo;
          if (!c || typeof c.email_verified !== 'boolean') {
            geral(T.entrarIndisponivel);
            return;
          }
          if (c.email_verified === true && c.access_level === 'full') {
            janela.location.assign(E.DESTINO_PROFISSIONAL);
            return;
          }
          // Acesso so de verificacao (AD-154-03): nao redireciona; pede a confirmacao do e-mail.
          confirma.hidden = false;
          return;
        }
        if (r.status === 401) {
          geral(T.dadosIncorretos); // sem dizer qual campo esta errado
          return;
        }
        if (r.status === 403) {
          geral(T.contaIndisponivel);
          return;
        }
        if (r.status === 429) {
          geral(T.limiteGeral);
          E.esperarLiberar(botao, E.esperaLimite(r.retryAfter), agendar);
          return;
        }
        geral(T.entrarIndisponivel);
      });
    });

    reenviar.addEventListener('click', function () {
      resultado.textContent = '';
      var pedido = enviarReenvio(CAMINHO_REENVIO, { email: emailEntrada });
      if (!pedido) return;
      pedido.then(function (r) {
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
  }

  var doc = janela.document;
  var agendar = function (fn, ms) {
    janela.setTimeout(fn, ms);
  };
  var buscar = function (url, opcoes) {
    return janela.fetch(url, opcoes);
  };
  var pagina = doc.body.dataset.pagina;
  if (pagina === 'cadastro') iniciarCadastro(doc, buscar, agendar);
  else if (pagina === 'entrar') iniciarEntrar(doc, buscar, agendar);
})(globalThis);
