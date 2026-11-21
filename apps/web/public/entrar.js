// #154 (desenho 176 §4.1, §5.1; S2 e CA-154-02, 03, 04, 05, 19) | Pagina /entrar: o cliente pede acesso pelo e-mail.
// A resposta e a mesma para e-mail cadastrado ou nao (RN-154-02). O e-mail fica so na memoria da pagina:
// nada vai para URL, armazenamento ou cookie. Usa window.FastProEntrada (entrada-comum.js).
(function (janela) {
  'use strict';

  var CAMINHO_PEDIDO = '/api/v1/auth/challenges';
  var FINALIDADE = 'login';

  function iniciar(doc, buscar, agendar) {
    var E = janela.FastProEntrada;
    var T = E.TEXTOS;
    var formulario = doc.getElementById('formulario');
    var campo = doc.getElementById('email');
    var erroCampo = doc.getElementById('erro-email');
    var erroGeral = doc.getElementById('erro-geral');
    var resultado = doc.getElementById('resultado');
    var botao = doc.getElementById('enviar');
    var enviando = false;

    function avisoGeral(texto) {
      erroGeral.textContent = texto ? T.erroPrefixo + texto : '';
    }

    function erroDoEmail() {
      E.mostrarErro(campo, erroCampo, T.emailInvalidoCliente);
      campo.focus();
    }

    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (enviando) return; // CA-154-04: um so pedido por vez.

      avisoGeral('');
      resultado.textContent = '';
      E.limparErro(campo, erroCampo);

      var email = campo.value.trim();
      if (!E.emailValido(email)) {
        erroDoEmail(); // CA-154-03: sem chamada de rede.
        return;
      }

      enviando = true;
      E.ocupado(botao, true);
      E.enviarJson(buscar, CAMINHO_PEDIDO, { email: email, purpose: FINALIDADE }).then(function (r) {
        enviando = false;
        E.ocupado(botao, false);
        if (r.status === 202) {
          resultado.textContent = T.enviado + ' ' + T.enviadoOuLink;
          return;
        }
        if (r.status === 422) {
          erroDoEmail();
          return;
        }
        if (r.status === 429) {
          // CA-154-05: o botao volta depois do tempo indicado pelo servidor; o numero nao aparece na tela.
          avisoGeral(T.limitePedido);
          E.esperarLiberar(botao, E.esperaLimite(r.retryAfter), agendar);
          return;
        }
        // CA-154-19: qualquer outra resposta (inclusive 404 da API ainda nao publicada) e indisponivel.
        avisoGeral(T.indisponivelPedido);
      });
    });
  }

  iniciar(
    janela.document,
    function (url, opcoes) {
      return janela.fetch(url, opcoes);
    },
    function (fn, ms) {
      janela.setTimeout(fn, ms);
    }
  );
})(globalThis);
