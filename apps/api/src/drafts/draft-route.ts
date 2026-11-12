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
} from '@fastpro/domain';
import {
  discardDraft,
  draftNotFound,
  getDraft,
  patchDraft,
  postDraft,
  type DraftDeps,
  type DraftOutcome,
} from './draft-service.js';

export interface DraftRouteOptions {
  /** Portas e dependencias do rascunho. Montadas na composicao. */
  readonly deps: DraftDeps;
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
}

/** Rotas desta historia (para o roteador). Qualquer metodo nelas cai no mesmo 404 uniforme. */
export function isDraftRoute(path: string): boolean {
  return path === DRAFT_PATH || path === DRAFT_CURRENT_PATH;
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

    const escreve = metodo === 'POST' || metodo === 'PATCH';
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
