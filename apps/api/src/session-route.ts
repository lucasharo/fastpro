// H-014 | Rotas da sessao de 7 dias (docs/factory/52-DESENHO-H014.md §1 a §4).
//   POST /v1/auth/session     converte a etapa (cookie __Host-fp_ident) em sessao ativa de 7 dias.
//   POST /v1/auth/logout      revoga a sessao atual; sempre 204 e apaga o cookie.
//   POST /v1/auth/logout-all  revoga todas as sessoes da pessoa; exige sessao valida.
//   POST /v1/auth/step-up     prova recente (contrato unico, dois metodos). So existe com porta de prova.
// Ordem fixa: Origin/Sec-Fetch-Site (e Content-Type onde ha corpo) antes de ler o corpo; depois o
// corpo; depois o estado lido do banco. Respostas de falha sao fixas e nao dizem qual condicao falhou.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCESS_EXPIRED_BODY,
  CONSUME_HEADERS,
  IDENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  UNAUTHENTICATED_BODY,
  checkConsumeHeaders,
  checkStepUpMethod,
  clearCookieHeader,
  cookieValue,
  maxAgeSecondsFor,
  parseStepUpBody,
  sessionCookieHeader,
  siteOriginOf,
  STEP_UP_BODY_LIMIT_BYTES,
  type SessionRecord,
  type SessionRepositoryPort,
  type StepUpRequest,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

export const SESSION_CONVERT_PATH = '/v1/auth/session';
export const SESSION_LOGOUT_PATH = '/v1/auth/logout';
export const SESSION_LOGOUT_ALL_PATH = '/v1/auth/logout-all';
export const STEP_UP_PATH = '/v1/auth/step-up';

/** Corpo de POST sem conteudo util (conversao e step-up tem limite de 1 KiB). */
const CORPO_LIMITE = 1024;

/** Resultado de uma prova do step-up (codigo H-014 ou senha H-016). */
export type StepUpProofResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 401 | 422 | 429; readonly code: string };

/** Porta de prova. Implementada pelo codigo (H-014) e pela senha (H-016); nunca grava recent_auth_at sozinha. */
export interface StepUpProofPort {
  /** clientIp: endereco do pedido, para os limites de H-015 (nulo se ausente). */
  verify(
    session: SessionRecord,
    body: StepUpRequest,
    nowMs: number,
    clientIp?: string | null,
  ): Promise<StepUpProofResult>;
}

export const STEP_UP_CHALLENGE_PATH = '/v1/auth/step-up/challenge';

/** Resultado do pedido do codigo de step-up (adaptador em @fastpro/db, requestStepUpCode). */
export type StepUpChallengeOutcome =
  | { readonly resultado: 'criado'; readonly outboxId: string }
  | {
      readonly resultado: 'limite' | 'espera' | 'teto' | 'negado';
      readonly retryAfterSeconds: number | null;
    };

export interface StepUpChallengePort {
  request(session: SessionRecord, clientIp: string | null): Promise<StepUpChallengeOutcome>;
}

export interface SessionRouteOptions {
  readonly repo: SessionRepositoryPort;
  /** SITE_URL: a origem dela e a unica aceita em Origin. */
  readonly siteUrl: string;
  readonly clock: { nowMs(): number };
  /** Gera o segredo novo da sessao: 32 bytes em base64url (43 caracteres). */
  readonly newSecret: () => string;
  /** Porta de prova do step-up. Sem ela, POST /v1/auth/step-up nao existe (404). */
  readonly proof?: StepUpProofPort;
  /** Pedido do codigo de step-up e envio agendado. Sem ele, POST .../step-up/challenge nao existe (404). */
  readonly challenge?: {
    readonly port: StepUpChallengePort;
    readonly dispatch: { schedule(outboxId: string): void };
  };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Le o corpo guardando no maximo o limite + 1 byte; o restante e so contado (sem reset de conexao). */
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

const CABECALHOS_PADRAO = { ...CONSUME_HEADERS };

function enviarJson(
  res: ServerResponse,
  status: number,
  corpo: Record<string, string>,
  cookies: readonly string[] = [],
): void {
  const headers: Record<string, string | string[]> = { ...CABECALHOS_PADRAO };
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
  res.writeHead(status, headers);
  res.end(JSON.stringify(corpo));
}

/** 204 sem corpo: mantem os cabecalhos de seguranca e os cookies. */
function enviarVazio(res: ServerResponse, cookies: readonly string[] = []): void {
  const headers: Record<string, string | string[]> = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
  res.writeHead(204, headers);
  res.end();
}

/** Falha nossa, sem detalhe. */
function indisponivel(res: ServerResponse): void {
  if (res.headersSent) return;
  enviarJson(res, 503, { code: 'acesso_indisponivel' });
}

/** Origin e Sec-Fetch-Site (sem exigir Content-Type; usado por pedidos sem corpo). */
function origemValida(req: IncomingMessage, siteOrigin: string): boolean {
  const origin = cabecalho(req.headers.origin);
  const fetchSite = cabecalho(req.headers['sec-fetch-site']);
  if (origin !== siteOrigin) return false;
  return fetchSite === undefined || fetchSite === 'same-origin';
}

/** Corpo de conversao: exatamente {} (sem chaves). */
function corpoVazio(text: string, bytes: number): boolean {
  if (bytes > CORPO_LIMITE) return false;
  try {
    const raw: unknown = JSON.parse(text);
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0;
  } catch {
    return false;
  }
}

/** Sessao do pedido: le so o cookie fp_sess, confere no banco a cada requisicao (52 §2). */
async function sessaoDoPedido(
  req: IncomingMessage,
  opts: SessionRouteOptions,
): Promise<SessionRecord | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.repo.authenticate(hashSessionSecret(segredo), opts.clock.nowMs());
}

