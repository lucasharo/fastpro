// H-009 | Esqueleto da API da hospedagem (uma funcao, desenho 42 §1.1). Sem framework: node:http puro.
// Reaproveita so o nucleo de autenticacao do tick (H-008, @fastpro/db): segredo com pelo menos 32
// caracteres, comparacao em tempo constante e limite de 1 KB do corpo. Nao ha acesso ao banco aqui.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isTickAuthorized, TICK_BODY_LIMIT_BYTES, TICK_PATH } from '@fastpro/db';
import { CONSUME_PATH } from '@fastpro/domain';
import { handleConsume, type ConsumeRouteOptions } from './consume-route.js';
import {
  handleSessionConvert,
  handleSessionLogout,
  handleSessionLogoutAll,
  handleStepUp,
  SESSION_CONVERT_PATH,
  SESSION_LOGOUT_ALL_PATH,
  SESSION_LOGOUT_PATH,
  STEP_UP_PATH,
  type SessionRouteOptions,
} from './session-route.js';

/** Limite de corpo da aplicacao (CA-07): 4 MB inclusivo. Acima disso a resposta e 413. */
export const APP_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
export const HEALTH_PATH = '/health';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const JSON_HEADERS = {
  ...NO_STORE,
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AppOptions {
  /** Segredo do tick (nome JOBS_TICK_SECRET). Ausente ou curto demais: o tick fica fechado (401). */
  readonly tickSecret: string | undefined;
  /** Consumo do link (H-012). Sem esta opcao a rota nao existe (404). */
  readonly consume?: ConsumeRouteOptions;
  /** Sessao de 7 dias e step-up (H-014). Sem esta opcao as rotas nao existem (404). */
  readonly session?: SessionRouteOptions;
}

export interface BodyReadResult {
  /** Bytes lidos ate o fim do corpo. O corpo nunca e guardado, so contado. */
  readonly bytes: number;
  readonly overflow: boolean;
}

/**
 * Conta os bytes do corpo sem armazena-lo. Ao passar do limite, o restante e descartado ate o fim
 * (a resposta 413 so sai depois, para o cliente nao receber reset de conexao no meio do envio).
 */
export function readBodyBytes(req: IncomingMessage, limit: number): Promise<BodyReadResult> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    req.on('end', () => resolve({ bytes, overflow: bytes > limit }));
    req.on('error', reject);
  });
}

/**
 * Caminho usado pelas rotas. Atras da mesma origem (web encaminha /api/*), o caminho chega com o
 * prefixo /api; sem ele, chega direto. As duas formas apontam para a mesma rota.
 */
export function routePath(url: string | undefined): string {
  const { pathname } = new URL(url ?? '/', 'http://localhost');
  const stripped = pathname.replace(/^\/api(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
): void {
  res.writeHead(status, headers);
  res.end(body);
}

async function handleTick(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AppOptions,
): Promise<void> {
  if (!isTickAuthorized(req.headers.authorization, opts.tickSecret)) {
    send(res, 401, NO_STORE, '');
    return;
  }
  const { bytes, overflow } = await readBodyBytes(req, APP_BODY_LIMIT_BYTES);
  if (overflow || bytes > TICK_BODY_LIMIT_BYTES) {
    send(res, 413, NO_STORE, '');
    return;
  }
  // Nesta pre-visualizacao o tick nao executa jobs (sem banco). A resposta prova o caminho autenticado.
  send(res, 200, JSON_HEADERS, JSON.stringify({ ok: true }));
}

/** Roteia uma requisicao. Rotas desconhecidas e metodos errados respondem 404 sem corpo. */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AppOptions,
): Promise<void> {
  const path = routePath(req.url);
  if (req.method === 'GET' && path === HEALTH_PATH) {
    send(res, 200, JSON_HEADERS, JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method === 'POST' && path === TICK_PATH) {
    await handleTick(req, res, opts);
    return;
  }
  if (req.method === 'POST' && path === CONSUME_PATH && opts.consume) {
    await handleConsume(req, res, opts.consume);
    return;
  }
  if (req.method === 'POST' && opts.session) {
    const sessao = opts.session;
    if (path === SESSION_CONVERT_PATH) return handleSessionConvert(req, res, sessao);
    if (path === SESSION_LOGOUT_PATH) return handleSessionLogout(req, res, sessao);
    if (path === SESSION_LOGOUT_ALL_PATH) return handleSessionLogoutAll(req, res, sessao);
    if (path === STEP_UP_PATH && sessao.proof !== undefined) return handleStepUp(req, res, sessao);
  }
  send(res, 404, NO_STORE, '');
}
