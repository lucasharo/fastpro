// H-009 | Entrada da funcao na Vercel. Le o segredo do ambiente a cada chamada (nunca grava valor).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './app.js';

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await handleRequest(req, res, { tickSecret: process.env.JOBS_TICK_SECRET });
  } catch {
    // Sem detalhe de erro na resposta nem no log (ADR-013: sem dado sensivel).
    if (!res.headersSent) {
      res.writeHead(500, { 'Cache-Control': 'no-store' });
    }
    res.end();
  }
}
