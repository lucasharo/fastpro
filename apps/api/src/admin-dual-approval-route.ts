// H-105 (Issue 114, docs/factory/80-DESENHO-H105.md §3) | Rotas /v1/admin/refund-approvals e /v1/admin/suspension-approvals via HTTP.
// Ordem fixa: rota no registro (404) -> cookie (sem cookie = 404 sem banco) -> guarda no banco (sessao e papel ativos,
// 404) -> Origin e Content-Type das mutacoes (403) -> corpo JSON limitado -> manipulador do dominio (permissao da
// familia, prova recente, decisoes puras e banco). Toda negacao 404 sai identica a rota inexistente (corpo vazio).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_REFUND_APPROVALS_PATH,
  ADMIN_ROUTES_H105,
  ADMIN_SESSION_COOKIE,
  ADMIN_SUSPENSION_APPROVALS_PATH,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  handleDualCancel,
  handleDualList,
  handleDualOpen,
  handleDualVote,
  resolveAdminRoute,
  type AdminGuardRecord,
  type AdminMethod,
  type AdminResponse,
  type DualAction,
  type DualApprovalDeps,
  type DualApprovalRequest,
} from '@fastpro/domain';

/** Corpo dos pedidos de aprovacao e pequeno (motivo de ate 500 caracteres): acima disso vira corpo vazio. */
export const DUAL_APPROVAL_BODY_LIMIT_BYTES = 4096;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminDualApprovalRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Porta da dupla aprovacao (private.approval_dual_*) e gerador de id. */
  readonly deps: DualApprovalDeps;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes (54 §3). */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

type Manipulador = 'open' | 'list' | 'vote' | 'cancel';

/** Ligacao rota -> manipulador e familia. Chave = metodo + padrao da rota (ver ADMIN_ROUTES_H105). */
function chaves(caminho: string, familia: DualAction): Readonly<Record<string, { manipulador: Manipulador; familia: DualAction }>> {
  return {
    [`POST ${caminho}`]: { manipulador: 'open', familia },
    [`GET ${caminho}`]: { manipulador: 'list', familia },
    [`POST ${caminho}/:approvalId/vote`]: { manipulador: 'vote', familia },
    [`POST ${caminho}/:approvalId/cancel`]: { manipulador: 'cancel', familia },
  };
}

const DESPACHO: Readonly<Record<string, { manipulador: Manipulador; familia: DualAction }>> = {
  ...chaves(ADMIN_REFUND_APPROVALS_PATH, 'estorno'),
  ...chaves(ADMIN_SUSPENSION_APPROVALS_PATH, 'suspensao_permanente'),
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

/** Id do pedido: quinto segmento de /v1/admin/{familia}/{id}/... (o caminho chega sem query string). */
function idDoPedido(path: string): string | undefined {
  return path.split('/')[4];
}

/** Rotas de dupla aprovacao (H-105). Falha fora do dominio vira 503 generico, sem dado e sem detalhe. */
export async function handleAdminDualApprovalRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminDualApprovalRouteOptions,
  path: string,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const rota = resolveAdminRoute(ADMIN_ROUTES_H105, req.method ?? '', path);
    if (rota === null) return enviar(res, ADMIN_NOT_FOUND);

    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const sessao = decideAdminGuard(row, 'sessao', nowMs);
    if (sessao.kind === 'recusada') return enviar(res, sessao.response);

    const metodo = rota.method as AdminMethod;
    if (metodo !== 'GET') {
      // Origin so e checada com sessao valida (54 §3), antes de ler o corpo e de qualquer banco de aprovacao.
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
      const { text, bytes } = await lerCorpo(req, DUAL_APPROVAL_BODY_LIMIT_BYTES);
      if (bytes <= DUAL_APPROVAL_BODY_LIMIT_BYTES && text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined; // corpo nao-JSON segue como ausente; o dominio recusa o que precisa
        }
      }
    }

    const ligacao = DESPACHO[`${rota.method} ${rota.pattern}`];
    const pedido: DualApprovalRequest = { row, secret, body, approvalId: idDoPedido(path) };
    const resposta = await despachar(ligacao, pedido, opts.deps, nowMs);
    return enviar(res, resposta);
  } catch {
    // Falha fora do dominio (guarda no banco ou leitura do corpo): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'aprovacao_indisponivel' }));
  }
}

function despachar(
  ligacao: { readonly manipulador: Manipulador; readonly familia: DualAction } | undefined,
  pedido: DualApprovalRequest,
  deps: DualApprovalDeps,
  nowMs: number,
): Promise<AdminResponse> {
  if (ligacao === undefined) return Promise.resolve(ADMIN_NOT_FOUND);
  const { manipulador, familia } = ligacao;
  switch (manipulador) {
    case 'open':
      return handleDualOpen(pedido, deps, nowMs, familia);
    case 'list':
      return handleDualList(pedido, deps, nowMs, familia);
    case 'vote':
      return handleDualVote(pedido, deps, nowMs, familia);
    case 'cancel':
      return handleDualCancel(pedido, deps, nowMs, familia);
  }
}
