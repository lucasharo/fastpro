// A compilacao (tsc) copia os testes de src para dist; o Vitest roda so as fontes, sem duplicar a suite.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
