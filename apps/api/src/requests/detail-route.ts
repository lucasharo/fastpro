// Issue 45 (H-032) | Leitura do pedido por papel (docs/factory/127-DESENHO-H032.md, §6.2, §6.3, §6.4, §10; D-06).
//   GET /v1/requests/:id                 dono (sessao do cliente): corpo de 12 chaves, endereco decifrado
//   GET /v1/professional/requests/:id    profissional elegivel: corpo de 10 chaves, sem endereco
// Ordem fixa: metodo (so GET; outro = 404 uniforme) -> formato do id (mal formado = 404 uniforme) -> cookie de sessao
// (ausente = 401) -> sessao no banco (nula = 401) -> servico. Toda recusa de pedido sai como a MESMA resposta 404
// (corpo constante), nos mesmos cabecalhos. Sem CORS. Nenhum log de corpo, cookie, endereco ou id.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, cookieValue } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import {
  LEITURA_INDISPONIVEL_BODY,
  PEDIDO_NAO_ENCONTRADO_BODY,
  UUID_RE,
  readRequestAsOwner,
  readRequestAsProfessional,
  type DetailServiceDeps,
} from './detail-service.js';

/** Rota do dono (cliente). */
export const REQUEST_OWNER_PATH_PREFIX = '/v1/requests/' as const;
/** Rota do profissional elegivel (prefixo alinhado ao padrao de professional-*-route.ts; Rodada 92, decisao 424). */
export const REQUEST_PROFESSIONAL_PATH_PREFIX = '/v1/professional/requests/' as const;

/** Cabecalhos iguais em toda resposta desta rota (desenho §6.2). */
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const SESSAO_NECESSARIA_BODY = { code: 'sessao_necessaria' } as const;

export interface RequestDetailRouteOptions {
  /** Sessao do cliente e do profissional (mesmo cookie; o papel e' decidido pela rota, nunca pelo corpo). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /** Portas do servico de leitura (loja Pg, cofre de endereco e relogio). */
  readonly service: DetailServiceDeps;
}

/** Interpreta o caminho. Id vazio ou mal formado ainda casa a rota (vira 404 uniforme, nunca a resposta padrao). */
export function requestDetailRoute(path: string): { readonly papel: 'dono' | 'profissional'; readonly id: string } | null {
  if (path.startsWith(REQUEST_PROFESSIONAL_PATH_PREFIX)) {
    const id = path.slice(REQUEST_PROFESSIONAL_PATH_PREFIX.length);
    return id.includes('/') ? null : { papel: 'profissional', id };
  }
  if (path.startsWith(REQUEST_OWNER_PATH_PREFIX)) {
    const id = path.slice(REQUEST_OWNER_PATH_PREFIX.length);
    return id.includes('/') ? null : { papel: 'dono', id };
  }
  return null;
}

export function isRequestDetailRoute(path: string): boolean {
  return requestDetailRoute(path) !== null;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

export async function handleRequestDetailRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: RequestDetailRouteOptions,
): Promise<void> {
  try {
    const rota = requestDetailRoute(path);
    if (rota === null || req.method !== 'GET' || !UUID_RE.test(rota.id)) {
      return enviar(res, 404, PEDIDO_NAO_ENCONTRADO_BODY);
    }
    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, SESSAO_NECESSARIA_BODY);
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), opts.service.clock.nowMs());
    if (sessao === null) return enviar(res, 401, SESSAO_NECESSARIA_BODY);

    const resultado =
      rota.papel === 'dono'
        ? await readRequestAsOwner(sessao.userId, rota.id, opts.service, req.socket.remoteAddress ?? 'desconhecido')
        : await readRequestAsProfessional(sessao.userId, rota.id, opts.service);
    return enviar(res, resultado.status, resultado.body);
  } catch {
    // Falha nossa vira 503 fixo: sem detalhe de banco, de cifra ou de sessao na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, LEITURA_INDISPONIVEL_BODY);
  }
}
