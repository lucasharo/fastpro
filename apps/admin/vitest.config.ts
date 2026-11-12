// Configuracao dos testes do admin (H-107, CA-11). O tsconfig usa jsx "preserve" (Next.js); os testes
// de tela precisam do JSX transformado para executar em Node, por isso o runtime automatico aqui.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
});
