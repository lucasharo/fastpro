// Issue 47 (H-034) | Lista do painel do cliente: servico sem HTTP (docs/factory/133-DESENHO-H034.md, §6.1, §9).
// Pede REQUEST_LIST_PAGE_SIZE + 1 linhas para saber se ha proxima pagina; corta na pagina e monta o cursor opaco a partir
// da ultima linha exibida. Nao decifra nada e nao le endereco. Erro de banco vira o codigo fixo "indisponivel".
import {
  PANEL_ITEM_KEYS,
  REQUEST_LIST_PAGE_SIZE,
  encodeListCursor,
  parseListCursor,
} from '@fastpro/domain';
import type { RequestListRow, RequestListStorePort } from '@fastpro/db';

/** Corpo fixo de falha do banco de leitura (desenho §6.1). */
export const LISTA_INDISPONIVEL_BODY = { code: 'indisponivel' } as const;
/** Corpo fixo de cursor recusado (desenho §6.1, decisao 523). */
export const CURSOR_INVALIDO_BODY = { code: 'cursor_invalido' } as const;

export interface RequestListServiceDeps {
  readonly store: RequestListStorePort;
  readonly clock: { nowMs(): number };
}

/** Item da lista: so as chaves fechadas, na ordem de PANEL_ITEM_KEYS. */
export interface RequestListItem {
  readonly id: string;
  readonly serviceName: string;
  readonly status: string;
  readonly prazo: 'aberto' | 'encerrado' | null;
  readonly publishedAt: string;
  readonly acceptanceDeadlineAt: string;
}

export type RequestListOutcome =
  | { readonly status: 200; readonly body: { readonly items: readonly RequestListItem[]; readonly nextCursor: string | null } }
  | { readonly status: 400; readonly body: typeof CURSOR_INVALIDO_BODY }
  | { readonly status: 503; readonly body: typeof LISTA_INDISPONIVEL_BODY };

function itemDe(linha: RequestListRow): RequestListItem {
  const item: Record<(typeof PANEL_ITEM_KEYS)[number], unknown> = {
    id: linha.id,
    serviceName: linha.serviceName,
    status: linha.status,
    prazo: linha.prazo,
    publishedAt: linha.publishedAt,
    acceptanceDeadlineAt: linha.acceptanceDeadlineAt,
  };
  return item as unknown as RequestListItem;
}

/**
 * Lista uma pagina dos pedidos do dono. O cursor ja chega validado pela rota; aqui ele e so reinterpretado.
 * Sem cursor = primeira pagina. nextCursor so existe quando vieram mais linhas que a pagina.
 */
export async function listRequestsAsOwner(
  userId: string,
  cursorRaw: string | null,
  deps: RequestListServiceDeps,
): Promise<RequestListOutcome> {
  let cursor: { publishedAt: string; id: string } | null = null;
  if (cursorRaw !== null) {
    cursor = parseListCursor(cursorRaw);
    if (cursor === null) return { status: 400, body: CURSOR_INVALIDO_BODY };
  }
  let linhas: readonly RequestListRow[];
  try {
    linhas = await deps.store.listOwner(userId, deps.clock.nowMs(), cursor, REQUEST_LIST_PAGE_SIZE + 1);
  } catch {
    return { status: 503, body: LISTA_INDISPONIVEL_BODY };
  }
  const pagina = linhas.slice(0, REQUEST_LIST_PAGE_SIZE);
  const ultima = pagina[pagina.length - 1];
  const temMais = linhas.length > REQUEST_LIST_PAGE_SIZE && ultima !== undefined;
  const nextCursor = temMais ? encodeListCursor({ publishedAt: ultima.cursorTs, id: ultima.id }) : null;
  return { status: 200, body: { items: pagina.map(itemDe), nextCursor } };
}
