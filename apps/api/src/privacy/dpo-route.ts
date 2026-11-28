// Issue 120 (H-111) | Rotas do DPO sobre direitos do titular (147-DESENHO-H111 §5.2, §6.3):
//   GET  /v1/admin/privacy/dsr-cases                 dsr.read (filtros e cursor)
//   POST /v1/admin/privacy/dsr-cases                 dsr.open_assisted (canal dpo_externo)
//   GET  /v1/admin/privacy/dsr-cases/:id             dsr.read
//   POST /v1/admin/privacy/dsr-cases/:id/assign      dsr.decide
//   POST /v1/admin/privacy/dsr-cases/:id/process     dsr.decide
//   POST /v1/admin/privacy/dsr-cases/:id/reject      dsr.decide
// Ordem: caminho (404 vazio) -> cookie do painel (ausente = 404 sem banco) -> guarda no banco (404)
// -> permissao da rota (403) -> Origin e JSON nas mutacoes (403) -> corpo limitado -> servico.
// A permissao vem da tabela de papeis (app.admin_role_permission) pela guarda; a funcao SQL revalida.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  checkAdminMutation,
  cookieValue,
  decideAdminGuard,
  type AdminGuardRecord,
  type AdminMethod,
  type AdminPermission,
  type AdminResponse,
} from '@fastpro/domain';
import { lerCorpoLimitado } from '../corpo-limitado.js';
import { DSR_CANAL_ASSISTIDO, DSR_KINDS_DPO, DsrDpoErro, type ServicoDsrDpo } from './dpo-service.js';

export const PRIVACY_DPO_PATH = '/v1/admin/privacy/dsr-cases' as const;

const CORPO_LIMITE_BYTES = 4096;
const NOTA_MAX = 2000;
const DESFECHO_MAX = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

export interface PrivacyDpoRouteOptions {
  /** Guarda do painel (sessao admin, papeis e permissoes). Nulo = sem sessao valida. */
  readonly guard: (secret: string, nowMs: number) => Promise<AdminGuardRecord | null>;
  readonly service: ServicoDsrDpo;
  /** ADMIN_BASE_URL: a unica Origin aceita em mutacoes. */
  readonly baseUrl: string;
  readonly clock: { nowMs(): number };
}

export type RotaDpo =
  | { readonly acao: 'colecao' }
  | { readonly acao: 'detalhe' }
  | { readonly acao: 'atribuir' | 'processar' | 'recusar' };

interface RotaResolvida {
  readonly rota: RotaDpo;
  readonly id: string | null;
}

/** Interpreta o caminho. Forma ou id fora do contrato devolve null (404 vazio). */
export function privacyDpoRoute(path: string): RotaResolvida | null {
  if (path === PRIVACY_DPO_PATH) return { rota: { acao: 'colecao' }, id: null };
  if (!path.startsWith(`${PRIVACY_DPO_PATH}/`)) return null;
  const [id = '', acao, extra] = path.slice(PRIVACY_DPO_PATH.length + 1).split('/');
  if (!UUID_RE.test(id) || extra !== undefined) return null;
  if (acao === undefined) return { rota: { acao: 'detalhe' }, id };
  if (acao === 'assign') return { rota: { acao: 'atribuir' }, id };
  if (acao === 'process') return { rota: { acao: 'processar' }, id };
  if (acao === 'reject') return { rota: { acao: 'recusar' }, id };
  return null;
}

export function isPrivacyDpoRoute(path: string): boolean {
  return path === PRIVACY_DPO_PATH || path.startsWith(`${PRIVACY_DPO_PATH}/`);
}

