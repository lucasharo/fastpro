// #155 (desenho 178, AD-155-01, 07, 09) | Texto unico dos blocos comuns (cabecalho, subnavegacao e rodape).
// Usado por scripts/sincronizar-navegacao.mjs, que grava os blocos nas paginas. Ferramenta de desenvolvimento: nao vai ao navegador.
import { ROTAS } from '../public/navegacao-logica.js';

/** Itens do menu principal, na ordem do cabecalho (chave `item` de ROTAS). */
export const MENU = Object.freeze([
  { item: 'inicio', href: '/', rotulo: 'Início' },
  { item: 'pedir', href: '/pedido', rotulo: 'Pedir um serviço' },
  { item: 'painel', href: '/painel', rotulo: 'Meus pedidos' },
  { item: 'entrar', href: '/entrar', rotulo: 'Entrar' },
  { item: 'profissional', href: '/profissional/entrar', rotulo: 'Sou profissional' }
]);

/** Passos do profissional (chave `subitem` de ROTAS). */
export const SUBITENS = Object.freeze([
  { subitem: 'documentos', href: '/profissional-documentos', rotulo: 'Documento' },
  { subitem: 'situacao', href: '/profissional-situacao', rotulo: 'Situação' },
  { subitem: 'perfil', href: '/profissional-perfil', rotulo: 'Perfil' }
]);

/** Itens do rodape (sem marca de pagina atual). */
export const RODAPE = Object.freeze([
  { href: '/', rotulo: 'Início' },
  { href: '/pedido', rotulo: 'Pedir um serviço' },
  { href: '/profissional/entrar', rotulo: 'Sou profissional' }
]);

export const MARCA_SENTINELA = '<span id="conteudo" tabindex="-1"></span>';
export const LINK_CSS_COMUM = '<link rel="stylesheet" href="/navegacao.css" />';

function atual(marcado) {
  return marcado ? ' aria-current="page"' : '';
}

/** Linhas (sem indentacao) do cabecalho comum. `item` e o item do menu da rota ou nulo. */
export function linhasCabecalho(item) {
  return [
    '<a class="pular" href="#conteudo">Pular para o conteúdo</a>',
    '<header class="fp-cab">',
    '  <a class="fp-logo" href="/">FastPro</a>',
    '  <nav aria-label="Principal">',
    '    <ul class="fp-menu">',
    ...MENU.map((m) => `      <li><a href="${m.href}"${atual(m.item === item)}>${m.rotulo}</a></li>`),
    '    </ul>',
    '  </nav>',
    '</header>'
  ];
}

/** Linhas da subnavegacao do profissional (so nas tres telas do passo). */
export function linhasSubnav(subitem) {
  return [
    '<nav class="fp-sub" aria-label="Passos do profissional">',
    '  <ul class="fp-menu">',
    ...SUBITENS.map((s) => `    <li><a href="${s.href}"${atual(s.subitem === subitem)}>${s.rotulo}</a></li>`),
    '  </ul>',
    '</nav>'
  ];
}

/** Linhas do rodape comum. */
export function linhasRodape() {
  return [
    '<footer class="fp-rod">',
    '  <nav aria-label="Rodapé">',
    '    <ul class="fp-menu">',
    ...RODAPE.map((r) => `      <li><a href="${r.href}">${r.rotulo}</a></li>`),
    '    </ul>',
    '  </nav>',
    '</footer>'
  ];
}

/** Os tres blocos de uma rota. `subnav` e nulo fora dos passos do profissional. */
export function blocos(rota) {
  const entrada = ROTAS.find((r) => r.rota === rota);
  if (!entrada) throw new Error(`rota fora de ROTAS: ${rota}`);
  return {
    cabecalho: linhasCabecalho(entrada.item),
    subnav: entrada.subitem ? linhasSubnav(entrada.subitem) : null,
    rodape: linhasRodape()
  };
}
