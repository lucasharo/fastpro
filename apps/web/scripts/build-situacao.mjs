// #155 (desenho 178, AD-155-12) | Gera apps/web/public/situacao-bundle.js: bundle IIFE de src/situacao-entrada.ts, que expoe
// construirTela de packages/domain ao navegador. Mesmo padrao de build-fotos-envio.mjs (esbuild, devDependency gratuita).
// O arquivo gerado e ignorado pelo git (como fotos-envio.js). Pre-requisito: build de @fastpro/domain (dist).
import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conteudoStubNodeCrypto } from './stub-node-crypto.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizWeb = join(aqui, '..');
const entrada = join(raizWeb, 'src', 'situacao-entrada.ts');
const destino = join(raizWeb, 'public', 'situacao-bundle.js');
const distDominio = join(raizWeb, '..', '..', 'packages', 'domain', 'dist', 'index.js');

if (!existsSync(distDominio)) {
  console.error('situacao-bundle.js: dist de @fastpro/domain ausente; rode antes o build do dominio (corepack pnpm --filter @fastpro/domain build).');
  process.exit(1);
}

// O dominio exporta funcoes que usam node:crypto (so no servidor). O navegador so chama construirTela, entao node:crypto
// vira o mesmo stub do bundle de fotos (stub-node-crypto.mjs, fonte unica).
const semNodeCrypto = {
  name: 'sem-node-crypto',
  setup(construtor) {
    construtor.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'node:crypto', namespace: 'stub-node-crypto' }));
    construtor.onLoad({ filter: /.*/, namespace: 'stub-node-crypto' }, () => ({
      contents: conteudoStubNodeCrypto(),
      loader: 'js',
    }));
  },
};

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
    plugins: [semNodeCrypto],
  });
} catch {
  console.error('situacao-bundle.js: falha ao gerar o bundle da situacao.');
  process.exit(1);
}
console.log(`situacao-bundle.js publicado em apps/web/public (${statSync(destino).size} bytes)`);