/** Permissao exigida por rota e metodo. Metodo fora do contrato devolve undefined (404 vazio). */
function permissaoDe(rota: RotaDpo, metodo: string): AdminPermission | undefined {
  if (rota.acao === 'colecao') {
    if (metodo === 'GET') return 'dsr.read';
    if (metodo === 'POST') return 'dsr.open_assisted';
    return undefined;
  }
  if (rota.acao === 'detalhe') return metodo === 'GET' ? 'dsr.read' : undefined;
  return metodo === 'POST' ? 'dsr.decide' : undefined;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviarNaoEncontrado(res: ServerResponse): void {
  // Mesmo 404 da rota inexistente (app.ts): corpo vazio, sem revelar a rota a quem nao tem papel.
  res.writeHead(404, SEM_CACHE);
  res.end();
}

function enviarAdmin(res: ServerResponse, resposta: AdminResponse): void {
  if (resposta.status === 404) return enviarNaoEncontrado(res);
  res.writeHead(resposta.status, { ...resposta.headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(resposta.body));
}

function enviar(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { ...SEM_CACHE, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function chavesPermitidas(objeto: Record<string, unknown>, permitidas: readonly string[]): boolean {
  return Object.keys(objeto).every((c) => permitidas.includes(c));
}

async function corpoJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const corpo = await lerCorpoLimitado(req, CORPO_LIMITE_BYTES);
  if (corpo.excedeu) return null;
  try {
    const json: unknown = JSON.parse(corpo.text);
    return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Valida a abertura assistida: canal fixo dpo_externo, sujeito e tipo obrigatorios. */
export function validarAberturaDpo(
  json: Record<string, unknown>,
): { subject: string; kind: string; details: Record<string, unknown>; channel: string } | null {
  if (!chavesPermitidas(json, ['subject', 'kind', 'details', 'channel'])) return null;
  const { subject, kind, channel } = json;
  if (typeof subject !== 'string' || !UUID_RE.test(subject)) return null;
  if (typeof kind !== 'string' || !(DSR_KINDS_DPO as readonly string[]).includes(kind)) return null;
  if (channel !== DSR_CANAL_ASSISTIDO) return null;
  const details = json.details ?? {};
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  return { subject, kind, details: details as Record<string, unknown>, channel };
}

/** Valida a recusa: nota obrigatoria (texto), parcial opcional e desfecho curto. */
export function validarRecusaDpo(
  json: Record<string, unknown>,
): { note: string; partial: boolean; outcome: string } | null {
  if (!chavesPermitidas(json, ['note', 'partial', 'outcome'])) return null;
  const { note, outcome } = json;
  const partial = json.partial ?? false;
  if (typeof note !== 'string' || note.trim() === '' || note.length > NOTA_MAX) return null;
  if (typeof outcome !== 'string' || outcome.trim() === '' || outcome.length > DESFECHO_MAX) return null;
  if (typeof partial !== 'boolean') return null;
  return { note, partial, outcome };
}

function listagemDoQuery(
  url: string | undefined,
): { filtros: { status: string | null; kind: string | null; prazo: string | null; assignedTo: string | null }; limite: number; cursor: { abertura: string; id: string } | null } | null {
  const params = new URL(url ?? '/', 'http://localhost').searchParams;
  const bruto = params.get('limit');
  const limite = bruto === null ? 20 : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) return null;
  const abertura = params.get('cursor_opened_at');
  const id = params.get('cursor_id');
  if ((abertura === null) !== (id === null)) return null;
  if (abertura !== null && (Number.isNaN(Date.parse(abertura)) || id === null || !UUID_RE.test(id))) return null;
  const assignedTo = params.get('assigned_to');
  if (assignedTo !== null && !UUID_RE.test(assignedTo)) return null;
  return {
    filtros: {
      status: params.get('status'),
      kind: params.get('kind'),
      prazo: params.get('prazo'),
      assignedTo,
    },
    limite,
    cursor: abertura === null || id === null ? null : { abertura, id },
  };
}

export async function handlePrivacyDpoRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: PrivacyDpoRouteOptions,
): Promise<void> {
  try {
    const resolvida = privacyDpoRoute(path);
    const metodo = (req.method ?? 'GET').toUpperCase();
    const permissao = resolvida === null ? undefined : permissaoDe(resolvida.rota, metodo);
    if (resolvida === null || permissao === undefined) return enviarNaoEncontrado(res);

    const segredo = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE);
    if (segredo === undefined) return enviarNaoEncontrado(res);
    const nowMs = opts.clock.nowMs();
    const linha = await opts.guard(segredo, nowMs);
    const decisao = decideAdminGuard(linha, permissao, nowMs);
    if (decisao.kind === 'recusada') return enviarAdmin(res, decisao.response);
    if (decisao.kind !== 'autorizada') return enviarNaoEncontrado(res);

    const origem = checkAdminMutation(
      metodo as AdminMethod,
      {
        contentType: cabecalho(req.headers['content-type']) ?? null,
        origin: cabecalho(req.headers.origin) ?? null,
        secFetchSite: cabecalho(req.headers['sec-fetch-site']) ?? null,
      },
      opts.baseUrl,
    );
    if (origem !== null) return enviarAdmin(res, origem);

    const ator = decisao.userId;
    const { rota } = resolvida;
    const id = resolvida.id ?? '';

    if (rota.acao === 'colecao' && metodo === 'GET') {
      const lista = listagemDoQuery(req.url);
      if (lista === null) return enviar(res, 422, { code: 'paginacao_invalida' });
      const r = await opts.service.listar(ator, lista.filtros, lista.limite, lista.cursor);
      return enviar(res, r.status, r.corpo);
    }
    if (rota.acao === 'colecao') {
      const json = await corpoJson(req);
      const entrada = json === null ? null : validarAberturaDpo(json);
      if (entrada === null) return enviar(res, 422, { code: 'corpo_invalido' });
      const r = await opts.service.abrir(ator, entrada);
      return enviar(res, r.status, r.corpo);
    }
    if (rota.acao === 'detalhe') {
      const r = await opts.service.obter(ator, id);
      return enviar(res, r.status, r.corpo);
    }
    if (rota.acao === 'atribuir') {
      const json = await corpoJson(req);
      const responsavel = json?.assignee;
      if (json === null || !chavesPermitidas(json, ['assignee']) || typeof responsavel !== 'string' || !UUID_RE.test(responsavel)) {
        return enviar(res, 422, { code: 'corpo_invalido' });
      }
      const r = await opts.service.atribuir(ator, id, responsavel);
      return enviar(res, r.status, r.corpo);
    }
    if (rota.acao === 'processar') {
      const r = await opts.service.processar(ator, id);
      return enviar(res, r.status, r.corpo);
    }
    const json = await corpoJson(req);
    const decisaoRecusa = json === null ? null : validarRecusaDpo(json);
    if (decisaoRecusa === null) return enviar(res, 422, { code: 'corpo_invalido' });
    const r = await opts.service.recusar(ator, id, decisaoRecusa);
    return enviar(res, r.status, r.corpo);
  } catch (erro) {
    if (erro instanceof DsrDpoErro) return enviar(res, erro.status, erro.corpo);
    // Falha nossa vira 503 fixo: sem detalhe de banco, de sessao ou de corpo na resposta nem no registro.
    if (!res.headersSent) enviar(res, 503, { code: 'leitura_indisponivel' });
  }
}
