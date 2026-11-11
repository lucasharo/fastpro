// H-009: pacote da API (funcao unica da hospedagem Vercel).
export const PACKAGE_NAME = '@fastpro/api' as const;

export {
  APP_BODY_LIMIT_BYTES,
  HEALTH_PATH,
  handleRequest,
  readBodyBytes,
  routePath,
} from './app.js';
export type { AppOptions, BodyReadResult } from './app.js';
