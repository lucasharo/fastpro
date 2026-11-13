// H-030 (Issue #43) | Configuracao do Playwright (90-DESENHO-H030 §7.4, decisao 169). Navegador: Chromium local
// (baixado com `corepack pnpm exec playwright install chromium`, fora do repositorio). Nao sobe servidor: as
// paginas de apps/web/public sao servidas pelo proprio teste, por route, sem porta e sem rede.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  reporter: [['list']],
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  use: {
    baseURL: 'http://fastpro.test',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
