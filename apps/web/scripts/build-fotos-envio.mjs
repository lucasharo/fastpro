// E3 (Issue #141) | Gera apps/web/public/fotos-envio.js: bundle IIFE minificado da entrada do envio de foto
// (apps/web/src/media/fotos-entrada.ts), que reusa reduzir-foto.ts e as regras de packages/domain (uma so fonte).
// Decisao 194 (esbuild como devDependency gratuita). O arquivo gerado e ignorado pelo git (como tokens.css).
// Pre-requisito: o build de @fastpro/domain (dist), garantido por turbo (dependsOn ^build).
import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizWeb = join(aqui, '..');
const entrada = join(raizWeb, 'src', 'media', 'fotos-entrada.ts');
const destino = join(raizWeb, 'public', 'fotos-envio.js');
const distDominio = join(raizWeb, '..', '..', 'packages', 'domain', 'dist', 'index.js');

if (!existsSync(distDominio)) {
  console.error('fotos-envio.js: dist de @fastpro/domain ausente; rode antes o build do dominio (corepack pnpm --filter @fastpro/domain build).');
  process.exit(1);
}

try {
  await build({
    entryPoints: [entrada],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    outfile: destino,
    logLevel: 'error',
  });
} catch {
  console.error('fotos-envio.js: falha ao gerar o bundle do envio de foto.');
  process.exit(1);
}
console.log(`fotos-envio.js publicado em apps/web/public (${statSync(destino).size} bytes)`);
