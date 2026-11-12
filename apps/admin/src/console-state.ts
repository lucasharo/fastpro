// H-103 (Issue 112) | Estado da tela do console a partir da resposta de GET /v1/admin/console/menu
// (docs/factory/70-DESENHO-H103.md §2, estados vazio e de erro). Funcao pura, sem React e sem I/O.
// A tela so mostra o que a API devolveu; permissao quem decide e o servidor (FA-031).

export interface ConsoleTela {
  readonly id: string;
  readonly rotulo: string;
  /** Caminho da tela na interface (nao e rota de API). */
  readonly caminho: string;
}

export type ConsoleEstado =
  | { readonly tipo: 'telas'; readonly telas: readonly ConsoleTela[] }
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'sem_sessao' }
  | { readonly tipo: 'erro' };

/** Estado vazio (70 §2): a conta nao tem nenhuma tela disponivel. Texto provisorio, a aprovar pelo PO. */
export const TEXTO_VAZIO = 'Nenhuma tela disponível para a sua conta.';
/** Erro de carregamento (70 §2, texto definido na Arquitetura). */
export const TEXTO_ERRO = 'Não foi possível carregar esta tela. Tente novamente.';
/** Sessao ausente, vencida ou revogada (a API responde 404 identico). Texto provisorio. */
export const TEXTO_SEM_SESSAO = 'Sua sessão não está ativa. Entre novamente para continuar.';

function telaValida(item: unknown): item is ConsoleTela {
  if (typeof item !== 'object' || item === null) return false;
  const r = item as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.rotulo === 'string' && typeof r.caminho === 'string';
}

/** Mapeia a resposta HTTP do menu para um dos quatro estados. Corpo fora do contrato = erro. */
export function estadoDoMenu(status: number, corpo: unknown): ConsoleEstado {
  if (status === 404) return { tipo: 'sem_sessao' };
  if (status !== 200) return { tipo: 'erro' };
  const telas = (corpo as { telas?: unknown } | null)?.telas;
  if (!Array.isArray(telas) || !telas.every(telaValida)) return { tipo: 'erro' };
  return telas.length === 0 ? { tipo: 'vazio' } : { tipo: 'telas', telas };
}
