// predev de "corepack pnpm dev" (Issue #156, desenho 177 §6): compila a API (apps/api/dist/vercel.js) e gera os
// arquivos da web (tokens e envio de fotos). Qualquer falha interrompe o dev. Nao grava nada fora de dist/ e public/ gerados.
import { execSync } from 'node:child_process';

const PASSOS = [
  'corepack pnpm --filter "@fastpro/api..." build',
  'corepack pnpm --filter @fastpro/web run copy:tokens',
  'corepack pnpm --filter @fastpro/web run build:fotos-envio',
];

for (const passo of PASSOS) {
  try {
    execSync(passo, { stdio: 'inherit' });
  } catch {
    console.log(`predev: falhou: ${passo}`);
    process.exitCode = 1;
    break;
  }
}
