// H-031 (Issue #44) | Rota POST /v1/requests (docs/factory/110-DESENHO-H031.md, §2, §3.1; D-03, D-12).
// Ordem fixa: Origin -> Content-Type -> provedor (sem provedor = 503 antes de qualquer banco) -> Idempotency-Key
// -> cookie de sessao (ausente = 401) -> cookie do rascunho (ausente = 404 uniforme) -> corpo (1 KB, chaves exatas)
// -> sessao no banco (401 se nula) -> servico. Sem CORS. Sem log de corpo, cookie ou token.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DRAFT_HEADERS,
  SESSION_COOKIE_NAME,
  checkDraftJson,
  checkDraftOrigin,
  cookieValue,
  draftSecretFromCookie,
  normalizeClientIp,
  siteOriginOf,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';
import {
  PUBLISH_BODY_MAX_BYTES,
  isPublishIdempotencyKey,
  parsePublishBody,
} from '../../../../packages/domain/src/request/index.js';
import { publicacaoNaoEncontrada, publishRequest, type PublishOutcome, type PublishServiceDeps } from './publish-service.js';

/** Rota desta historia (o roteador de app.ts entra na FASE 2). */
export const REQUEST_PUBLISH_PATH = '/v1/requests' as const;

export interface PublishRouteOptions {
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
  /** Sessao do cliente (PgSessionRepository em producao). */
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  /**
   * Servico da publicacao. Ausente = provedor de geocodificacao nao configurado (D-12): a rota responde
   * 503 publicacao_indisponivel antes de tocar o banco.
   */
  readonly service?: PublishServiceDeps;
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante so e contado (413 sem reset). */
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

function enviar(res: ServerResponse, r: PublishOutcome): void {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
}

function erro(status: number, code: string, cabecalhos: Record<string, string> = {}): PublishOutcome {
  return { status, headers: { ...DRAFT_HEADERS, ...cabecalhos }, body: JSON.stringify({ code }) };
}

export async function handleRequestPublishRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: PublishRouteOptions,
): Promise<void> {
  try {
    if (path !== REQUEST_PUBLISH_PATH) return enviar(res, publicacaoNaoEncontrada());
    const metodo = req.method ?? '';
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      metodo !== 'GET',
    );
    if (!origem.ok) return enviar(res, erro(403, 'origem_invalida'));
    if (metodo !== 'POST') return enviar(res, publicacaoNaoEncontrada());

    const tipo = checkDraftJson(cabecalho(req.headers['content-type']));
    if (!tipo.ok) return enviar(res, erro(415, 'tipo_invalido'));

    if (opts.service === undefined) return enviar(res, erro(503, 'publicacao_indisponivel'));

    const chave = cabecalho(req.headers['idempotency-key']);
    if (chave === undefined || !isPublishIdempotencyKey(chave)) return enviar(res, erro(422, 'chave_invalida'));

    const segredoSessao = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredoSessao === undefined) return enviar(res, erro(401, 'sessao_necessaria'));

    const segredoRascunho = draftSecretFromCookie(cabecalho(req.headers.cookie));
    if (segredoRascunho === null) return enviar(res, publicacaoNaoEncontrada());

    const { text, bytes } = await lerCorpo(req, PUBLISH_BODY_MAX_BYTES);
    if (bytes > PUBLISH_BODY_MAX_BYTES) return enviar(res, erro(413, 'corpo_grande'));
    let bruto: unknown;
    try {
      bruto = JSON.parse(text) as unknown;
    } catch {
      return enviar(res, erro(422, 'corpo_invalido'));
    }
    const corpo = parsePublishBody(bruto, bytes);
    if (!corpo.ok) return enviar(res, erro(corpo.code === 'corpo_grande' ? 413 : 422, corpo.code));

    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredoSessao), opts.service.clock.nowMs());
    if (sessao === null) return enviar(res, erro(401, 'sessao_necessaria'));

    const ip = normalizeClientIp(req.socket.remoteAddress).value;
    return enviar(
      res,
      await publishRequest(
        { body: corpo.body, idemKey: chave, secret: segredoRascunho, userId: sessao.userId, ip },
        opts.service,
      ),
    );
  } catch {
    // Sem detalhe de erro na resposta nem no registro: falha nossa vira 503 fixo.
    if (!res.headersSent) enviar(res, erro(503, 'indisponivel', { 'Retry-After': '10' }));
  }
}
