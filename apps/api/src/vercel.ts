// H-009 | Entrada da funcao na Vercel. Le o segredo do ambiente a cada chamada (nunca grava valor).
// H-019 | As integracoes sao montadas a cada chamada pelo ponto de montagem (composicao.ts), so com as
// variaveis completas. Sem fabrica de pool, a busca de servico continua 404.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './app.js';
import { montarIntegracoes } from './composicao.js';

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const integracoes = montarIntegracoes(process.env);
    await handleRequest(req, res, {
      tickSecret: process.env.JOBS_TICK_SECRET,
      catalog: integracoes.catalog,
    });
  } catch {
    // Sem detalhe de erro na resposta nem no log (ADR-013: sem dado sensivel).
    if (!res.headersSent) {
      res.writeHead(500, { 'Cache-Control': 'no-store' });
    }
    res.end();
  }
}
