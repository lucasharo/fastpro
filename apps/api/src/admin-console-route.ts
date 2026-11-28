// H-103 (Issue 112) | Rota GET /v1/admin/console/menu (docs/factory/70-DESENHO-H103.md §1 e §4, T-H103-07).
// Ordem: cookie (sem cookie = 404 sem banco) -> guarda no banco (uma consulta por requisicao) ->
// handleConsoleMenu (404 identico se sem sessao, aal2 ou papel; 200 com { telas } se autorizado).
// Toda negacao 404 sai identica a rota inexistente (corpo vazio). Sem cache: revogacao vale na seguinte.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_SESSION_COOKIE,
  adminReply,
  cookieValue,
  handleConsoleMenu,
  type AdminGuardRecord,
  type AdminResponse,
  type AdminRouteSpec,
} from '@fastpro/domain';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminConsoleRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Registro de rotas em uso (ADMIN_ROUTES na producao): so telas com rota registrada aparecem. */
  readonly registro: readonly AdminRouteSpec[];
  readonly clock: { nowMs(): number };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
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

/** GET /v1/admin/console/menu. Nada do cookie e registrado; falhas do banco nao ecoam detalhe. */
export async function handleAdminConsoleMenu(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminConsoleRouteOptions,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    return enviar(res, handleConsoleMenu({ row, registro: opts.registro }, nowMs));
  } catch {
    // Falha fora da decisao (guarda no banco indisponivel): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'console_indisponivel' }));
  }
}
