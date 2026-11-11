// H-104 (Issue 113) | Consulta a auditoria pelo Auditor (docs/factory/63-DESENHO-H104.md §1 a §4). Logica pura,
// sem I/O: validacao do corpo (422), decisao de autoridade (404/403) antes de qualquer leitura, mapa
// dos erros do banco e projecao fechada dos campos de cada evento (CA-H104-04).
// A rota de producao NAO e registrada aqui (etapa 4 da H-104): so a regra e o manipulador.

import { decideAdminGuard } from './guard.js';
import type { AdminGuardRecord } from './ports.js';
import { ADMIN_NOT_FOUND, ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

export const AUDIT_QUERY_PERMISSION = 'audit.read';
/** Teto fixo de 90 dias por consulta; espelho de private.audit_query (63 §4, D4). */
export const AUDIT_QUERY_MAX_DAYS = 90;
export const AUDIT_QUERY_MAX_MS = AUDIT_QUERY_MAX_DAYS * 24 * 60 * 60 * 1000;
export const AUDIT_QUERY_LIMIT_MIN = 1;
export const AUDIT_QUERY_LIMIT_MAX = 100;
export const AUDIT_QUERY_LIMIT_DEFAULT = 50;

/** Codigos do 422. O corpo traz so o codigo e o nome do campo, nunca o valor recebido. */
export type AuditQueryInvalidCode =
  | 'periodo_invalido'
  | 'periodo_acima_do_teto'
  | 'paginacao_invalida'
  | 'filtro_invalido'
  | 'corpo_invalido';

/** Campos de cada evento devolvido (lista fechada, 63 §1.2). Sem prev_hash nem row_hash (D6). */
export const AUDIT_QUERY_EVENT_FIELDS = [
  'seq',
  'id',
  'at',
  'actor_ref',
  'actor_role',
  'action',
  'object_type',
  'object_id',
  'before_state',
  'after_state',
  'reason_code',
  'correlation_id',
] as const;

const BODY_KEYS: readonly string[] = ['from', 'to', 'action', 'object_type', 'object_id', 'cursor', 'limit'];
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ACTION_RE = /^[a-z][a-z0-9_.]{0,99}$/;
const OBJECT_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditQueryParams {
  readonly fromMs: number;
  readonly toMs: number;
  readonly action: string | null;
  readonly objectType: string | null;
  readonly objectId: string | null;
  readonly cursor: number;
  readonly limit: number;
}

export type AuditQueryParse =
  | { readonly ok: true; readonly query: AuditQueryParams }
  | { readonly ok: false; readonly response: AdminResponse };

function invalid(code: AuditQueryInvalidCode, field: string): AuditQueryParse {
  return { ok: false, response: adminReply(422, { code, field }) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Campo ausente ou nulo conta como ausente (opcional). */
function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

/** Valida o corpo de POST /v1/admin/audit/queries. Nada e lido nem gravado se a validacao falhar. */
export function parseAuditQueryBody(body: unknown): AuditQueryParse {
  if (!isPlainObject(body)) return invalid('corpo_invalido', 'corpo');
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.includes(key)) return invalid('corpo_invalido', 'corpo');
  }

  // Periodo: obrigatorio, instantes ISO 8601 com fuso, intervalo [from, to), teto de 90 dias.
  if (body.from === undefined) return invalid('periodo_invalido', 'from');
  if (body.to === undefined) return invalid('periodo_invalido', 'to');
  if (typeof body.from !== 'string') return invalid('corpo_invalido', 'from');
  if (typeof body.to !== 'string') return invalid('corpo_invalido', 'to');
  if (!ISO_INSTANT_RE.test(body.from)) return invalid('periodo_invalido', 'from');
  if (!ISO_INSTANT_RE.test(body.to)) return invalid('periodo_invalido', 'to');
  const fromMs = Date.parse(body.from);
  const toMs = Date.parse(body.to);
  if (Number.isNaN(fromMs)) return invalid('periodo_invalido', 'from');
  if (Number.isNaN(toMs)) return invalid('periodo_invalido', 'to');
  if (fromMs >= toMs) return invalid('periodo_invalido', 'to');
  if (toMs - fromMs > AUDIT_QUERY_MAX_MS) return invalid('periodo_acima_do_teto', 'to');

  // Paginacao: limit inteiro 1..100 (padrao 50); cursor inteiro >= 0 (padrao 0).
  let limit = AUDIT_QUERY_LIMIT_DEFAULT;
  if (!absent(body.limit)) {
    if (typeof body.limit !== 'number') return invalid('corpo_invalido', 'limit');
    if (!Number.isInteger(body.limit) || body.limit < AUDIT_QUERY_LIMIT_MIN || body.limit > AUDIT_QUERY_LIMIT_MAX) {
      return invalid('paginacao_invalida', 'limit');
    }
    limit = body.limit;
  }
  let cursor = 0;
  if (!absent(body.cursor)) {
    if (typeof body.cursor !== 'number') return invalid('corpo_invalido', 'cursor');
    if (!Number.isSafeInteger(body.cursor) || body.cursor < 0) return invalid('paginacao_invalida', 'cursor');
    cursor = body.cursor;
  }

  // Filtros: so formato de identificador e de catalogo; o catalogo e conferido pelo banco (ADM31).
  let action: string | null = null;
  if (!absent(body.action)) {
    if (typeof body.action !== 'string') return invalid('corpo_invalido', 'action');
    if (!ACTION_RE.test(body.action)) return invalid('filtro_invalido', 'action');
    action = body.action;
  }
  let objectType: string | null = null;
  if (!absent(body.object_type)) {
    if (typeof body.object_type !== 'string') return invalid('corpo_invalido', 'object_type');
    if (!OBJECT_TYPE_RE.test(body.object_type)) return invalid('filtro_invalido', 'object_type');
    objectType = body.object_type;
  }
  let objectId: string | null = null;
  if (!absent(body.object_id)) {
    if (typeof body.object_id !== 'string') return invalid('corpo_invalido', 'object_id');
    if (!UUID_RE.test(body.object_id)) return invalid('filtro_invalido', 'object_id');
    if (objectType === null) return invalid('filtro_invalido', 'object_id');
    objectId = body.object_id;
  }

  return { ok: true, query: { fromMs, toMs, action, objectType, objectId, cursor, limit } };
}

/** Entrada que o manipulador passa ao repositorio (a funcao do banco revalida a autoridade). */
export interface AuditQueryInput extends AuditQueryParams {
  readonly actorUserId: string;
  readonly secret: string;
  readonly nowMs: number;
}

/** Pagina devolvida por private.audit_query (mesmos nomes do jsonb do banco). */
export interface AuditQueryPage {
  readonly consulta_id: string;
  readonly eventos: readonly Readonly<Record<string, unknown>>[];
  readonly tem_mais: boolean;
  readonly proximo_cursor: number | null;
}

export interface AuditQueryPort {
  /** Lanca erro com `code` (SQLSTATE ou ADM30/ADM31) e `message` (codigo de negocio) quando recusa. */
  query(input: AuditQueryInput): Promise<AuditQueryPage>;
}

/** Erro de banco reconhecido: ADM30 sem sessao, 42501 sem permissao, ADM31 validacao. Resto = 503. */
export function mapAuditQueryDbError(err: unknown): AdminResponse {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';
  const message = typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : '';
  if (code === 'ADM30') return ADMIN_NOT_FOUND;
  if (code === '42501') return ADMIN_PERMISSION_DENIED;
  if (code === 'ADM31') {
    const known = ['periodo_invalido', 'periodo_acima_do_teto', 'paginacao_invalida', 'filtro_invalido'];
    const motivo = known.find((k) => message.includes(k)) ?? 'filtro_invalido';
    return adminReply(422, { code: motivo });
  }
  return adminReply(503, { code: 'auditoria_indisponivel' });
}

/** Projeta cada evento na lista fechada de campos; campo ausente vira nulo (sempre 12 chaves). */
export function projectAuditQueryPage(page: AuditQueryPage): AuditQueryPage {
  return {
    consulta_id: page.consulta_id,
    eventos: page.eventos.map((e) => {
      const out: Record<string, unknown> = {};
      for (const field of AUDIT_QUERY_EVENT_FIELDS) out[field] = e[field] ?? null;
      return out;
    }),
    tem_mais: page.tem_mais,
    proximo_cursor: page.proximo_cursor,
  };
}

export interface AuditQueryRequest {
  /** Linha da guarda do banco para o segredo da sessao (nula = sem sessao valida). */
  readonly row: AdminGuardRecord | null;
  /** Segredo do cookie; nulo quando ausente. */
  readonly secret: string | null;
  readonly body: unknown;
}

/**
 * Manipulador da consulta. Ordem: autoridade (404 sem sessao/papel; 403 sem audit.read) sem tocar no
 * banco; validacao (422) sem tocar no banco; consulta; erros do banco mapeados (sem dado).
 */
export async function handleAuditQuery(
  req: AuditQueryRequest,
  port: AuditQueryPort,
  nowMs: number,
): Promise<AdminResponse> {
  const guard = decideAdminGuard(req.row, AUDIT_QUERY_PERMISSION, nowMs);
  if (guard.kind !== 'autorizada') {
    return guard.kind === 'recusada' ? guard.response : ADMIN_NOT_FOUND;
  }
  const parsed = parseAuditQueryBody(req.body);
  if (!parsed.ok) return parsed.response;
  if (req.secret === null) return ADMIN_NOT_FOUND;

  let page: AuditQueryPage;
  try {
    page = await port.query({
      ...parsed.query,
      actorUserId: guard.userId,
      secret: req.secret,
      nowMs,
    });
  } catch (err) {
    return mapAuditQueryDbError(err);
  }
  return adminReply(200, { ...projectAuditQueryPage(page) });
}
