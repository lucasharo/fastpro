// Issue 52 (H-039) | Estado da tela da fila de verificacao a partir da resposta de /v1/admin/verificacao/casos
// (docs/factory/124-DESENHO-H039.md §5.4; decs. 384 a 387). Funcoes puras, sem React e sem I/O. A tela so mostra o
// que a API devolveu: a API decide o acesso (404 = sem acesso, igual ao console) e a lista nao traz CPF/CNPJ,
// nome, nome de arquivo nem hash. Erro de carregamento nunca mostra detalhe tecnico.

// Desde 2026-11-27 a fila traz o e-mail do profissional (pedido do dono).
export const ESCOPOS_FILA = [
  { valor: 'pendentes', rotulo: 'Pendentes' },
  { valor: 'minhas', rotulo: 'Minhas' },
  { valor: 'recursos', rotulo: 'Recursos' },
  { valor: 'retidas', rotulo: 'Retidas' },
] as const;

export type EscopoFila = (typeof ESCOPOS_FILA)[number]['valor'];

export const TEXTO_LISTA_VAZIA = 'Nenhum caso nesta lista.';
export const TEXTO_ERRO_CARREGAR = 'Não foi possível carregar a fila. Tente de novo.';

const ROTULOS_ESTADO: Readonly<Record<string, string>> = {
  pendente: 'Pendente',
  em_revisao: 'Em revisão',
  retida_duplicidade: 'Retida por duplicidade',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  suspensa: 'Suspensa',
};

export interface LinhaFilaTela {
  readonly id: string;
  readonly short_id: string;
  readonly status: string;
  readonly appeal_status: string;
  readonly sla_target_at: string;
  readonly received_at: string | null;
  readonly services: readonly string[];
  /** E-mail do profissional (so na fila). */
  readonly email?: string | null;
  readonly overdue: boolean;
  readonly assigned_to_me: boolean;
  readonly version: number;
}

export type EstadoFila =
  | { readonly tipo: 'sem_acesso' }
  | { readonly tipo: 'erro' }
  | { readonly tipo: 'vazia' }
  | { readonly tipo: 'lista'; readonly itens: readonly LinhaFilaTela[] };

/** Escopo vindo da URL; desconhecido cai em "pendentes" (a API tambem recusa escopos fora da lista). */
export function escopoDaUrl(valor: string | undefined): EscopoFila {
  const achado = ESCOPOS_FILA.find((e) => e.valor === valor);
  return achado ? achado.valor : 'pendentes';
}

function linhaValida(x: unknown): x is LinhaFilaTela {
  if (typeof x !== 'object' || x === null) return false;
  const l = x as Record<string, unknown>;
  return typeof l.id === 'string' && typeof l.short_id === 'string' && typeof l.status === 'string'
    && typeof l.sla_target_at === 'string' && Array.isArray(l.services) && typeof l.version === 'number';
}

/**
 * A API (GET /v1/admin/verificacao/casos) devolve os campos em portugues (identificador, prazoMeta, recebidoEm,
 * servicos, alemDaMeta, minha, versao, recurso). Converte para a linha da tela; item ja no formato da tela passa igual.
 */
export function daApi(x: unknown): unknown {
  if (typeof x !== 'object' || x === null || !('identificador' in x)) return x;
  const l = x as Record<string, unknown>;
  const { identificador, recurso, prazoMeta, recebidoEm, servicos, alemDaMeta, minha, versao, ...resto } = l;
  return {
    ...resto,
    id: l.id,
    short_id: identificador,
    status: l.status,
    appeal_status: recurso,
    sla_target_at: prazoMeta,
    received_at: recebidoEm ?? null,
    services: servicos,
    overdue: alemDaMeta === true,
    assigned_to_me: minha === true,
    version: versao,
  };
}

/** Mapeia status HTTP e corpo em um estado da tela. Corpo fora do formato vira erro generico. */
export function estadoDaFila(status: number, corpo: unknown): EstadoFila {
  if (status === 404) return { tipo: 'sem_acesso' };
  if (status !== 200 || typeof corpo !== 'object' || corpo === null) return { tipo: 'erro' };
  const brutos = (corpo as { itens?: unknown }).itens;
  if (!Array.isArray(brutos)) return { tipo: 'erro' };
  const itens = brutos.map(daApi);
  if (!itens.every(linhaValida)) return { tipo: 'erro' };
  return itens.length === 0 ? { tipo: 'vazia' } : { tipo: 'lista', itens };
}

export function rotuloEstado(status: string): string {
  return ROTULOS_ESTADO[status] ?? 'Estado desconhecido';
}

/** Selo informativo do prazo-meta (dec. 384): nunca gera alerta nesta fase. */
export function rotuloPrazo(overdue: boolean): string {
  return overdue ? 'Além da meta' : 'Dentro da meta';
}
