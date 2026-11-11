// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §1) | Rotas /v1/admin/access-cases via HTTP.
// Ordem fixa: cookie (sem cookie = 404 sem banco) -> guarda no banco (sessao e papel ativos, 404) ->
// Origin e Content-Type das mutacoes (403) -> corpo JSON limitado -> manipulador do dominio (permissao
// da rota, decisoes puras e banco). Toda negacao 404 sai identica a rota inexistente (corpo vazio).
// Dependencias injetadas: sem a porta do caso e o leitor da conversa a rota nao e ligada a producao.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_ACCESS_CASES_PATH,
  ADMIN_NOT_FOUND,
  ADMIN_ROUTES_H073,
  ADMIN_SESSION_COOKIE,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  handleAccessCaseApprove,
  handleAccessCaseClose,
  handleAccessCaseList,
  handleAccessCaseOpen,
  handleAccessCaseRead,
  resolveAdminRoute,
  type AccessCaseDeps,
  type AccessCaseRequest,
  type AdminGuardRecord,
  type AdminMethod,
  type AdminResponse,
} from '@fastpro/domain';

/** Corpo dos pedidos de caso e pequeno (justificativa de ate 500 caracteres): acima disso vira corpo vazio. */
export const ACCESS_CASE_BODY_LIMIT_BYTES = 4096;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminAccessCaseRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Porta do caso (private.access_case_*) e leitor da conversa (H-065). Sem leitor, a leitura e 501. */
  readonly deps: AccessCaseDeps;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes (54 §3). */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

type NomeDoManipulador = 'open' | 'list' | 'approve' | 'close' | 'read';

/** Ligacao rota -> manipulador. Chave = metodo + padrao da rota (ver ADMIN_ROUTES_H073). */
const DESPACHO: Readonly<Record<string, NomeDoManipulador>> = {
  [`POST ${ADMIN_ACCESS_CASES_PATH}`]: 'open',
  [`GET ${ADMIN_ACCESS_CASES_PATH}`]: 'list',
  [`POST ${ADMIN_ACCESS_CASES_PATH}/:caseId/approve`]: 'approve',
  [`POST ${ADMIN_ACCESS_CASES_PATH}/:caseId/close`]: 'close',
  [`POST ${ADMIN_ACCESS_CASES_PATH}/:caseId/conversation/read`]: 'read',
};

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (sem reset de conexao). */
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

function enviar(res: ServerResponse, resposta: AdminResponse): void {
  if (resposta.status === 404) {
    // Mesmo 404 da rota inexistente (app.ts): corpo vazio e so Cache-Control. Nao revela a rota.
    res.writeHead(404, NO_STORE);
    res.end();
    return;
  }
  res.writeHead(resposta.status, {
    ...resposta.headers,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(resposta.body));
}

/** Caminho sem query string. O id do caso e o quinto segmento de /v1/admin/access-cases/{id}/... */
function idDoCaso(path: string): string | undefined {
  return path.split('/')[4];
}

/** Rotas /v1/admin/access-cases (H-073). Erros nao ecoam valores; falha fora do dominio vira 503 generico. */
export async function handleAdminAccessCaseRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminAccessCaseRouteOptions,
  path: string,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const rota = resolveAdminRoute(ADMIN_ROUTES_H073, req.method ?? '', path);
    if (rota === null) return enviar(res, ADMIN_NOT_FOUND);

    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const sessao = decideAdminGuard(row, 'sessao', nowMs);
    if (sessao.kind === 'recusada') return enviar(res, sessao.response);

    const metodo = rota.method as AdminMethod;
    if (metodo !== 'GET') {
      // Origin so e checada com sessao valida (54 §3), antes de ler o corpo e de qualquer banco de caso.
      const origem = checkAdminMutation(
        metodo,
        {
          contentType: cabecalho(req.headers['content-type']) ?? null,
          origin: cabecalho(req.headers.origin) ?? null,
          secFetchSite: cabecalho(req.headers['sec-fetch-site']) ?? null,
        },
        opts.baseUrl,
      );
      if (origem !== null) return enviar(res, origem);
    }

    let body: unknown;
    if (metodo !== 'GET') {
      const { text, bytes } = await lerCorpo(req, ACCESS_CASE_BODY_LIMIT_BYTES);
      if (bytes <= ACCESS_CASE_BODY_LIMIT_BYTES && text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined; // corpo nao-JSON segue como ausente; o dominio recusa o que precisa
        }
      }
    }

    const pedido: AccessCaseRequest = { row, secret, body, caseId: idDoCaso(path) };
    const nome = DESPACHO[`${rota.method} ${rota.pattern}`];
    const resposta = await despachar(nome, pedido, opts.deps, nowMs);
    return enviar(res, resposta);
  } catch {
    // Falha fora do dominio (guarda no banco ou leitura do corpo): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'casos_indisponivel' }));
  }
}

function despachar(
  nome: NomeDoManipulador | undefined,
  pedido: AccessCaseRequest,
  deps: AccessCaseDeps,
  nowMs: number,
): Promise<AdminResponse> {
  switch (nome) {
    case 'open':
      return handleAccessCaseOpen(pedido, deps, nowMs);
    case 'list':
      return handleAccessCaseList(pedido, deps, nowMs);
    case 'approve':
      return handleAccessCaseApprove(pedido, deps, nowMs);
    case 'close':
      return handleAccessCaseClose(pedido, deps, nowMs);
    case 'read':
      return handleAccessCaseRead(pedido, deps, nowMs);
    default:
      return Promise.resolve(ADMIN_NOT_FOUND);
  }
}