const APAGAR_SESSAO = clearCookieHeader('sessao');

/** POST /v1/auth/session: conversao da etapa. Uma unica resposta de negacao, sem Set-Cookie. */
export async function handleSessionConvert(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SessionRouteOptions,
): Promise<void> {
  try {
    const cabecalhos = checkConsumeHeaders(
      {
        origin: cabecalho(req.headers.origin),
        secFetchSite: cabecalho(req.headers['sec-fetch-site']),
        contentType: cabecalho(req.headers['content-type']),
      },
      siteOriginOf(opts.siteUrl),
    );
    if (!cabecalhos.ok) {
      enviarJson(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }
    const { text, bytes } = await lerCorpo(req, CORPO_LIMITE);
    if (!corpoVazio(text, bytes)) {
      enviarJson(res, 422, { code: 'pedido_invalido' });
      return;
    }

    const segredoEtapa = cookieValue(cabecalho(req.headers.cookie), IDENT_COOKIE_NAME);
    if (segredoEtapa === undefined) {
      enviarJson(res, 401, ACCESS_EXPIRED_BODY);
      return;
    }
    const agora = opts.clock.nowMs();
    const novo = opts.newSecret();
    const sessao = await opts.repo.convertStage(
      hashSessionSecret(segredoEtapa),
      hashSessionSecret(novo),
      agora,
    );
    if (sessao === null) {
      enviarJson(res, 401, ACCESS_EXPIRED_BODY);
      return;
    }
    enviarJson(res, 200, { status: 'autenticado' }, [
      sessionCookieHeader(novo, maxAgeSecondsFor(sessao.absoluteExpiresAtMs, agora)),
      clearCookieHeader('identificacao'),
    ]);
  } catch {
    // Sem detalhe de erro na resposta nem no registro.
    indisponivel(res);
  }
}

/** POST /v1/auth/logout: revoga a sessao atual. Sempre 204 e cookie apagado (idempotente). */
export async function handleSessionLogout(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SessionRouteOptions,
): Promise<void> {
  try {
    if (!origemValida(req, siteOriginOf(opts.siteUrl))) {
      enviarJson(res, 403, { code: 'origem_invalida' });
      return;
    }
    const sessao = await sessaoDoPedido(req, opts);
    if (sessao !== null) await opts.repo.revoke(sessao.sessionId, opts.clock.nowMs());
    enviarVazio(res, [APAGAR_SESSAO]);
  } catch {
    indisponivel(res);
  }
}

/** POST /v1/auth/logout-all: revoga todas as sessoes da pessoa. Exige sessao valida (401 senao). */
export async function handleSessionLogoutAll(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SessionRouteOptions,
): Promise<void> {
  try {
    if (!origemValida(req, siteOriginOf(opts.siteUrl))) {
      enviarJson(res, 403, { code: 'origem_invalida' });
      return;
    }
    const sessao = await sessaoDoPedido(req, opts);
    if (sessao === null) {
      enviarJson(res, 401, UNAUTHENTICATED_BODY, [APAGAR_SESSAO]);
      return;
    }
    await opts.repo.revokeAll(sessao.userId, opts.clock.nowMs());
    enviarVazio(res, [APAGAR_SESSAO]);
  } catch {
    indisponivel(res);
  }
}

/**
 * POST /v1/auth/step-up/challenge: pede o codigo de step-up por e-mail (52 §4.2, §4.3). Corpo {} e
 * sessao ativa por link; senao 401 (sessao) ou 422 metodo_invalido (sessao por senha). Recusa de limite:
 * 429 com Retry-After; o envio so e agendado depois de criado o desafio. Resposta 202 sem o codigo.
 */
export async function handleStepUpChallenge(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SessionRouteOptions,
): Promise<void> {
  try {
    const cabecalhos = checkConsumeHeaders(
      {
        origin: cabecalho(req.headers.origin),
        secFetchSite: cabecalho(req.headers['sec-fetch-site']),
        contentType: cabecalho(req.headers['content-type']),
      },
      siteOriginOf(opts.siteUrl),
    );
    if (!cabecalhos.ok) {
      enviarJson(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }
    const { text, bytes } = await lerCorpo(req, CORPO_LIMITE);
    if (!corpoVazio(text, bytes)) {
      enviarJson(res, 422, { code: 'pedido_invalido' });
      return;
    }
    const sessao = await sessaoDoPedido(req, opts);
    if (sessao === null) {
      enviarJson(res, 401, UNAUTHENTICATED_BODY);
      return;
    }
    if (sessao.authMethod !== 'link') {
      enviarJson(res, 422, { code: 'metodo_invalido' });
      return;
    }
    if (opts.challenge === undefined) {
      enviarJson(res, 404, { code: 'nao_encontrado' });
      return;
    }
    const r = await opts.challenge.port.request(sessao, req.socket.remoteAddress ?? null);
    if (r.resultado === 'criado') {
      try {
        opts.challenge.dispatch.schedule(r.outboxId);
      } catch {
        // Contingencia: o job de envio criado junto com a saida entrega no proximo tick.
      }
      enviarJson(res, 202, { status: 'enviado' });
      return;
    }
    if (r.resultado === 'negado') {
      enviarJson(res, 401, UNAUTHENTICATED_BODY);
      return;
    }
    res.writeHead(429, {
      ...CABECALHOS_PADRAO,
      'Retry-After': String(r.retryAfterSeconds ?? 60),
    });
    res.end(JSON.stringify({ code: 'muitos_pedidos' }));
  } catch {
    indisponivel(res);
  }
}

/**
 * POST /v1/auth/step-up: contrato unico (52 §4.2). Corpo de chaves exatas por metodo; o metodo tem de
 * ser o da sessao (422 metodo_invalido). Sessao invalida: 401 nao_autenticado. Prova ok: 204.
 */
export async function handleStepUp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SessionRouteOptions,
): Promise<void> {
  try {
    const cabecalhos = checkConsumeHeaders(
      {
        origin: cabecalho(req.headers.origin),
        secFetchSite: cabecalho(req.headers['sec-fetch-site']),
        contentType: cabecalho(req.headers['content-type']),
      },
      siteOriginOf(opts.siteUrl),
    );
    if (!cabecalhos.ok) {
      enviarJson(res, cabecalhos.status, { code: cabecalhos.code });
      return;
    }
    const { text, bytes } = await lerCorpo(req, STEP_UP_BODY_LIMIT_BYTES);
    const corpo = parseStepUpBody(text, bytes);
    if (!corpo.ok) {
      enviarJson(res, 422, { code: 'pedido_invalido' });
      return;
    }

    const sessao = await sessaoDoPedido(req, opts);
    if (sessao === null) {
      enviarJson(res, 401, UNAUTHENTICATED_BODY, [APAGAR_SESSAO]);
      return;
    }
    if (!checkStepUpMethod(sessao.authMethod, corpo.method)) {
      enviarJson(res, 422, { code: 'metodo_invalido' });
      return;
    }
    if (opts.proof === undefined) {
      enviarJson(res, 404, { code: 'nao_encontrado' });
      return;
    }
    const agora = opts.clock.nowMs();
    const prova = await opts.proof.verify(sessao, corpo, agora, req.socket.remoteAddress ?? null);
    if (!prova.ok) {
      enviarJson(res, prova.status, { code: prova.code });
      return;
    }
    await opts.repo.markRecentAuth(sessao.sessionId, agora);
    enviarVazio(res);
  } catch {
    indisponivel(res);
  }
}
