// H-020 | Rota POST /v1/geo/address-suggest (docs/factory/56-DESENHO-H020.md, §2.1, §2.2).
// Ordem fixa: Origin e Content-Type conferidos ANTES do corpo; interruptor; corpo (so {q, context}, 1 KB);
// e so entao o servico. Sem CORS. Sem log do corpo ou do texto. Resposta sempre Cache-Control: no-store.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADDRESS_BODY_LIMIT_BYTES,
  checkConsumeHeaders,
  parseAddressSuggestBody,
  siteOriginOf,
} from '@fastpro/domain';
import { suggestAddress, type AddressSuggestDeps } from './address-suggest-service.js';

export interface GeoRouteOptions {
  /** Dependencias do servico (portas). Sem elas a rota nao existe (404, §2.1). */
  readonly deps: AddressSuggestDeps;
  /** Interruptor ADDRESS_SUGGEST_ENABLED. Desligado: texto livre, sem provedor (§2.2 passo 1). */
  readonly enabled: boolean;
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

export async function handleAddressSuggest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GeoRouteOptions,
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
      enviar(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }

    if (!opts.enabled) {
      enviar(res, 200, { mode: 'texto_livre', reason: 'desligado' });
      return;
    }

    const { text, bytes } = await lerCorpo(req, ADDRESS_BODY_LIMIT_BYTES);
    const corpo = parseAddressSuggestBody(text, bytes);
    if (!corpo.ok) {
      enviar(res, 400, { code: 'entrada_invalida' });
      return;
    }

    const r = await suggestAddress(
      {
        q: corpo.q,
        context: corpo.context,
        cookie: cabecalho(req.headers.cookie),
        ip: ipDoPedido(req),
      },
      opts.deps,
    );
    enviar(res, r.status, r.body, r.retryAfterS === undefined ? {} : { 'Retry-After': String(r.retryAfterS) });
  } catch {
    // Sem detalhe: erro nosso vira 503 fixo, sem texto, sem causa.
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
