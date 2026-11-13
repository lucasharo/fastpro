// H-037 (Issue #50) | Rotas dos documentos de identidade (docs/factory/107-DESENHO-H037.md, §3; CA-06, CA-12, CA-18).
//   GET    /v1/professional/documents                       lista do dono
//   POST   /v1/professional/documents/uploads               reserva a vaga e devolve a URL de envio
//   POST   /v1/professional/documents/{id}/finalize         valida, reencoda e grava a versao final
//   DELETE /v1/professional/documents/{id}                  exclui enquanto nao analisado
// Ordem: Origin/Sec-Fetch-Site -> Content-Type (so emissao) -> sessao (sem cookie valido: 401) -> id uuid (senao 404,
// sem banco) -> perfil profissional (conta sem perfil: 404 uniforme) -> corpo -> servico. Qualquer outro caminho ou
// metodo recebe o mesmo 404 uniforme. Nao existe rota de leitura de arquivo nem URL de leitura (CA-06).
// Esta funcao NAO e montada em app.ts nesta fase (fase 2, depois da #141). Os testes chamam o despacho direto.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  checkDraftJson,
  checkDraftOrigin,
  cookieValue,
  normalizeClientIp,
  siteOriginOf,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import { IDOC_BODY_LIMIT_BYTES, IDOC_PATH } from './espelho/constants.js';
import { ehIdentityDocUuid, parseIdentityDocEmissaoBody } from './espelho/body.js';
import {
  IDOC_NAO_ENCONTRADO,
  emitirDocumento,
  excluirDocumento,
  finalizarDocumento,
  listarDocumentos,
  type IdentityDocOutcome,
  type IdentityDocServiceDeps,
} from './identity-doc-service.js';

/** Porta de perfil: a conta da sessao tem perfil profissional? (H-035, professional_profile). */
export interface IdentityDocProfilePort {
  existe(userId: string): Promise<boolean>;
}

export interface IdentityDocRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly perfis: IdentityDocProfilePort;
  readonly deps: IdentityDocServiceDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin nas escritas. */
  readonly siteUrl: string;
}

type Rota =
  | { readonly tipo: 'listar' }
  | { readonly tipo: 'emitir' }
  | { readonly tipo: 'finalizar'; readonly id: string }
  | { readonly tipo: 'excluir'; readonly id: string };

const BASE = IDOC_PATH;
const ITEM_RE = /^\/v1\/professional\/documents\/([^/]+)(\/finalize)?$/;

/** Prefixo inteiro: qualquer caminho sob a base passa pelo despacho e, se nao casar, recebe o 404 uniforme. */
export function isIdentityDocRoute(path: string): boolean {
  return path === BASE || path.startsWith(`${BASE}/`);
}

function casarRota(metodo: string, path: string): Rota | null {
  if (path === BASE && metodo === 'GET') return { tipo: 'listar' };
  if (path === `${BASE}/uploads` && metodo === 'POST') return { tipo: 'emitir' };
  const m = ITEM_RE.exec(path);
  if (m === null) return null;
  const id = m[1] ?? '';
  if (m[2] === '/finalize' && metodo === 'POST') return { tipo: 'finalizar', id };
  if (m[2] === undefined && metodo === 'DELETE') return { tipo: 'excluir', id };
  return null;
}

const CABECALHOS_BASE: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function enviar(res: ServerResponse, r: IdentityDocOutcome): void {
  const extra: Record<string, string> = { ...CABECALHOS_BASE };
  if (r.retryAfterS !== undefined) extra['Retry-After'] = String(r.retryAfterS);
  if (r.corpo === undefined) {
    res.writeHead(r.status, extra);
    res.end();
    return;
  }
  extra['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(r.status, extra);
  res.end(JSON.stringify(r.corpo));
}

/** Trava fechada (107 §9): mesmo 404 uniforme, zero chamadas a banco ou Storage. */
export function responderDocumentosFechados(res: ServerResponse): void {
  enviar(res, IDOC_NAO_ENCONTRADO);
}

/** Le o corpo guardando no maximo o limite + 1 byte; o excedente so e contado (413 sem reset de conexao). */
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

async function sessaoDoPedido(req: IncomingMessage, opts: IdentityDocRouteOptions): Promise<SessionRecord | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.sessions.authenticate(hashSessionSecret(segredo), opts.deps.clock.nowMs());
}

/** Despacho da rota. Falha inesperada vira 503 fixo, sem eco (CA-10). */
export async function handleIdentityDocRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: IdentityDocRouteOptions,
): Promise<void> {
  try {
    const metodo = req.method ?? '';
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      metodo !== 'GET',
    );
    if (!origem.ok) return enviar(res, { status: 403, corpo: { code: 'origem_invalida' } });

    const rota = casarRota(metodo, path);
    if (rota === null) {
      req.resume();
      return enviar(res, IDOC_NAO_ENCONTRADO);
    }
    if (rota.tipo === 'emitir') {
      const tipo = checkDraftJson(cabecalho(req.headers['content-type']));
      if (!tipo.ok) {
        req.resume();
        return enviar(res, { status: 415, corpo: { code: 'tipo_invalido' } });
      }
    }

    const sessao = await sessaoDoPedido(req, opts);
    if (sessao === null) {
      req.resume();
      return enviar(res, { status: 401, corpo: { code: 'nao_autenticado' } });
    }
    if ('id' in rota && !ehIdentityDocUuid(rota.id)) return enviar(res, IDOC_NAO_ENCONTRADO);

    if (!(await opts.perfis.existe(sessao.userId))) return enviar(res, IDOC_NAO_ENCONTRADO);

    const ip = normalizeClientIp(req.socket.remoteAddress).value;
    const userId = sessao.userId;
    switch (rota.tipo) {
      case 'listar':
        return enviar(res, await listarDocumentos({ userId, ip }, opts.deps));
      case 'emitir': {
        const lido = await lerCorpo(req, IDOC_BODY_LIMIT_BYTES);
        const corpo = parseIdentityDocEmissaoBody(lido.text, lido.bytes);
        if (!corpo.ok) return enviar(res, { status: corpo.status, corpo: { code: corpo.code } });
        return enviar(res, await emitirDocumento({ userId, ip, corpo: corpo.corpo }, opts.deps));
      }
      case 'finalizar':
        req.resume();
        return enviar(res, await finalizarDocumento({ userId, id: rota.id }, opts.deps));
      case 'excluir':
        req.resume();
        return enviar(res, await excluirDocumento({ userId, id: rota.id }, opts.deps));
    }
  } catch {
    return enviar(res, { status: 503, corpo: { code: 'servico_indisponivel' } });
  }
}
