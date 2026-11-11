// Imprime a tabela de contraste (WCAG 2.2) dos pares declarados, nos dois temas.
// Uso: pnpm --filter @fastpro/tokens report:contrast (depois do build). Nao altera cores.
import { evaluatePairs, informationalPairs, textContrastPairs } from '../dist/index.js';

const groups = [
  ['TEXTO (AA 4.5:1)', textContrastPairs],
  ['NAO-TEXTO (3:1, informativo)', informationalPairs],
];
for (const [title, pairs] of groups) {
  console.log(`-- ${title}`);
  for (const r of evaluatePairs(pairs)) {
    const status = r.passes ? 'ok' : 'ABAIXO';
    console.log(`${r.theme.padEnd(5)} ${r.pair.id.padEnd(26)} ${r.ratio.toFixed(2)}:1 ${status}`);
  }
}
