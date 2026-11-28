// H-019 | Rota POST /v1/catalog/service-search (docs/factory/64-DESENHO-H019.md, §3.1, §3.2).
// Ordem fixa: Origin e Content-Type antes do corpo; corpo so {q}, 1 KB; termo validado (2..80) antes de
// qualquer custo; so entao taxa, banco e resposta. Sem CORS. Sem log do corpo ou do termo.
// Resposta sempre Cache-Control: no-store. Visitante sem conta pode usar (RF-002, FA-001).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  catalogSearchError,
  checkConsumeHeaders,
  CATALOG_SEARCH_BODY_LIMIT_BYTES,
  parseCatalogSearchBody,
  siteOriginOf,
} from '@fastpro/domain';
import { searchCatalogService, type CatalogSearchDeps } from './service-search.js';

export interface CatalogRouteOptions extends CatalogSearchDeps {
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** IP do cliente para o limite de taxa. So o endereco do socket e usado (sem cabecalho repassado). */
function ipDoPedido(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'desconhecido';
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado. */
function lerCorpo(
  req: IncomingMessage,
  limite: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let guardados = 0;
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (guardados <= limite) {
        partes.push(chunk);
        guardados += chunk.length;
      }
    });
    req.on('end', () => resolve({ text: Buffer.concat(partes).toString('utf8'), bytes: total }));
    req.on('error', reject);
  });
}

function enviar(
  res: ServerResponse,
  status: number,
  corpo: unknown,
  extra: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, { ...HEADERS, ...extra });
  res.end(JSON.stringify(corpo));
}

export async function handleCatalogSearch(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CatalogRouteOptions,
): Promise<void> {
  try {
    const cabecalhos = checkConsumeHeaders(
      {
        origin: cabecalho(req.headers.origin),
        secFetchSite: cabecalho(req.headers['sec-fetch-site']),
        contentType: cabecalho(req.headers['content-type']),
      },
      siteOriginOf(opts.siteUrl),
    );
    if (!cabecalhos.ok) {
      enviar(res, cabecalhos.status, { status: 'erro', code: cabecalhos.code });
      return;
    }

    const { text, bytes } = await lerCorpo(req, CATALOG_SEARCH_BODY_LIMIT_BYTES);
    const corpo = parseCatalogSearchBody(text, bytes);
    if (!corpo.ok) {
      enviar(res, 400, catalogSearchError('entrada_invalida'));
      return;
    }

    const r = await searchCatalogService({ q: corpo.q, ip: ipDoPedido(req) }, opts);
    enviar(res, r.status, r.body, r.retryAfterS === undefined ? {} : { 'Retry-After': String(r.retryAfterS) });
  } catch {
    // Sem detalhe: erro nosso vira 503 fixo, sem texto, sem causa.
    if (!res.headersSent) enviar(res, 503, catalogSearchError('falha'));
  }
}
