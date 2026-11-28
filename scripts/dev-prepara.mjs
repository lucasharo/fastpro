// predev de "corepack pnpm dev": compila os pacotes de que a web Next.js depende (API, tokens e dominio).
// Qualquer falha interrompe o dev. Nao grava nada fora de dist/.
import { execSync } from 'node:child_process';

const PASSOS = [
  'corepack pnpm --filter "@fastpro/web^..." build',
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
