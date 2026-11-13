// Os testes de navegador (tests/e2e, Playwright) nao rodam no Vitest: exclui-os da suite unitaria.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
