// H-108 (Issue 117) | Rota GET /v1/admin/ops/panel (docs/factory/76-DESENHO-H108.md §2, T-H108-20).
// Ordem: cookie (sem cookie = 404 sem banco) -> guarda no banco (uma consulta por requisicao) ->
// permissao ops.panel.read (404 ou 403 SEM ler o agregado) -> leitura agregada (uma chamada) -> resposta.
// Toda negacao 404 sai identica a rota inexistente (corpo vazio). Falha de banco = 503 sem detalhe.
// Sem cache: revogacao vale na requisicao seguinte.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_SESSION_COOKIE,
  adminReply,
  cookieValue,
  handleOpsPanel,
  opsPanelNegado,
  type AdminGuardRecord,
  type AdminResponse,
  type OpsPanelLeitura,
} from '@fastpro/domain';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminOpsRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Leitura agregada do painel (private.ops_panel_read). So e chamada com a conta autorizada. */
  readonly ler: (nowMs: number) => Promise<OpsPanelLeitura>;
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

/** GET /v1/admin/ops/panel. Nada do cookie e registrado; falhas do banco ou da leitura nao ecoam detalhe. */
export async function handleAdminOpsPanel(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminOpsRouteOptions,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const negado = opsPanelNegado(row, nowMs);
    if (negado !== null) return enviar(res, negado);

    const leitura = await opts.ler(nowMs);
    return enviar(res, handleOpsPanel({ row, leitura }, nowMs));
  } catch {
    // Falha na guarda ou na leitura agregada: sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'ops_indisponivel' }));
  }
}
