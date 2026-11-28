// Aparelhos de notificacao push (2026-11-27).
//   GET  /v1/push/config           sem sessao: {webPublicKey} (null quando a web ainda nao tem chaves)
//   POST /v1/push/devices          sessao: {platform, token, keys?} -> 204
//   POST /v1/push/devices/remove   sessao: {token} -> 204 (idempotente)
// Ordem: rota -> Origin e Content-Type -> sessao -> corpo -> banco.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, checkDraftJson, checkDraftOrigin, cookieValue, siteOriginOf } from '@fastpro/domain';
import { hashSessionSecret, type AparelhoPush, type PgPushStore } from '@fastpro/db';
import { lerCorpoLimitado } from '../corpo-limitado.js';
import { chavesDaInscricaoValidas, endpointAceito } from './web-push.js';

export const PUSH_CONFIG_PATH = '/v1/push/config';
export const PUSH_DEVICES_PATH = '/v1/push/devices';
export const PUSH_REMOVE_PATH = '/v1/push/devices/remove';
const CORPO_MAX_BYTES = 4096;
const EXPO_TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;

export interface PushRouteOptions {
  readonly siteUrl: string;
  readonly webPublicKey: string | null;
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly store: Pick<PgPushStore, 'registrar' | 'remover'>;
  readonly clock: { nowMs(): number };
}

export function isPushRoute(metodo: string, path: string): boolean {
  if (path === PUSH_CONFIG_PATH) return metodo === 'GET';
  return metodo === 'POST' && (path === PUSH_DEVICES_PATH || path === PUSH_REMOVE_PATH);
}

function enviar(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Aparelho valido a partir do corpo, ou null. */
export function lerAparelho(corpo: unknown): AparelhoPush | null {
  const c = (corpo ?? {}) as { platform?: unknown; token?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof c.token !== 'string') return null;
  if (c.platform === 'android' || c.platform === 'ios') {
    return EXPO_TOKEN_RE.test(c.token) ? { platform: c.platform, token: c.token, p256dh: null, auth: null } : null;
  }
  const p256dh = c.keys?.p256dh;
  const auth = c.keys?.auth;
  if (c.platform !== 'web' || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!endpointAceito(c.token) || !chavesDaInscricaoValidas(p256dh, auth)) return null;
  return { platform: 'web', token: c.token, p256dh, auth };
}

export async function handlePushRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: PushRouteOptions,
): Promise<void> {
  try {
    if (path === PUSH_CONFIG_PATH) return enviar(res, 200, { webPublicKey: opts.webPublicKey });

    // O app nativo envia o Origin do site (nao ha Sec-Fetch-Site fora do navegador).
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.siteUrl),
      true,
    );
    if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    if (!checkDraftJson(cabecalho(req.headers['content-type'])).ok) return enviar(res, 415, { code: 'tipo_nao_aceito' });

    const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessao = await opts.sessions.authenticate(hashSessionSecret(segredo), agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });

    const { text, excedeu } = await lerCorpoLimitado(req, CORPO_MAX_BYTES);
    let corpo: unknown;
    if (!excedeu) {
      try {
        corpo = JSON.parse(text) as unknown;
      } catch {
        corpo = undefined;
      }
    }

    if (path === PUSH_REMOVE_PATH) {
      const token = (corpo as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || token.length < 1 || token.length > 1000) {
        return enviar(res, 422, { code: 'aparelho_invalido' });
      }
      await opts.store.remover(sessao.userId, token);
      return enviar(res, 204);
    }

    const aparelho = lerAparelho(corpo);
    if (aparelho === null) return enviar(res, 422, { code: 'aparelho_invalido' });
    if (!(await opts.store.registrar(sessao.userId, aparelho, new Date(agora)))) {
      return enviar(res, 403, { code: 'conta_indisponivel' });
    }
    return enviar(res, 204);
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
