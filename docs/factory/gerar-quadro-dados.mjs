// Gera quadro-dados.js a partir de quadro-status.md, para a pagina quadro.html abrir sem servidor.
// Uso: node docs/factory/gerar-quadro-dados.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(pasta, 'quadro-status.md'), 'utf8');
const exec = JSON.parse(readFileSync(join(pasta, 'quadro-execucao.json'), 'utf8'));
writeFileSync(
  join(pasta, 'quadro-dados.js'),
  `// Gerado por gerar-quadro-dados.mjs a partir de quadro-status.md. Nao editar a mao.\nwindow.QUADRO_MD = ${JSON.stringify(md)};
window.QUADRO_EXEC = ${JSON.stringify(exec.executando)};\n`,
  'utf8',
);
console.log('quadro-dados.js gerado');
