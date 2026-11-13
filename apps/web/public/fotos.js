// H-029 (Issue #42) | Pagina /fotos: pre-visualizacao, exclusao e reordenacao das fotos do rascunho
// (docs/factory/98-DESENHO-H029.md, §4; 98-REFINO-H029 §5 e §6; decisoes 117 a 121 e 133 a 135).
// montarFotos(raiz, opcoes) monta a tela dentro de raiz. Todas as dependencias do navegador entram por opcoes
// (fetch, relogio, agendador, documento, URL de objeto), para o controlador ser testado com DOM simulado.
// Nada sensivel em URL, storage ou console: a foto chega como Blob em memoria e o servidor responde so com
// codigos fixos. Textos de erro e de estado vem de uma tabela unica (TEXTOS). Nenhum dado do servidor vai para marcacao montada por texto.
(function (janela) {
  'use strict';

  var CAMINHO_FOTOS = '/api/v1/media/photos';
  var CAMINHO_ORDEM = '/api/v1/media/photos/order';
  function caminhoItem(id) { return '/api/v1/media/' + id; }
  var LIMITE_FOTOS = 5;
  var INTERVALO_CONSULTA_MS = 3000;
  var CONSULTAS_MAX = 20;
  var LEITURAS_EM_PARALELO = 2;

  var TEXTOS = {
    titulo: 'Fotos do pedido',
    aviso: 'Evite fotos que mostrem fachada, interior ou rostos.',
    contador: '{n} de 5 fotos',
    carregando: 'Carregando fotos',
    vazio: 'Nenhuma foto adicionada. Fotos são opcionais.',
    enviando: 'O envio desta foto não foi concluído.',
    processando: 'Preparando a foto. Isso leva alguns segundos.',
    pronta: 'Pronta',
    recusada: 'Não foi possível usar esta foto: {motivo}.',
    recusadaSemNumero: 'Foto não usada',
    rotuloExcluirNaoUsada: 'Excluir foto não usada',
    motivos: {
      imagem_invalida: 'o arquivo não é JPG, PNG ou WebP',
      imagem_grande_demais: 'a imagem é grande demais',
      nao_cabe_no_limite: 'não foi possível reduzi-la o bastante',
      nao_processavel: 'não foi possível processar a foto'
    },
    erroLista: 'Não foi possível carregar as fotos.',
    rascunhoVencido: 'Este pedido não está mais disponível. Comece um novo pedido.',
    muitasAcoes: 'Aguarde alguns instantes e tente de novo.',
    erroImagem: 'Não foi possível mostrar esta foto.',
    ainda: 'Ainda preparando a foto.',
    erroExclusao: 'Não foi possível excluir a foto. Tente de novo.',
    erroOrdem: 'Não foi possível salvar a nova ordem. Ela voltou à anterior.',
    salvandoOrdem: 'Salvando ordem',
    limite: 'Você já tem 5 fotos. Para adicionar outra, exclua uma.',
    adicionar: 'Adicionar foto',
    indisponivelNoNavegador: 'Envio de foto indisponível neste navegador.',
    tentarDeNovo: 'Tentar de novo',
    cancelar: 'Cancelar',
    excluirConfirmar: 'Excluir',
    dialogoTitulo: 'Excluir esta foto?',
    anunciaExcluida: 'Foto {n} excluída',
    anunciaMovida: 'Foto {n} movida para a posição {m} de {x}',
    anunciaOrdemMudou: 'A ordem das fotos mudou; a lista foi atualizada.',
    rotuloFoto: 'Foto {n} de {m}',
    rotuloMoverAntes: 'Mover foto {n} para antes',
    rotuloMoverDepois: 'Mover foto {n} para depois',
    rotuloExcluir: 'Excluir foto {n}',
    fotoAlt: 'Foto {n} de {m}',
    carregandoFoto: 'Carregando foto {n}'
  };

  function trocar(modelo, valores) {
    return String(modelo).replace(/\{(\w+)\}/g, function (_, nome) {
      return valores[nome] !== undefined ? String(valores[nome]) : '';
    });
  }

  function motivoTexto(codigo) {
    var m = TEXTOS.motivos[codigo];
    return trocar(TEXTOS.recusada, { motivo: m || TEXTOS.motivos.nao_processavel });
  }

  /** Lista fechada de chaves vinda do servidor (98 §2.1). Nada mais e lido. */
  function mapearFotos(lista) {
    var saida = [];
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i] || {};
      if (typeof f.id !== 'string') continue;
      saida.push({
        id: f.id,
        estado: String(f.estado || ''),
        motivo: typeof f.motivo === 'string' ? f.motivo : null,
        posicao: typeof f.posicao === 'number' ? f.posicao : null
      });
    }
    return saida;
  }

  /** Fotos vivas (nao recusadas), na ordem exibida. Recusadas ficam ao fim e nao contam (98 §2.1). */
  function vivasDe(lista) {
    return lista.filter(function (f) { return f.estado !== 'recusada'; });
  }

  function copiar(lista) {
    return lista.map(function (f) { return { id: f.id, estado: f.estado, motivo: f.motivo, posicao: f.posicao }; });
  }

  function mesmaSequencia(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Pedido HTTP com as opcoes comuns: mesma origem, sem cache, sem referrer, sem redirecionamento. */
  function criarPedir(fetchImpl) {
    return function (metodo, caminho, corpo) {
      var opcoes = {
        method: metodo,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {}
      };
      if (corpo !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
      }
      return fetchImpl(caminho, opcoes).then(
        function (res) {
          return res.text().then(
            function (texto) {
              var dados = null;
              try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = null; }
              return { status: res.status, retryAfter: res.headers ? res.headers.get('Retry-After') : null, dados: dados };
            },
            function () { return { status: res.status, retryAfter: null, dados: null }; }
          );
        },
        function () { return { status: 0, retryAfter: null, dados: null }; }
      );
    };
  }

  function montarFotos(raiz, opcoes) {
    var doc = opcoes.documento;
    var fetchImpl = opcoes.fetch;
    var agendar = opcoes.agendar || function (fn, ms) { return janela.setTimeout(fn, ms); };
    var cancelar = opcoes.cancelarAgendamento || function (id) { janela.clearTimeout(id); };
    var criarUrl = opcoes.criarUrlObjeto || function (blob) { return janela.URL.createObjectURL(blob); };
    var revogarUrl = opcoes.revogarUrlObjeto || function (url) { janela.URL.revokeObjectURL(url); };
    var pedir = criarPedir(fetchImpl);

    var estado = {
      carregando: true,
      erroLista: null,
      gravada: [],
      exibida: [],
      salvando: null,
      ultimaMudanca: null,
      erroOrdem: false,
      erroExclusao: {},
      falhaImagem: {},
      imagemPedida: {},
      urls: {},
      leiturasAtivas: 0,
      fila: [],
      finalizadas: {},
      consultas: 0,
      timer: null,
      parado: false,
      excluindo: null,
      alvoDialogo: null,
      ocupadoDialogo: false,
      focoPendente: null,
      chaveFocada: null,
      botoes: {},
      limiteAviso: false,
      mensagemRetry429: false
    };

    // ---- DOM base (criado uma vez) ----
    var pagina = doc.createElement('section');
    pagina.setAttribute('class', 'fotos-pagina');
    pagina.setAttribute('id', 'fotos-pagina');
    var h1 = doc.createElement('h1');
    h1.textContent = TEXTOS.titulo;
    var aviso = doc.createElement('p');
    aviso.setAttribute('class', 'fotos-aviso');
    aviso.textContent = TEXTOS.aviso;
    var contador = doc.createElement('p');
    contador.setAttribute('class', 'fotos-contador');
    var status = doc.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('class', 'fotos-status');
    var lista = doc.createElement('ul');
    lista.setAttribute('class', 'fotos-lista');
    lista.setAttribute('id', 'fotos-lista');
    var bloco = doc.createElement('div');
    bloco.setAttribute('class', 'fotos-bloco-erro');
    var adicionar = doc.createElement('button');
    adicionar.setAttribute('type', 'button');
    adicionar.setAttribute('class', 'fotos-adicionar');
    adicionar.textContent = TEXTOS.adicionar;
    var avisoAdicionar = doc.createElement('p');
    avisoAdicionar.setAttribute('class', 'fotos-aviso-adicionar');
    avisoAdicionar.setAttribute('role', 'alert');
    var dialogo = doc.createElement('dialog');
    dialogo.setAttribute('class', 'fotos-dialogo');
    dialogo.setAttribute('aria-labelledby', 'fotos-dialogo-titulo');
    var dialogoTitulo = doc.createElement('h2');
    dialogoTitulo.setAttribute('id', 'fotos-dialogo-titulo');
    dialogoTitulo.textContent = TEXTOS.dialogoTitulo;
    var dialogoCancelar = doc.createElement('button');
    dialogoCancelar.setAttribute('type', 'button');
    dialogoCancelar.setAttribute('class', 'fotos-botao-secundario');
    dialogoCancelar.textContent = TEXTOS.cancelar;
    var dialogoConfirmar = doc.createElement('button');
    dialogoConfirmar.setAttribute('type', 'button');
    dialogoConfirmar.setAttribute('class', 'fotos-botao-perigo');
    dialogoConfirmar.textContent = TEXTOS.excluirConfirmar;
    dialogo.appendChild(dialogoTitulo);
    dialogo.appendChild(dialogoCancelar);
    dialogo.appendChild(dialogoConfirmar);

    pagina.appendChild(h1);
    pagina.appendChild(aviso);
    pagina.appendChild(contador);
    pagina.appendChild(status);
    pagina.appendChild(bloco);
    pagina.appendChild(lista);
    pagina.appendChild(avisoAdicionar);
    pagina.appendChild(adicionar);
    pagina.appendChild(dialogo);
    raiz.appendChild(pagina);

    function anunciar(texto) {
      status.textContent = texto;
    }

    function fixarFoco(chave) {
      estado.focoPendente = chave;
    }

    function limparRaiz(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
    }

    function botao(texto, chave, classe, aoClicar, desativado) {
      var b = doc.createElement('button');
      b.setAttribute('type', 'button');
      b.setAttribute('class', classe);
      b.textContent = texto;
      if (desativado) b.setAttribute('aria-disabled', 'true');
      b.chaveFoco = chave;
      b.addEventListener('click', function () {
        if (desativado) return;
        aoClicar();
      });
      estado.botoes[chave] = b;
      return b;
    }

    function texto(el, valor, classe) {
      var p = doc.createElement(el);
      if (classe) p.setAttribute('class', classe);
      p.textContent = valor;
      return p;
    }

    function urlDe(id) {
      return estado.urls[id] || null;
    }

    function liberarUrls(idsManter) {
      Object.keys(estado.urls).forEach(function (id) {
        if (idsManter && idsManter.indexOf(id) !== -1) return;
        revogarUrl(estado.urls[id]);
        delete estado.urls[id];
      });
    }

    // ---- Imagem (CA-02): leitura em no maximo LEITURAS_EM_PARALELO, Blob em memoria ----
    function enfileirarImagem(foto, numero, total) {
      if (estado.imagemPedida[foto.id] || estado.urls[foto.id] || estado.falhaImagem[foto.id]) return;
      estado.imagemPedida[foto.id] = true;
      estado.fila.push({ foto: foto, numero: numero, total: total });
      proximaImagem();
    }

    function proximaImagem() {
      while (estado.leiturasAtivas < LEITURAS_EM_PARALELO && estado.fila.length > 0) {
        var item = estado.fila.shift();
        estado.leiturasAtivas++;
        lerImagem(item);
      }
    }

    function lerImagem(item) {
      var id = item.foto.id;
      if (estado.exibida.map(function (f) { return f.id; }).indexOf(id) === -1) {
        estado.leiturasAtivas--;
        delete estado.imagemPedida[id];
        proximaImagem();
        return;
      }
      fetchImpl('/api/v1/media/' + id + '/image', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      }).then(
        function (res) {
          if (!res.ok) throw new Error('imagem');
          return res.blob();
        }
      ).then(
        function (blob) {
          estado.leiturasAtivas--;
          delete estado.imagemPedida[id];
          if (estado.exibida.map(function (f) { return f.id; }).indexOf(id) === -1) {
            proximaImagem();
            return;
          }
          estado.urls[id] = criarUrl(blob);
          render();
          proximaImagem();
        }
      ).catch(function () {
        estado.leiturasAtivas--;
        delete estado.imagemPedida[id];
        estado.falhaImagem[id] = true;
        render();
        proximaImagem();
      });
    }

    function tentarImagemDe(id) {
      delete estado.falhaImagem[id];
      render();
      var idx = posicaoNaLista(id);
      if (idx < 0) return;
      var f = estado.exibida[idx];
      var vivas = vivasDe(estado.exibida);
      var n = vivas.indexOf(f) + 1;
      enfileirarImagem(f, n, vivas.length);
    }

    function posicaoNaLista(id) {
      for (var i = 0; i < estado.exibida.length; i++) if (estado.exibida[i].id === id) return i;
      return -1;
    }

    // ---- Polling (CA-03): 3 s, no maximo 20 consultas por episodio, pausa com a aba oculta ----
    function precisaConsultar() {
      return estado.exibida.some(function (f) { return f.estado === 'processando' || f.estado === 'aguardando'; });
    }

    function agendarConsulta(atrasoMs) {
      if (estado.timer !== null || estado.parado) return;
      if (doc.hidden) return;
      if (!precisaConsultar()) {
        estado.consultas = 0;
        return;
      }
      if (estado.consultas >= CONSULTAS_MAX) {
        render();
        return;
      }
      estado.timer = agendar(function () {
        estado.timer = null;
        estado.consultas++;
        carregarLista(true);
      }, atrasoMs || INTERVALO_CONSULTA_MS);
    }

    function finalizarAguardando() {
      estado.exibida.forEach(function (f) {
        if (f.estado === 'aguardando' && !estado.finalizadas[f.id]) {
          estado.finalizadas[f.id] = true;
          pedir('POST', '/api/v1/media/' + f.id + '/finalize').then(function () {
            agendarConsulta(INTERVALO_CONSULTA_MS);
          });
        }
      });
    }

    // ---- Lista (CA-01, CA-09) ----
    function carregarLista(silencioso) {
      if (!silencioso) {
        estado.carregando = true;
        render();
      }
      return pedir('GET', CAMINHO_FOTOS).then(function (r) {
        if (r.status === 200 && r.dados && Array.isArray(r.dados.fotos)) {
          estado.carregando = false;
          estado.erroLista = null;
          estado.gravada = mapearFotos(r.dados.fotos);
          estado.exibida = copiar(estado.gravada);
          sincronizarImagens();
          render();
          if (precisaConsultar()) finalizarAguardando();
          agendarConsulta(INTERVALO_CONSULTA_MS);
          return;
        }
        estado.carregando = false;
        if (r.status === 404) estado.erroLista = 'rascunho';
        else if (r.status === 429) estado.erroLista = 'muitas';
        else estado.erroLista = 'falha';
        estado.exibida = [];
        liberarUrls([]);
        render();
      });
    }

    function sincronizarImagens() {
      var ids = estado.exibida.map(function (f) { return f.id; });
      liberarUrls(ids);
      var vivas = vivasDe(estado.exibida);
      vivas.forEach(function (f, i) {
        if (f.estado === 'pronta') enfileirarImagem(f, i + 1, vivas.length);
      });
    }

    // ---- Renderizacao (rebuild por estado; foco restaurado pela chave) ----
    function render() {
      var focoAtual = doc.activeElement && doc.activeElement.chaveFoco ? doc.activeElement.chaveFoco : null;
      estado.botoes = {};
      var vivas = vivasDe(estado.exibida);
      var total = vivas.length;
      contador.textContent = trocar(TEXTOS.contador, { n: total });
      status.setAttribute('aria-busy', estado.salvando !== null ? 'true' : 'false');
      limparRaiz(bloco);
      limparRaiz(lista);
      if (estado.carregando) {
        status.textContent = TEXTOS.carregando;
      }
      if (!estado.carregando && estado.erroLista !== null) {
        var msg = estado.erroLista === 'rascunho' ? TEXTOS.rascunhoVencido
          : estado.erroLista === 'muitas' ? TEXTOS.muitasAcoes : TEXTOS.erroLista;
        bloco.appendChild(texto('p', msg, 'fotos-erro'));
        bloco.setAttribute('role', 'alert');
        if (estado.erroLista !== 'rascunho') {
          bloco.appendChild(botao(TEXTOS.tentarDeNovo, 'lista:tentar', 'fotos-botao', function () { carregarLista(false); }, false));
        }
      } else {
        bloco.removeAttribute('role');
      }
      if (estado.erroOrdem) {
        bloco.appendChild(texto('p', TEXTOS.erroOrdem, 'fotos-erro'));
        bloco.appendChild(botao(TEXTOS.tentarDeNovo, 'ordem:tentar', 'fotos-botao', function () {
          if (estado.ultimaMudanca) moverFoto(estado.ultimaMudanca.id, estado.ultimaMudanca.direcao);
        }, false));
      }

      if (!estado.carregando && estado.erroLista === null) {
        if (estado.exibida.length === 0) {
          lista.appendChild(texto('li', TEXTOS.vazio, 'fotos-vazio'));
        }
        estado.exibida.forEach(function (f, i) {
          lista.appendChild(montarCartao(f, i, vivas, total));
        });
      }

      var podeAdicionar = total < LIMITE_FOTOS && !estado.carregando && estado.erroLista === null;
      adicionar.setAttribute('aria-disabled', podeAdicionar ? 'false' : 'true');
      adicionar.chaveFoco = 'adicionar';
      avisoAdicionar.textContent = total >= LIMITE_FOTOS ? TEXTOS.limite : '';
      if (opcoes.adicionarFoto === undefined) {
        adicionar.setAttribute('aria-disabled', 'true');
        avisoAdicionar.textContent = TEXTOS.indisponivelNoNavegador;
      }

      // Foco: o pedido explicito tem prioridade; senao volta ao controle de mesma chave, se ainda existir.
      var alvo = estado.focoPendente || focoAtual;
      estado.focoPendente = null;
      if (alvo) {
        var b = estado.botoes[alvo] || (alvo === 'adicionar' ? adicionar : null);
        if (b && b.focus) b.focus();
      }
    }

    function montarCartao(f, i, vivas, total) {
      var li = doc.createElement('li');
      li.setAttribute('class', 'fotos-cartao');
      li.setAttribute('data-foto', f.id);
      var vivo = f.estado !== 'recusada';
      var n = vivo ? vivas.indexOf(f) + 1 : null;
      var h2 = doc.createElement('h2');
      h2.setAttribute('tabindex', '-1');
      h2.textContent = vivo ? trocar(TEXTOS.rotuloFoto, { n: n, m: total }) : TEXTOS.recusadaSemNumero;
      li.appendChild(h2);

      if (f.estado === 'pronta') {
        var url = urlDe(f.id);
        if (url) {
          var img = doc.createElement('img');
          img.setAttribute('src', url);
          img.setAttribute('alt', trocar(TEXTOS.fotoAlt, { n: n, m: total }));
          img.setAttribute('class', 'fotos-miniatura');
          li.appendChild(img);
        } else if (estado.falhaImagem[f.id]) {
          li.appendChild(texto('p', TEXTOS.erroImagem, 'fotos-erro'));
          li.appendChild(botao(TEXTOS.tentarDeNovo, 'imagem:' + f.id, 'fotos-botao', function () { tentarImagemDe(f.id); }, false));
        } else {
          li.appendChild(texto('p', trocar(TEXTOS.carregandoFoto, { n: n }), 'fotos-carregando'));
        }
        li.appendChild(texto('p', TEXTOS.pronta, 'fotos-estado'));
      } else if (f.estado === 'recusada') {
        li.appendChild(texto('p', motivoTexto(f.motivo), 'fotos-estado'));
      } else if (f.estado === 'enviando') {
        li.appendChild(texto('p', TEXTOS.enviando, 'fotos-estado'));
      } else {
        li.appendChild(texto('p', TEXTOS.processando, 'fotos-estado'));
        if (estado.consultas >= CONSULTAS_MAX && f.estado === 'processando') {
          li.appendChild(texto('p', TEXTOS.ainda, 'fotos-erro'));
          li.appendChild(botao(TEXTOS.tentarDeNovo, 'ainda:' + f.id, 'fotos-botao', function () {
            estado.consultas = 0;
            carregarLista(true);
          }, false));
        }
      }

      if (estado.excluindo === null && estado.erroExclusao[f.id]) {
        li.appendChild(texto('p', TEXTOS.erroExclusao, 'fotos-erro'));
        li.appendChild(botao(TEXTOS.tentarDeNovo, 'excluir:' + f.id, 'fotos-botao', function () { abrirDialogo(f, i); }, false));
      }

      var acoes = doc.createElement('div');
      acoes.setAttribute('class', 'fotos-acoes');
      if (f.estado === 'pronta') {
        var ocupado = estado.salvando !== null;
        var pos = vivas.indexOf(f);
        var antes = pos > 0;
        var depois = pos < vivas.length - 1;
        if (ocupado) li.appendChild(texto('p', TEXTOS.salvandoOrdem, 'fotos-estado'));
        acoes.appendChild(botao(trocar(TEXTOS.rotuloMoverAntes, { n: n }), 'antes:' + f.id, 'fotos-botao', function () {
          moverFoto(f.id, 'antes');
        }, ocupado || !antes));
        acoes.appendChild(botao(trocar(TEXTOS.rotuloMoverDepois, { n: n }), 'depois:' + f.id, 'fotos-botao', function () {
          moverFoto(f.id, 'depois');
        }, ocupado || !depois));
      }
      var rotuloExcluir = n !== null ? trocar(TEXTOS.rotuloExcluir, { n: n }) : TEXTOS.rotuloExcluirNaoUsada;
      acoes.appendChild(botao(rotuloExcluir, 'excluir:' + f.id, 'fotos-botao fotos-botao-perigo', function () {
        abrirDialogo(f, i);
      }, false));
      li.appendChild(acoes);
      return li;
    }

    // ---- Reordenacao (CA-07, CA-08): otimista, uma gravacao por vez, volta a gravada em falha ----
    function moverFoto(id, direcao) {
      if (estado.salvando !== null) return;
      var vivas = vivasDe(estado.exibida);
      var pos = -1;
      for (var k = 0; k < vivas.length; k++) if (vivas[k].id === id) pos = k;
      if (pos < 0) return;
      var alvo = direcao === 'antes' ? pos - 1 : pos + 1;
      if (alvo < 0 || alvo >= vivas.length) return;
      var atual = vivas.map(function (f) { return f.id; });
      var nova = atual.slice();
      nova[pos] = atual[alvo];
      nova[alvo] = id;
      var recusadas = estado.exibida.filter(function (f) { return f.estado === 'recusada'; });
      var reordenada = nova.map(function (vid, idx) {
        var f = vivas.filter(function (x) { return x.id === vid; })[0];
        return { id: f.id, estado: f.estado, motivo: null, posicao: idx + 1 };
      }).concat(recusadas);
      estado.ultimaMudanca = { id: id, direcao: direcao };
      estado.erroOrdem = false;
      estado.exibida = reordenada;
      estado.salvando = id;
      fixarFoco(direcao + ':' + id);
      render();

      pedir('PUT', CAMINHO_ORDEM, { ordem_atual: atual, ordem_nova: nova }).then(function (r) {
        estado.salvando = null;
        var lista2 = r.dados && Array.isArray(r.dados.fotos) ? mapearFotos(r.dados.fotos) : null;
        if (r.status === 200 && lista2) {
          estado.gravada = lista2;
          estado.exibida = copiar(lista2);
          estado.ultimaMudanca = null;
          var nova2 = vivasDe(lista2).map(function (f) { return f.id; });
          anunciar(trocar(TEXTOS.anunciaMovida, { n: pos + 1, m: nova2.indexOf(id) + 1, x: nova2.length }));
          fixarFoco(direcao + ':' + id);
          sincronizarImagens();
          render();
          return;
        }
        if (r.status === 409 && lista2 && r.dados.code === 'ordem_mudou') {
          var vivasServidor = vivasDe(lista2).map(function (f) { return f.id; });
          estado.gravada = lista2;
          estado.exibida = copiar(lista2);
          estado.ultimaMudanca = null;
          sincronizarImagens();
          if (mesmaSequencia(vivasServidor, nova)) {
            anunciar(trocar(TEXTOS.anunciaMovida, { n: pos + 1, m: vivasServidor.indexOf(id) + 1, x: vivasServidor.length }));
          } else {
            anunciar(TEXTOS.anunciaOrdemMudou);
          }
          render();
          return;
        }
        // Falha: volta a ordem gravada (CA-08) e oferece Tentar de novo.
        estado.exibida = copiar(estado.gravada);
        estado.erroOrdem = true;
        fixarFoco('ordem:tentar');
        anunciar(TEXTOS.erroOrdem);
        sincronizarImagens();
        render();
      });
    }

    // ---- Exclusao (CA-05, CA-06): nada sai da lista antes da resposta do servidor ----
    function abrirDialogo(f, i) {
      if (estado.excluindo !== null) return;
      var vivas = vivasDe(estado.exibida);
      var n = vivas.indexOf(f) + 1;
      estado.alvoDialogo = { id: f.id, n: n || null, gatilho: 'excluir:' + f.id, indice: i };
      estado.ocupadoDialogo = false;
      dialogoConfirmar.setAttribute('aria-busy', 'false');
      if (typeof dialogo.showModal === 'function') dialogo.showModal();
      else dialogo.setAttribute('open', '');
      dialogoCancelar.focus();
    }

    function fecharDialogo(devolverFoco) {
      var alvo = estado.alvoDialogo;
      estado.alvoDialogo = null;
      if (typeof dialogo.close === 'function') dialogo.close();
      else dialogo.removeAttribute('open');
      if (devolverFoco && alvo) fixarFoco(alvo.gatilho);
      if (devolverFoco) render();
    }

    dialogoCancelar.addEventListener('click', function () { fecharDialogo(true); });
    dialogo.addEventListener('close', function () {
      if (estado.alvoDialogo !== null && !estado.ocupadoDialogo) fecharDialogo(true);
    });

    dialogoConfirmar.addEventListener('click', function () {
      var alvo = estado.alvoDialogo;
      if (alvo === null || estado.ocupadoDialogo) return;
      estado.ocupadoDialogo = true;
      estado.excluindo = alvo.id;
      dialogoConfirmar.setAttribute('aria-busy', 'true');
      pedir('DELETE', caminhoItem(alvo.id)).then(function (r) {
        estado.ocupadoDialogo = false;
        estado.excluindo = null;
        dialogoConfirmar.setAttribute('aria-busy', 'false');
        if (r.status === 200 || r.status === 404) {
          estado.exibida = estado.exibida.filter(function (f) { return f.id !== alvo.id; });
          estado.gravada = estado.gravada.filter(function (f) { return f.id !== alvo.id; });
          delete estado.erroExclusao[alvo.id];
          liberarUrls(estado.exibida.map(function (f) { return f.id; }));
          var vivas = vivasDe(estado.exibida);
          if (vivas.length === 0 && estado.exibida.length === 0) fixarFoco('adicionar');
          else fixarFoco(proximoFoco(alvo.indice));
          estado.alvoDialogo = null;
          if (typeof dialogo.close === 'function') dialogo.close();
          else dialogo.removeAttribute('open');
          anunciar(trocar(TEXTOS.anunciaExcluida, { n: alvo.n || '' }));
          render();
          if (r.status === 404) carregarLista(true);
          return;
        }
        estado.erroExclusao[alvo.id] = true;
        estado.alvoDialogo = null;
        if (typeof dialogo.close === 'function') dialogo.close();
        else dialogo.removeAttribute('open');
        fixarFoco('excluir:' + alvo.id);
        anunciar(TEXTOS.erroExclusao);
        render();
      });
    });

    /** Foco apos excluir (CA-05): o item seguinte, senao o anterior, senao Adicionar foto. */
    function proximoFoco(indiceAntigo) {
      var lista2 = estado.exibida;
      if (lista2.length === 0) return 'adicionar';
      var idx = Math.min(indiceAntigo, lista2.length - 1);
      return 'excluir:' + lista2[idx].id;
    }

    // ---- Adicionar foto (CA-04): entra pela porta do envio; sem porta, o botao fica indisponivel ----
    adicionar.addEventListener('click', function () {
      var vivas = vivasDe(estado.exibida);
      if (vivas.length >= LIMITE_FOTOS) {
        anunciar(TEXTOS.limite);
        return;
      }
      if (typeof opcoes.adicionarFoto === 'function') opcoes.adicionarFoto();
    });

    // ---- Ciclo de vida ----
    function pararTudo() {
      estado.parado = true;
      if (estado.timer !== null) {
        cancelar(estado.timer);
        estado.timer = null;
      }
      liberarUrls([]);
    }

    function aoVisibilidade() {
      if (!doc.hidden && !estado.parado) agendarConsulta(0);
    }

    if (doc.addEventListener) {
      doc.addEventListener('visibilitychange', aoVisibilidade);
    }
    if (janela.addEventListener) {
      janela.addEventListener('pagehide', pararTudo);
    }

    render();
    carregarLista(false);

    return {
      estado: estado,
      carregarLista: carregarLista,
      moverFoto: moverFoto,
      abrirDialogo: function (id) {
        var i = posicaoNaLista(id);
        if (i >= 0) abrirDialogo(estado.exibida[i], i);
      },
      confirmarExclusao: function () { dialogoConfirmar.click(); },
      cancelarExclusao: function () { dialogoCancelar.click(); },
      pararTudo: pararTudo,
      elementos: { pagina: pagina, lista: lista, status: status, contador: contador, dialogo: dialogo, adicionar: adicionar }
    };
  }

  var api = { montarFotos: montarFotos, TEXTOS: TEXTOS, LIMITE_FOTOS: LIMITE_FOTOS, CONSULTAS_MAX: CONSULTAS_MAX };
  janela.FastProFotos = api;

  // Pagina: liga o controlador ao elemento de entrada, com as portas do navegador.
  var docGlobal = janela.document;
  var raizPagina = docGlobal && docGlobal.getElementById ? docGlobal.getElementById('fotos-raiz') : null;
  if (raizPagina) {
    montarFotos(raizPagina, {
      documento: docGlobal,
      fetch: janela.fetch.bind(janela)
    });
  }
})(globalThis);
