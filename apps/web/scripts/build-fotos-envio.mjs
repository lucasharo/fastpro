// E3 (Issue 141) | Gera apps/web/public/fotos-envio.js: bundle IIFE minificado da entrada do envio de foto
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

// H-031 (#44): o dominio exporta a publicacao do pedido, que usa node:crypto (so no servidor). O bundle do navegador
// usa so a reducao de foto e nunca chama essas funcoes: node:crypto vira um stub que falha se for usado.
const semNodeCrypto = {
  name: 'sem-node-crypto',
  setup(construtor) {
    construtor.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'node:crypto', namespace: 'stub-node-crypto' }));
    construtor.onLoad({ filter: /.*/, namespace: 'stub-node-crypto' }, () => ({
      contents: 'const falha = () => { throw new Error("node:crypto indisponivel no navegador"); };\nexport const createHash = falha;\nexport const createHmac = falha;\nexport const timingSafeEqual = falha;\n',
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
  console.error('fotos-envio.js: falha ao gerar o bundle do envio de foto.');
  process.exit(1);
}
console.log(`fotos-envio.js publicado em apps/web/public (${statSync(destino).size} bytes)`);
