// Atalhos da pagina inicial: cada card de "Servicos mais pedidos" preenche o campo de servico com o nome do catalogo
// e dispara a mesma busca de quem digita (evento input tratado por inicio.js). Nenhuma rede propria, nenhum estado.
const doc = globalThis.document;
const campo = doc.getElementById('servico');

for (const botao of doc.querySelectorAll('[data-servico]')) {
  botao.addEventListener('click', () => {
    if (!campo) return;
    campo.value = botao.getAttribute('data-servico') ?? '';
    campo.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    campo.focus({ preventScroll: true });
  });
}
