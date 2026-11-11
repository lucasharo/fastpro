import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/node_modules/**', '**/coverage/**'],
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
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
