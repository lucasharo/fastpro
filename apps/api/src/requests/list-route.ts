// Issue 47 (H-034) | Rota GET /v1/requests (lista do dono) (docs/factory/133-DESENHO-H034.md, §6.1; decisao 523).
// Ordem fixa: metodo (so GET) -> parametros (so "cursor"; extra ou repetido = 400 parametro_invalido; cursor
// malformado = 400 cursor_invalido) -> cookie de sessao (ausente = 401) -> sessao no banco (nula = 401) -> servico.
// Cabecalhos: no-store, no-referrer, JSON. Sem CORS. Nenhum log de corpo, cookie, cursor ou id.
// NAO exige ADDRESS_ENC_KEY: a lista nao decifra nada.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PANEL_ITEM_KEYS, SESSION_COOKIE_NAME, cookieValue, parseListCursor } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import {
  CURSOR_INVALIDO_BODY,
  LISTA_INDISPONIVEL_BODY,
  listRequestsAsOwner,
  type RequestListServiceDeps,
} from './list-service.js';

/** Rota da lista do dono. Dividida com POST /v1/requests (publicacao) pelo metodo, decidido em app.ts. */
export const REQUEST_LIST_PATH = '/v1/requests' as const;

/** Chaves do corpo 200 da lista, em ordem fixa (desenho §6.1). */
export const REQUEST_LIST_BODY_KEYS = ['items', 'nextCursor'] as const;
export const REQUEST_LIST_ITEM_KEYS = PANEL_ITEM_KEYS;

const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const PARAMETRO_INVALIDO_BODY = { code: 'parametro_invalido' } as const;
const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;
const METODO_NAO_PERMITIDO_BODY = { code: 'metodo_nao_permitido' } as const;

export interface RequestListRouteOptions {
  /** Sessao do cliente (mesmo cookie das demais rotas do dono). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /** Portas do servico de lista (loja Pg e relogio). */
  readonly service: RequestListServiceDeps;
}

export function isRequestListRoute(path: string): boolean {
  return path === REQUEST_LIST_PATH;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

export async function handleRequestListRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RequestListRouteOptions,
): Promise<void> {
  try {
    if (req.method !== 'GET') return enviar(res, 405, METODO_NAO_PERMITIDO_BODY, { Allow: 'GET' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const nomes = [...url.searchParams.keys()];
    if (nomes.some((nome) => nome !== 'cursor') || url.searchParams.getAll('cursor').length > 1) {
      return enviar(res, 400, PARAMETRO_INVALIDO_BODY);
    }
    const cursorRaw = url.searchParams.get('cursor');
    if (cursorRaw !== null && parseListCursor(cursorRaw) === null) return enviar(res, 400, CURSOR_INVALIDO_BODY);

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), opts.service.clock.nowMs());
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);

    const r = await listRequestsAsOwner(sessao.userId, cursorRaw, opts.service);
    return enviar(res, r.status, r.body);
  } catch {
    // Falha nossa vira 503 fixo: sem detalhe de banco nem de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, LISTA_INDISPONIVEL_BODY, { 'Retry-After': '10' });
  }
}
