// H-025 | Rotas do rascunho sem conta (docs/factory/74-DESENHO-H025.md, §1; CA-01..CA-06, CA-09, CA-10).
// POST /v1/drafts; GET, PATCH e DELETE /v1/drafts/current. Sem id na URL: o rascunho e o do cookie.
// Ordem: Origin e Sec-Fetch-Site -> Content-Type (POST e PATCH) -> cookie (formato; sem cookie = 404,
// sem banco) -> corpo (8 KB) -> servico (limite de taxa e banco). Sem CORS. Sem log de corpo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DRAFT_CURRENT_PATH,
  DRAFT_HEADERS,
  DRAFT_PATH,
  checkDraftJson,
  checkDraftOrigin,
  draftSecretFromCookie,
  normalizeClientIp,
  parseDraftBody,
  siteOriginOf,
  DRAFT_BODY_LIMIT_BYTES,
  IDENTITY_BODY_LIMIT_BYTES,
  parseIdentityBody,
  DRAFT_REVIEW_PATH,
  DRAFT_CONFIRM_PATH,
  DRAFT_CONFIRM_BODY_LIMIT_BYTES,
  parseConfirmBody,
} from '@fastpro/domain';
import {
  discardDraft,
  draftNotFound,
  getDraft,
  getIdentity,
  getReview,
  patchDraft,
  postConfirm,
  postDraft,
  putIdentity,
  type DraftDeps,
  type DraftOutcome,
} from './draft-service.js';

export interface DraftRouteOptions {
  /** Portas e dependencias do rascunho. Montadas na composicao. */
  readonly deps: DraftDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
}

/** H-013 (91 §1.5): identificacao do rascunho (nome e e-mail), ao lado das rotas de H-025. */
export const DRAFT_IDENTITY_PATH = `${DRAFT_CURRENT_PATH}/identity` as const;

/** Rotas desta historia (para o roteador). Qualquer metodo nelas cai no mesmo 404 uniforme. */
export function isDraftRoute(path: string): boolean {
  return (
    path === DRAFT_PATH ||
    path === DRAFT_CURRENT_PATH ||
    path === DRAFT_IDENTITY_PATH ||
    path === DRAFT_REVIEW_PATH ||
    path === DRAFT_CONFIRM_PATH
  );
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (413 sem reset). */
function lerCorpo(
  req: IncomingMessage,
  limite: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
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

function enviar(res: ServerResponse, r: DraftOutcome): void {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
}

function erro(status: 403 | 415 | 422 | 413, code: string): DraftOutcome {
  return { status, headers: DRAFT_HEADERS, body: JSON.stringify({ code }) };
}

export async function handleDraftRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: DraftRouteOptions,
): Promise<void> {
  try {
    const metodo = req.method ?? '';
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      metodo !== 'GET',
    );
    if (!origem.ok) return enviar(res, erro(403, 'origem_invalida'));

    const escreve = metodo === 'POST' || metodo === 'PATCH' || (metodo === 'PUT' && path === DRAFT_IDENTITY_PATH);
    if (escreve) {
      const tipo = checkDraftJson(cabecalho(req.headers['content-type']));
      if (!tipo.ok) return enviar(res, erro(415, 'tipo_invalido'));
    }

    const ip = normalizeClientIp(req.socket.remoteAddress).value;
    const segredo = draftSecretFromCookie(cabecalho(req.headers.cookie));

    if (path === DRAFT_PATH && metodo === 'POST') {
      // Cookie malformado conta como ausente: cria um rascunho novo (sem ir ao banco antes).
      const { text, bytes } = await lerCorpo(req, DRAFT_BODY_LIMIT_BYTES);
      const corpo = parseDraftBody(text, bytes);
      if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
      return enviar(res, await postDraft({ fields: corpo.fields, secret: segredo, ip }, opts.deps));
    }

    if (path === DRAFT_IDENTITY_PATH) {
      // Mesma ordem de H-025: cookie (formato; ausente = 404 sem banco) -> corpo -> servico. Sem identidade = 404.
      if (segredo === null) return enviar(res, draftNotFound());
      if (metodo === 'GET') return enviar(res, await getIdentity(segredo, ip, opts.deps));
      if (metodo === 'PUT') {
        const { text, bytes } = await lerCorpo(req, IDENTITY_BODY_LIMIT_BYTES);
        const corpo = parseIdentityBody(text, bytes);
        if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
        return enviar(res, await putIdentity(corpo.fields, segredo, ip, opts.deps));
      }
    }

    if (path === DRAFT_REVIEW_PATH && metodo === 'GET') {
      // H-030 (90 §2.1): cookie (formato; ausente = 404 sem banco) -> limite -> banco. Nao altera nada.
      if (segredo === null) return enviar(res, draftNotFound());
      return enviar(res, await getReview(segredo, ip, opts.deps));
    }

    if (path === DRAFT_CONFIRM_PATH && metodo === 'POST') {
      // H-030 (90 §2.2): Origin e Content-Type ja conferidos acima; cookie -> corpo (1 KB, so content_rev) -> banco.
      if (segredo === null) return enviar(res, draftNotFound());
      const { text, bytes } = await lerCorpo(req, DRAFT_CONFIRM_BODY_LIMIT_BYTES);
      const corpo = parseConfirmBody(text, bytes);
      if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
      return enviar(res, await postConfirm({ contentRev: corpo.contentRev, secret: segredo, ip }, opts.deps));
    }

    if (path === DRAFT_CURRENT_PATH) {
      // Cookie ausente, malformado ou repetido: 404 imediato, sem leitura do corpo e sem banco.
      if (segredo === null) return enviar(res, draftNotFound());
      if (metodo === 'GET') return enviar(res, await getDraft(segredo, ip, opts.deps));
      if (metodo === 'DELETE') return enviar(res, await discardDraft(segredo, opts.deps));
      if (metodo === 'PATCH') {
        const { text, bytes } = await lerCorpo(req, DRAFT_BODY_LIMIT_BYTES);
        const corpo = parseDraftBody(text, bytes);
        if (!corpo.ok) return enviar(res, erro(corpo.status, corpo.code));
        return enviar(res, await patchDraft({ fields: corpo.fields, secret: segredo, ip }, opts.deps));
      }
    }

    return enviar(res, draftNotFound());
  } catch {
    // Sem detalhe de erro na resposta nem no registro: falha nossa vira 503 fixo.
    if (!res.headersSent) enviar(res, { status: 503, headers: DRAFT_HEADERS, body: JSON.stringify({ code: 'indisponivel' }) });
  }
}
