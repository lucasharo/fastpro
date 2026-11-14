// Issue 47 (H-034) | Painel do cliente: rotulos, textos, prazo e cursor da lista (logica pura).
// Docs: docs/factory/133-DESENHO-H034.md, §0.2, §3.2, §4, §6.1, §7 e §9. Sem rede, sem banco, sem DOM e sem relogio:
// o instante chega como parametro. A API envia codigos (status e prazo); os rotulos saem daqui, fonte unica (R-08).
// Lista fechada: nenhum endereco, e-mail, telefone, coordenada, descricao ou contador entra nesta camada (CA-06, CA-16).

/** Tamanho fixo da pagina da lista (decisao 523 e desenho §6.1). */
export const REQUEST_LIST_PAGE_SIZE = 20 as const;

/** Estados gravados do pedido (enum fechado do banco; nao existe "expirado", decisao 456). */
export const REQUEST_STATUSES = ['publicado', 'selecionado', 'concluido', 'cancelado'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Estado do prazo, so para pedido publicado (decisao 522). */
export const DEADLINE_STATES = ['aberto', 'encerrado'] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/** Chaves de cada item da lista, na ordem da resposta. Lista fechada (CA-06, T-06). */
export const PANEL_ITEM_KEYS = [
  'id',
  'serviceName',
  'status',
  'prazo',
  'publishedAt',
  'acceptanceDeadlineAt',
] as const;

export const REQUEST_STATUS_LABEL: Readonly<Record<RequestStatus, string>> = {
  publicado: 'Publicado',
  selecionado: 'Profissional selecionado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export const DEADLINE_LABEL: Readonly<Record<DeadlineState, string>> = {
  aberto: 'Aceites abertos',
  encerrado: 'Prazo de aceites encerrado',
};

/** Textos fixos da tela (fonte unica para a tela e para os testes T-06 e T-09). */
export const PANEL_TEXT = {
  titulo: 'Meus pedidos',
  carregando: 'Carregando seus pedidos',
  vazio: 'Você ainda não publicou pedidos.',
  acaoNovoPedido: 'Novo pedido',
  erro: 'Não foi possível carregar seus pedidos agora.',
  acaoTentarDeNovo: 'Tentar de novo',
  sessaoExpirada: 'Sua sessão expirou. Peça um novo link de acesso para ver seus pedidos.',
  acaoCarregarMais: 'Carregar mais',
  posPublicacao:
    'Seu pedido foi publicado. Ele fica aberto para aceites por 7 dias. Para acompanhar, volte ao FastPro e abra Meus pedidos.',
  acaoVerPedidos: 'Ver meus pedidos',
} as const;

/**
 * Estado do prazo no instante dado (RN-H034-04, decisao 517). Fronteira: no instante exato do prazo o estado ja e
 * `encerrado`. A precisao em microssegundos e provada no banco (T-05); aqui os instantes sao em milissegundos.
 */
export function deadlineState(nowMs: number, deadlineMs: number): DeadlineState {
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs)) throw new RangeError('instante_invalido');
  return nowMs < deadlineMs ? 'aberto' : 'encerrado';
}

/** Rotulo do prazo: so existe para pedido publicado (decisao 522). Para os demais, devolve null. */
export function deadlineLabelOf(status: RequestStatus, prazo: DeadlineState | null): string | null {
  if (status !== 'publicado' || prazo === null) return null;
  return DEADLINE_LABEL[prazo];
}

/** Par de rotulos de um item da lista, derivado do codigo de estado e do codigo de prazo. */
export function panelItemLabels(
  status: RequestStatus,
  prazo: DeadlineState | null,
): { readonly status: string; readonly prazo: string | null } {
  return { status: REQUEST_STATUS_LABEL[status], prazo: deadlineLabelOf(status, prazo) };
}

/** Cursor opaco: base64url de `<instante em microssegundos UTC>|<uuid do pedido>`. Tamanho 3 a 120 caracteres. */
const CURSOR_MIN = 3;
const CURSOR_MAX = 120;
const CURSOR_BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CURSOR_PAYLOAD_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ListCursor {
  /** Instante de publicacao com seis casas decimais, exatamente como o banco devolve (sem passar por Date). */
  readonly publishedAt: string;
  readonly id: string;
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(`${cursor.publishedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

/** Interpreta o cursor recebido. Qualquer desvio (tamanho, alfabeto, formato, data) devolve null. */
export function parseListCursor(raw: string): ListCursor | null {
  if (typeof raw !== 'string' || raw.length < CURSOR_MIN || raw.length > CURSOR_MAX) return null;
  if (!CURSOR_BASE64URL_RE.test(raw)) return null;
  const texto = Buffer.from(raw, 'base64url').toString('utf8');
  const casa = CURSOR_PAYLOAD_RE.exec(texto);
  if (casa === null) return null;
  const publishedAt = casa[1] ?? '';
  const id = casa[2] ?? '';
  if (Number.isNaN(Date.parse(publishedAt.slice(0, 23) + 'Z'))) return null;
  return { publishedAt, id: id.toLowerCase() };
}
