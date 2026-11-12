// H-009 | Entrada da funcao na Vercel. Le o segredo do ambiente a cada chamada (nunca grava valor).
// H-019 | As integracoes sao montadas a cada chamada pelo ponto de montagem (composicao.ts), so com as
// variaveis completas. Sem fabrica de pool, a busca de servico continua 404.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './app.js';
import { montarIntegracoes } from './composicao.js';
import { abrirClienteSql } from './sql-pool.js';
import { criarFabricaCatalogo } from './catalog/fabrica-pg.js';
import { abrirPoolCatalogo } from './catalog/pool-pg.js';
import { criarFabricaRascunho } from './drafts/compose.js';

/** H-019: fabrica da busca de servico sobre o pool real (um pool por URL, reaproveitado entre chamadas). */
const fabricaCatalogo = criarFabricaCatalogo(abrirPoolCatalogo);
/** H-025: fabrica do rascunho sem conta sobre o papel app_api (um cliente SQL por URL, reaproveitado). */
const fabricaRascunho = criarFabricaRascunho(abrirClienteSql);

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // H-073: o pool do papel app_system so e aberto quando DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL existem.
    const integracoes = montarIntegracoes(process.env, { abrirClienteSql, fabricaCatalogo, fabricaRascunho });
    await handleRequest(req, res, {
      tickSecret: process.env.JOBS_TICK_SECRET,
      catalog: integracoes.catalog,
      ...(integracoes.drafts !== undefined ? { drafts: integracoes.drafts } : {}),
      ...(integracoes.accessCase !== undefined ? { accessCase: integracoes.accessCase } : {}),
      ...(integracoes.adminStepUp !== undefined ? { adminStepUp: integracoes.adminStepUp } : {}),
      ...(integracoes.adminOps !== undefined ? { adminOps: integracoes.adminOps } : {}),
      ...(integracoes.professionalProfile !== undefined ? { professionalProfile: integracoes.professionalProfile } : {}),
    });
  } catch {
    // Sem detalhe de erro na resposta nem no log (ADR-013: sem dado sensivel).
    if (!res.headersSent) {
      res.writeHead(500, { 'Cache-Control': 'no-store' });
    }
    res.end();
  }
}
