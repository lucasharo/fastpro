// Gera dist/tokens.css a partir do build do pacote (rodar depois de tsc).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCss } from '../dist/index.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'tokens.css');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, generateCss(), 'utf8');
console.log(`tokens.css gerado: ${out}`);
