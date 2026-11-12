// H-103 (Issue 112) | Console admin por papel (docs/factory/70-DESENHO-H103.md §1 e §2; 69-REFINO-H103.md).
// Catalogo puro das telas e regra de exibicao: a tela so aparece quando a conta tem a permissao exigida
// E a rota que a alimenta esta no registro (CA-H103-11, D-H103-3). Logica pura, sem I/O. A autoridade
// continua na guarda: o menu so esconde; cada rota de tela nega por permissao (FA-031).

import { decideAdminGuard } from './guard.js';
import type { AdminGuardRecord } from './ports.js';
import { ADMIN_NOT_FOUND, adminReply, type AdminResponse } from './responses.js';
import type { AdminPermission } from './roles.js';
import {
  ADMIN_ACCESS_CASES_PATH,
  ADMIN_AUDIT_QUERY_PATH,
  type AdminMethod,
  type AdminRouteSpec,
} from './routes.js';

/** Rota do registro que alimenta uma tela (metodo e padrao, como em AdminRouteSpec). */
export interface AdminConsoleRoute {
  readonly method: AdminMethod;
  readonly pattern: string;
}

export interface AdminConsoleScreen {
  /** Identificador estavel e slug do caminho da tela (sem acento). */
  readonly id: string;
  readonly rotulo: string;
  /**
   * Permissao que a tela exige; deve ser a mesma da rota que a alimenta (R-2, 70 §4).
   * Null = ainda sem permissao propria (ex.: Financeiro, D-H103-3; Suspensao, a definir por H-105).
   */
  readonly permissao: AdminPermission | null;
  /** Rota do registro que alimenta a tela. Null = a historia dona ainda nao a registrou: a tela nao aparece. */
  readonly rota: AdminConsoleRoute | null;
  /** Historia que entrega a funcao da tela (70 §1). */
  readonly historiaDona: string;
}

/**
 * Catalogo das telas do console (70 §1). Ordem fixa: e a ordem do menu.
 * Hoje so quatro telas tem rota registrada (acesso-excepcional, acesso-aprovacao, auditoria, equipe).
 * A tela de equipe usa a acao de convite como rota; a listagem (GET /v1/admin/staff) ainda nao existe.
 */
export const ADMIN_CONSOLE_SCREENS: readonly AdminConsoleScreen[] = [
  {
    id: 'verificacao',
    rotulo: 'Fila de verificação',
    permissao: 'verification.review',
    rota: null,
    historiaDona: 'H-039',
  },
  {
    id: 'moderacao',
    rotulo: 'Denúncias e contestações',
    permissao: 'moderation.decide',
    rota: null,
    historiaDona: 'H-090',
  },
  {
    id: 'financeiro',
    rotulo: 'Cobranças e estornos',
    permissao: null,
    rota: null,
    historiaDona: 'H-053, H-105',
  },
  {
    id: 'suporte',
    rotulo: 'Casos e correção de conclusão',
    permissao: 'support.completion.correct',
    rota: null,
    historiaDona: 'H-079',
  },
  {
    id: 'acesso-excepcional',
    rotulo: 'Pedido de acesso',
    permissao: 'case.open_sensitive',
    rota: { method: 'POST', pattern: ADMIN_ACCESS_CASES_PATH },
    historiaDona: 'H-073',
  },
  {
    id: 'acesso-aprovacao',
    rotulo: 'Aprovações pendentes',
    permissao: 'case.authorize_sensitive',
    rota: { method: 'POST', pattern: `${ADMIN_ACCESS_CASES_PATH}/:caseId/approve` },
    historiaDona: 'H-073',
  },
  {
    id: 'auditoria',
    rotulo: 'Trilha de auditoria',
    permissao: 'audit.read',
    rota: { method: 'POST', pattern: ADMIN_AUDIT_QUERY_PATH },
    historiaDona: 'H-104',
  },
  {
    id: 'equipe',
    rotulo: 'Papéis e convites',
    permissao: 'admin.role.manage',
    rota: { method: 'POST', pattern: '/v1/admin/invites' },
    historiaDona: 'H-102',
  },
  {
    id: 'catalogo',
    rotulo: 'Catálogo',
    permissao: 'catalog.manage',
    rota: null,
    historiaDona: 'H-107',
  },
  {
    id: 'suspensao',
    rotulo: 'Suspensão permanente',
    permissao: null,
    rota: null,
    historiaDona: 'H-105',
  },
];

export interface AdminConsoleMenuItem {
  readonly id: string;
  readonly rotulo: string;
  /** Caminho da tela na interface (nao e rota de API). */
  readonly caminho: string;
}

/** Tela visivel = conta tem a permissao exigida E a rota que a alimenta esta no registro (CA-H103-11). */
export function consoleScreenVisible(
  tela: AdminConsoleScreen,
  permissoes: ReadonlySet<string>,
  registro: readonly AdminRouteSpec[],
): boolean {
  if (tela.permissao === null || tela.rota === null) return false;
  if (!permissoes.has(tela.permissao)) return false;
  const rota = tela.rota;
  return registro.some((r) => r.method === rota.method && r.pattern === rota.pattern);
}

/**
 * Menu de uma conta: telas visiveis, na ordem do catalogo. Recebe as permissoes efetivas (uniao dos
 * papeis ativos; papel desconhecido nao concede nada, CA-H103-07 e T-H103-02).
 */
export function consoleMenuFor(
  permissoes: Iterable<string>,
  registro: readonly AdminRouteSpec[],
): AdminConsoleMenuItem[] {
  const conjunto = new Set(permissoes);
  return ADMIN_CONSOLE_SCREENS.filter((t) => consoleScreenVisible(t, conjunto, registro)).map((t) => ({
    id: t.id,
    rotulo: t.rotulo,
    caminho: `/console/${t.id}`,
  }));
}

export interface AdminConsoleMenuInput {
  /** Linha que o banco devolveu na guarda (nulo = sem sessao valida). */
  readonly row: AdminGuardRecord | null;
  /** Registro de rotas em uso (ADMIN_ROUTES na producao; fixture nos testes). */
  readonly registro: readonly AdminRouteSpec[];
}

/**
 * GET /v1/admin/console/menu (70 §1). Guarda 'sessao' (sem sessao, sem aal2 ou sem papel = 404 identico).
 * Resposta 200 = { telas: [{ id, rotulo, caminho }] }, sem dado de tela e sem permissoes brutas.
 * As permissoes vem da linha do banco nesta requisicao; nao ha cache, entao revogacao vale na seguinte.
 */
export function handleConsoleMenu(input: AdminConsoleMenuInput, nowMs: number): AdminResponse {
  const decisao = decideAdminGuard(input.row, 'sessao', nowMs);
  if (decisao.kind !== 'autorizada' || input.row === null) return ADMIN_NOT_FOUND;
  return adminReply(200, { telas: consoleMenuFor(input.row.permissions, input.registro) });
}
