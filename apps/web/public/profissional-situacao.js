// Issue 54 (H-041) | Renderizador da situacao do profissional (docs/factory/141-DESENHO-H041.md §6.4).
// Recebe o view-model de packages/domain (construirTela). Sem frases proprias, sem innerHTML: so textContent e
// atributos fixos. Estado anunciado por aria-live="polite". Sem pagina, sem navegacao e sem login (casca web fora).
function renderizarSituacao(raiz, tela) {
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

  raiz.appendChild(elemento('p', 'situacao-titulo', tela.titulo));

  if (tela.motivoTexto !== undefined) {
    var motivo = elemento('p', 'situacao-motivo');
    motivo.appendChild(elemento('strong', null, tela.motivoRotulo));
    motivo.appendChild(elemento('span', null, ' ' + tela.motivoTexto));
    raiz.appendChild(motivo);
  }

  if (tela.explicacao !== undefined) {
    var explicacao = elemento('p', 'situacao-explicacao');
    explicacao.appendChild(elemento('strong', null, tela.explicacaoRotulo));
    explicacao.appendChild(elemento('span', null, ' ' + tela.explicacao));
    raiz.appendChild(explicacao);
  }

  if (tela.dataValor !== undefined) {
    var data = elemento('p', 'situacao-data');
    data.appendChild(elemento('strong', null, tela.dataRotulo));
    data.appendChild(elemento('span', null, ' ' + tela.dataValor));
    raiz.appendChild(data);
  }

  if (tela.aviso !== undefined) {
    raiz.appendChild(elemento('p', 'situacao-aviso', tela.aviso));
  }

  if (tela.acao !== undefined) {
    var botao = elemento('button', 'situacao-acao', tela.acao.rotulo);
    botao.setAttribute('type', 'button');
    botao.setAttribute('data-destino', tela.acao.destino);
    if (tela.acao.desabilitada) botao.disabled = true;
    raiz.appendChild(botao);
  }

  return raiz;
}

if (typeof window !== 'undefined') window.renderizarSituacao = renderizarSituacao;
