// H-019 | Servico da busca de servico (docs/factory/64-DESENHO-H019.md, §3.1 passos 4 a 6, §3.2).
// Ordem fixa: limite de taxa -> conta a busca aceita -> porta de busca -> projecao -> resposta.
// Nenhuma falha do banco sai com mensagem; o termo nunca entra em resultado nem em log.
import {
  buildCatalogSearchResponse,
  catalogSearchError,
  projectCatalogSearchRows,
  type CatalogSearchErrorBody,
  type CatalogSearchResponse,
} from '@fastpro/domain';
import type { CatalogRateLimitPort, CatalogSearchPort } from './ports.js';

export interface CatalogSearchDeps {
  readonly search: CatalogSearchPort;
  readonly rate: CatalogRateLimitPort;
}

export interface CatalogSearchInput {
  /** Termo ja validado e normalizado pelo dominio (normalizeCatalogQuery). */
  readonly q: string;
  readonly ip: string;
}

export interface CatalogSearchOutcome {
  readonly status: number;
  readonly body: CatalogSearchResponse | CatalogSearchErrorBody;
  readonly retryAfterS?: number;
  /** Codigo fixo interno (para log futuro). Nunca vai ao navegador. */
  readonly errorCode?: string;
}

export async function searchCatalogService(
  input: CatalogSearchInput,
  deps: CatalogSearchDeps,
): Promise<CatalogSearchOutcome> {
  // 4. Limite de taxa: excedente nao chega ao banco (CA-07 e R-2).
  const taxa = await deps.rate.check(input.ip);
  if (!taxa.ok) {
    return {
      status: 429,
      body: catalogSearchError('limite'),
      retryAfterS: taxa.retryAfterS,
      errorCode: 'rate_limited',
    };
  }
  await deps.rate.hit(input.ip);

  // 5. Porta de busca: uma consulta, sem retentativa. Falha vira 503 fixo, nunca "nenhum resultado".
  const r = await deps.search.search(input.q);
  if (!r.ok) {
    return { status: 503, body: catalogSearchError('falha'), errorCode: r.code };
  }

  // 6. Projecao pela lista de permissao; forma inesperada do banco e falha, nao repasse.
  const p = projectCatalogSearchRows(r.rows);
  if (!p.ok) {
    return { status: 503, body: catalogSearchError('falha'), errorCode: 'db_shape' };
  }
  return { status: 200, body: buildCatalogSearchResponse(p.items) };
}
