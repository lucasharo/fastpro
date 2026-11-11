// H-012 | Pagina /acesso (docs/factory/46-DESENHO-H012.md, §1, §5; CA-H012-01..03).
// Nao chama a API ao carregar. O token vem do fragmento (#t=...), fica so na memoria deste script,
// sai da barra de endereco e so segue no POST disparado pelo clique do usuario. Nada vai para
// localStorage, sessionStorage ou cookie. Sem tela de produto: textos fixos e genericos.
(function (janela) {
  'use strict';

  var CAMINHO_PAGINA = '/acesso';
  var CAMINHO_CONSUMO = '/v1/auth/challenges/consume';
  var ESPERA_BOTAO_MS = 1000;

  var MENSAGENS = {
    pronto: 'Confirme o acesso para continuar.',
    invalido: 'Este link não pode mais ser usado. Peça um novo acesso.',
    indisponivel:
      'Não foi possível concluir o acesso agora. Peça um novo acesso em alguns minutos.',
    generico: 'Não foi possível concluir o acesso. Peça um novo acesso.',
    confirmado: 'Acesso confirmado. A próxima etapa será liberada em breve.'
  };

  /** Le o token do fragmento (#t=...). Qualquer outra forma devolve nulo. */
  function extrairToken(fragmento) {
    var m = /(?:^#|&)t=([A-Za-z0-9_-]{1,512})(?=&|$)/.exec(fragmento || '');
    return m ? m[1] : null;
  }

  /** Texto da resposta do POST. Nenhum status expõe motivo do link (46 §2). */
  function mensagemPara(status) {
    if (status === 200) return MENSAGENS.confirmado;
    if (status === 400) return MENSAGENS.invalido;
    if (status === 503) return MENSAGENS.indisponivel;
    return MENSAGENS.generico;
  }

  function iniciar(doc, loc, hist, buscar, agendar) {
    var botao = doc.getElementById('confirmar');
    var aviso = doc.getElementById('aviso');
    var token = extrairToken(loc.hash);

    // Tira o token da barra de endereco: a URL fica so em /acesso.
    hist.replaceState(null, '', CAMINHO_PAGINA);

    botao.disabled = true;
    if (!token) {
      aviso.textContent = MENSAGENS.invalido;
      return;
    }
    aviso.textContent = MENSAGENS.pronto;

    // Pequena espera antes de habilitar o botao: reduz clique automatico de leitor de e-mail.
    // Nao e controle de seguranca; o unico gatilho do POST continua sendo o clique.
    agendar(function () {
      if (token !== null) botao.disabled = false;
    }, ESPERA_BOTAO_MS);

    var enviando = false;
    botao.addEventListener('click', function () {
      if (enviando || token === null) return;
      enviando = true;
      botao.disabled = true;
      var valor = token;
      token = null; // uso unico na memoria: depois do envio o script nao guarda mais o token

      buscar(CAMINHO_CONSUMO, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: valor })
      }).then(
        function (resposta) {
          aviso.textContent = mensagemPara(resposta.status);
        },
        function () {
          aviso.textContent = MENSAGENS.generico;
        }
      );
    });
  }

  iniciar(
    janela.document,
    janela.location,
    janela.history,
    function (url, opcoes) {
      return janela.fetch(url, opcoes);
    },
    function (fn, ms) {
      janela.setTimeout(fn, ms);
    }
  );
})(globalThis);
