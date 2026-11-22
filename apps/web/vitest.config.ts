// Os testes de navegador (tests/e2e, Playwright) nao rodam no Vitest: exclui-os da suite unitaria.
// Os modulos da tela importam outros por caminho absoluto ('/navegacao-logica.js'), como o navegador faz; nos testes,
// esse caminho aponta para public/. publicDir desligado: senao o Vite recusa importar arquivo de public/.
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const publico = fileURLToPath(new URL('./public/', import.meta.url));

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: [{ find: /^\/([a-z0-9-]+\.js)$/, replacement: `${publico}$1` }],
  },
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
