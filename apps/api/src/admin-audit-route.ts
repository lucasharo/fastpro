// H-104 (Issue 113) | Rota POST /v1/admin/audit/queries (docs/factory/63-DESENHO-H104.md §3).
// Ordem fixa: cookie (sem cookie = 404 sem banco) -> guarda no banco (sessao e papel ativos, 404) ->
// Origin e Content-Type (403) -> corpo JSON -> handleAuditQuery (403 sem audit.read, 422 de validacao,
// 429 sem vaga, leitura com 200/404/503). Toda negacao 404 sai identica a rota inexistente (corpo vazio).
// Dependencias injetadas: nesta etapa a rota nao e ligada a producao (54 §7, item 5).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_SESSION_COOKIE,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  handleAuditQuery,
  type AdminGuardRecord,
  type AdminResponse,
  type AuditQueryDeps,
} from '@fastpro/domain';

/** Corpo da consulta e pequeno (filtros e periodo): acima disso o corpo fica invalido (422). */
export const AUDIT_QUERY_BODY_LIMIT_BYTES = 4096;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminAuditRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Porta de consulta (private.audit_query) e limite por admin (private.audit_query_rate_take). */
  readonly deps: AuditQueryDeps;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes (54 §3). */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

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

/** POST /v1/admin/audit/queries. Nada do corpo e registrado; erros nao ecoam valores. */
export async function handleAdminAuditQuery(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminAuditRouteOptions,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const sessao = decideAdminGuard(row, 'sessao', nowMs);
    if (sessao.kind === 'recusada') return enviar(res, sessao.response);

    // Origin so e checada com sessao valida (54 §3, revisao da Issue 111).
    const origem = checkAdminMutation(
      'POST',
      {
        contentType: cabecalho(req.headers['content-type']) ?? null,
        origin: cabecalho(req.headers.origin) ?? null,
        secFetchSite: cabecalho(req.headers['sec-fetch-site']) ?? null,
      },
      opts.baseUrl,
    );
    if (origem !== null) return enviar(res, origem);

    const { text, bytes } = await lerCorpo(req, AUDIT_QUERY_BODY_LIMIT_BYTES);
    let body: unknown;
    if (bytes <= AUDIT_QUERY_BODY_LIMIT_BYTES) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined; // corpo nao-JSON vira corpo_invalido (422) no dominio
      }
    }

    const resposta = await handleAuditQuery({ row, secret, body }, opts.deps, nowMs);
    return enviar(res, resposta);
  } catch {
    // Falha fora da consulta (guarda ou limite no banco): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'auditoria_indisponivel' }));
  }
}
