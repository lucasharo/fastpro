// H-107 (Issue 116) | Rotas /v1/admin/catalog via HTTP (docs/factory/81-DESENHO-H107.md §1 e §4; 77 CA-01, CA-02).
// Ordem fixa: rota do registro (senao 404) -> cookie (sem cookie = 404 sem banco) -> guarda no banco (uma consulta)
// -> sessao, aal2 e permissao catalog.manage: QUALQUER recusa sai como 404 identico a rota inexistente (decisao
// aceita: padrao do console) -> Origin e Content-Type das mutacoes (403) -> corpo JSON ate 8 KB (413) -> dominio.
// Falha fora do dominio (guarda ou banco sem SQLSTATE do catalogo) = 503 sem detalhe.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_NOT_FOUND,
  ADMIN_ROUTES_H107,
  ADMIN_SESSION_COOKIE,
  adminReply,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  entidadeDaRotaCatalogo,
  handleCatalogAdmin,
  resolveAdminRoute,
  type AdminGuardRecord,
  type AdminMethod,
  type AdminResponse,
  type CatalogAdminPort,
  type CatalogEntity,
  type CatalogOperation,
} from '@fastpro/domain';

/** Corpo das alteracoes do catalogo e pequeno: acima de 8 KB a resposta e 413 (81 §1). */
export const CATALOG_BODY_LIMIT_BYTES = 8 * 1024;
const ALVO_CATALOGO = '/v1/admin/catalog';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminCatalogRouteOptions {
  /** Guarda do banco para o segredo do cookie (AdminRepository.guard). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  /** Porta do banco do catalogo (adaptador PgCatalogAdminPort). */
  readonly port: CatalogAdminPort;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes (54 §3). */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado. */
function lerCorpo(req: IncomingMessage, limite: number): Promise<{ readonly text: string; readonly bytes: number }> {
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

/** Segmento i do caminho (0 = vazio antes da primeira barra). */
function segmento(path: string, i: number): string {
  return path.split('/')[i] ?? '';
}

/** Casa a rota do registro com a operacao do dominio. Entidade de caminho desconhecida fica para o dominio (404). */
function operacaoDa(metodo: AdminMethod, padrao: string, path: string, corpo: unknown): CatalogOperation | null {
  if (padrao === ALVO_CATALOGO && metodo === 'GET') return { kind: 'listar' };
  if (padrao === `${ALVO_CATALOGO}/:entity/:id/revisions`) {
    return { kind: 'revisoes', entidadeRota: segmento(path, 4), id: segmento(path, 5) };
  }
  const partes = padrao.slice(ALVO_CATALOGO.length + 1).split('/');
  const nome = partes[0];
  const entidade: CatalogEntity | null = nome === undefined ? null : entidadeDaRotaCatalogo(nome);
  if (entidade === null || metodo !== 'POST') return null;
  const id = partes.length === 2 ? segmento(path, 5) : null;
  return { kind: 'salvar', entidade, id, corpo };
}

/** Rotas /v1/admin/catalog (H-107). Sem cookie, sem aal2 ou sem catalog.manage: 404 identico, sem banco de catalogo. */
export async function handleAdminCatalogRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminCatalogRouteOptions,
  path: string,
): Promise<void> {
  try {
    const nowMs = opts.clock.nowMs();
    const rota = resolveAdminRoute(ADMIN_ROUTES_H107, req.method ?? '', path);
    if (rota === null) return enviar(res, ADMIN_NOT_FOUND);

    const secret = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE) ?? null;
    if (secret === null) return enviar(res, ADMIN_NOT_FOUND);

    const row = await opts.guard(secret, nowMs);
    const autorizacao = decideAdminGuard(row, rota.permission, nowMs);
    // Qualquer recusa (sessao, aal2 ou permissao) vira o mesmo 404 (decisao aceita para o catalogo).
    if (autorizacao.kind !== 'autorizada' || row === null) return enviar(res, ADMIN_NOT_FOUND);

    const metodo = rota.method as AdminMethod;
    if (metodo !== 'GET') {
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

    let corpo: unknown;
    if (metodo !== 'GET') {
      const { text, bytes } = await lerCorpo(req, CATALOG_BODY_LIMIT_BYTES);
      if (bytes > CATALOG_BODY_LIMIT_BYTES) return enviar(res, adminReply(413, { code: 'corpo_grande' }));
      if (text.length > 0) {
        try {
          corpo = JSON.parse(text);
        } catch {
          corpo = undefined; // corpo nao-JSON segue como ausente; o dominio recusa com 422
        }
      }
    }

    const operacao = operacaoDa(metodo, rota.pattern, path, corpo);
    if (operacao === null) return enviar(res, ADMIN_NOT_FOUND);

    const principal = { userId: row.userId, permissions: row.permissions, aal2: row.aal2 };
    return enviar(res, await handleCatalogAdmin(operacao, principal, opts.port));
  } catch {
    // Falha fora do dominio (guarda, banco ou leitura malformada): sem dado e sem detalhe.
    return enviar(res, adminReply(503, { code: 'catalogo_indisponivel' }));
  }
}
