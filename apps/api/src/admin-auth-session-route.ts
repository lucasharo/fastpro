// H-103 (Issue 112) | Rota GET /v1/admin/auth/session (docs/factory/70-DESENHO-H103.md §2, R-7).
// Rota publica: sem cookie nao ha consulta ao banco. Sem sessao valida devolve sempre 200 com
// { autenticado: false }, o mesmo corpo para qualquer causa. Falha da guarda vira 503 sem detalhe.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  adminReply,
  cookieValue,
  handleAdminAuthSession,
  type AdminGuardRecord,
  type AdminResponse,
} from '@fastpro/domain';

export interface AdminAuthSessionRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  readonly clock: { nowMs(): number };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, resposta: AdminResponse): void {
  res.writeHead(resposta.status, {
    ...resposta.headers,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(resposta.body));
}

/** GET /v1/admin/auth/session. Nada do cookie e registrado; falhas do banco nao ecoam detalhe. */
export async function handleAdminAuthSessionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminAuthSessionRouteOptions,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, handleAdminAuthSession(null, nowMs));

    const row = await opts.guard(secret, nowMs);
    return enviar(res, handleAdminAuthSession(row, nowMs));
  } catch {
    return enviar(res, adminReply(503, { code: 'sessao_indisponivel' }));
  }
}
