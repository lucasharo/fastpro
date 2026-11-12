// H-035 | Publica o CSS dos tokens (fonte unica em packages/tokens) para a pagina estatica do web.
// Copia packages/tokens/dist/tokens.css para apps/web/public/tokens.css. O arquivo copiado e gerado e ignorado pelo
// git (.gitignore): nunca e versionado, assim o check de cor literal (check:hex) so ve o codigo do repositorio.
// Pre-requisito: o build do pacote de tokens (corepack pnpm --filter @fastpro/tokens build).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, '..', '..', '..', 'packages', 'tokens', 'dist', 'tokens.css');
const destino = join(aqui, '..', 'public', 'tokens.css');

if (!existsSync(origem)) {
  console.error('tokens.css ausente: rode antes o build de @fastpro/tokens (corepack pnpm --filter @fastpro/tokens build).');
  process.exit(1);
}
mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origem, destino);
console.log('tokens.css publicado em apps/web/public');
