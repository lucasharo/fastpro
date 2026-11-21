import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Saida de cobertura gerada: so na raiz ou em apps/x e packages/x (nao em src/coverage).
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'coverage/**',
      '*/*/coverage/**',
      // Bundles gerados de apps/web/public (saida de build, nao codigo fonte).
      'apps/web/public/fotos-envio.js',
      'apps/web/public/situacao-bundle.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // H-007: codigo de producao nao usa console; o logger de @fastpro/observability e o unico canal.
    files: [
      'apps/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'apps/*/api/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'packages/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
    ],
    ignores: ['packages/observability/**'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      // Globais do Node usadas por testes e scripts .mjs.
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
