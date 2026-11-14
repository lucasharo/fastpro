/* global window */
// Issue 56 (H-043) | Renderizador do perfil publico (docs/factory/143-DESENHO-H043.md, §6.3).
// Recebe o view-model de packages/domain (construirTelaPerfil). Sem frases proprias, sem innerHTML: so
// createElement, textContent e atributos fixos. Estado anunciado por aria-live="polite". Sem rede e sem
// recurso externo. Sem pagina, sem navegacao e sem login (casca web fora desta entrega).
function renderizarPerfilPublico(raiz, tela) {
  var doc = raiz.ownerDocument;
  while (raiz.firstChild) raiz.removeChild(raiz.firstChild);
  raiz.setAttribute('aria-live', 'polite');
  raiz.setAttribute('data-estado', tela.tipo);

  function elemento(tag, classe, texto) {
    var no = doc.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined) no.textContent = texto;
    return no;
  }

  function secao(classe, titulo) {
    var bloco = elemento('section', classe);
    bloco.appendChild(elemento('h2', 'perfil-secao-titulo', titulo));
    return bloco;
  }

  if (tela.tipo === 'carregando' || tela.tipo === 'erro' || tela.tipo === 'nao_encontrado') {
    raiz.appendChild(elemento('p', 'perfil-aviso', tela.aviso));
    return raiz;
  }

  raiz.appendChild(elemento('h1', 'perfil-nome', tela.titulo));

  var selo = secao('perfil-secao perfil-selo', tela.selo.rotulo);
  var limites = elemento('details', 'perfil-selo-detalhe');
  limites.appendChild(elemento('summary', null, tela.selo.rotuloLimites));
  limites.appendChild(elemento('p', 'perfil-selo-limitacao', tela.selo.limitacao));
  selo.appendChild(limites);
  raiz.appendChild(selo);

  var servicos = secao('perfil-secao perfil-servicos', tela.textos.tituloServicos);
  if (tela.tipo === 'perfil_sem_servicos') {
    servicos.appendChild(elemento('p', 'perfil-aviso', tela.aviso));
  } else {
    tela.servicos.forEach(function (grupo) {
      var bloco = elemento('div', 'perfil-grupo');
      bloco.appendChild(elemento('h3', 'perfil-grupo-nome', grupo.groupName));
      var lista = elemento('ul', 'perfil-itens');
      grupo.items.forEach(function (item) {
        var linha = elemento('li', 'perfil-item');
        linha.appendChild(elemento('span', 'perfil-item-nome', item.name));
        var rotulos = item.modalities.map(function (modalidade) {
          return tela.textos.modalidades[modalidade];
        });
        linha.appendChild(elemento('span', 'perfil-item-modalidade', rotulos.join(', ')));
        lista.appendChild(linha);
      });
      bloco.appendChild(lista);
      servicos.appendChild(bloco);
    });
  }
  raiz.appendChild(servicos);

  var reputacao = secao('perfil-secao perfil-reputacao-secao', tela.textos.tituloReputacao);
  reputacao.appendChild(elemento('p', 'perfil-reputacao', tela.reputacao.rotulo));
  raiz.appendChild(reputacao);

  return raiz;
}

if (typeof window !== 'undefined') window.renderizarPerfilPublico = renderizarPerfilPublico;
