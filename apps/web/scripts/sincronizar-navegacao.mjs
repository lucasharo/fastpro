#!/usr/bin/env node
// #155 (desenho 178, AD-155-01, 07, 09) | Grava os blocos comuns nas paginas de apps/web/public.
// Uso: node scripts/sincronizar-navegacao.mjs            (grava)
//      node scripts/sincronizar-navegacao.mjs --check    (so confere; codigo 1 se alguma pagina ficaria diferente)
// Marcadores: <!-- fp:cabecalho -->, <!-- fp:subnav -->, <!-- fp:rodape -->. Ausentes, sao criados nas ancoras certas.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROTAS } from '../public/navegacao-logica.js';
import { blocos, LINK_CSS_COMUM, MARCA_SENTINELA } from './navegacao-blocos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const checar = process.argv.includes('--check');

const abre = (nome) => `<!-- fp:${nome} -->`;
const fecha = (nome) => `<!-- /fp:${nome} -->`;

/** Bloco completo com marcadores, indentado com 4 espacos (dentro de body). */
function bloco(nome, linhas) {
  return [abre(nome), ...linhas.map((l) => `    ${l}`), `    ${fecha(nome)}`].join('\n');
}

function substituirOuInserir(html, nome, linhas, ancora) {
  const ini = html.indexOf(abre(nome));
  if (ini >= 0) {
    const fim = html.indexOf(fecha(nome), ini);
    if (fim < 0) throw new Error(`marcador ${nome} sem fechamento`);
    const fimTotal = fim + fecha(nome).length;
    return html.slice(0, ini) + bloco(nome, linhas) + html.slice(fimTotal);
  }
  const pos = ancora(html);
  if (pos < 0) throw new Error(`ancora nao achada para ${nome}`);
  return html.slice(0, pos) + '\n    ' + bloco(nome, linhas) + html.slice(pos);
}

function aplicar(html, rota) {
  const b = blocos(rota);
  let saida = html;

  // Cabecalho: logo depois de <body>.
  saida = substituirOuInserir(saida, 'cabecalho', b.cabecalho, (h) => {
    const m = /<body[^>]*>/.exec(h);
    return m ? m.index + m[0].length : -1;
  });

  // Subnavegacao: so nos passos do profissional; fora deles, remove se existir.
  if (b.subnav) {
    saida = substituirOuInserir(saida, 'subnav', b.subnav, (h) => {
      const m = fecha('cabecalho');
      const i = h.indexOf(m);
      return i < 0 ? -1 : i + m.length;
    });
  } else {
    saida = saida.replace(/\n[ \t]*<!-- fp:subnav -->[\s\S]*?<!-- \/fp:subnav -->/, '');
  }

  // Rodape: logo depois de </main>.
  saida = substituirOuInserir(saida, 'rodape', b.rodape, (h) => {
    const i = h.indexOf('</main>');
    return i < 0 ? -1 : i + '</main>'.length;
  });

  // Folha de estilo comum: logo depois de tokens.css.
  if (!saida.includes(LINK_CSS_COMUM)) {
    const re = /<link rel="stylesheet" href="\/tokens\.css"\s*\/>/;
    if (!re.test(saida)) throw new Error('tokens.css nao encontrado para inserir navegacao.css');
    saida = saida.replace(re, (t) => `${t}\n    ${LINK_CSS_COMUM}`);
  }

  // Alvo do "Pular para o conteudo": <main id="conteudo"> ou sentinela logo dentro do <main>.
  if (!/<main[^>]*\sid="conteudo"/.test(saida) && !saida.includes(MARCA_SENTINELA)) {
    const m = /<main[^>]*>/.exec(saida);
    if (!m) throw new Error('main nao encontrado');
    const pos = m.index + m[0].length;
    saida = saida.slice(0, pos) + `\n      ${MARCA_SENTINELA}` + saida.slice(pos);
  }

  return saida;
}

const diferentes = [];
for (const { rota, arquivo } of ROTAS) {
  const caminho = resolve(RAIZ, arquivo);
  const original = readFileSync(caminho, 'utf8');
  const novo = aplicar(original, rota);
  if (novo !== original) {
    diferentes.push(arquivo);
    if (!checar) writeFileSync(caminho, novo, 'utf8');
  }
}

if (checar) {
  if (diferentes.length > 0) {
    console.error(`navegacao fora de sincronia em: ${diferentes.join(', ')}`);
    console.error('Rode: node scripts/sincronizar-navegacao.mjs');
    process.exit(1);
  }
  console.log(`navegacao sincronizada em ${ROTAS.length} paginas`);
} else {
  console.log(`navegacao gravada em ${diferentes.length} pagina(s): ${diferentes.join(', ') || 'nenhuma alteracao'}`);
}
