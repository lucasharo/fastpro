// GET /v1/auth/me | Diz a tela quem esta logado e com qual papel, para mostrar so o menu e as telas desse papel.
// Resposta minima: { papel: 'cliente' | 'profissional' }. Sem sessao valida: 401. Sem e-mail, nome ou id.
// Quem tem perfil profissional e tratado como profissional (a mesma conta nao navega como cliente).
// Sessao que se renova (2026-11-23): com sessao valida, empurra o fim para agora + 7 dias e reenvia o cookie.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE_NAME, cookieValue, maxAgeSecondsFor, sessionCookieHeader } from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

export const ME_PATH = '/v1/auth/me' as const;

const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface MeRouteOptions {
  readonly sessions: { authenticate(hash: string, nowMs: number): Promise<{ readonly userId: string } | null> };
  readonly profissional: { existe(userId: string): Promise<boolean> };
  readonly clock: { nowMs(): number };
  /** Renovacao da sessao (opcional): devolve o novo fim quando renovou. */
  readonly renovar?: (hash: string, nowMs: number) => Promise<{ readonly renovada: boolean; readonly fimMs: number | null }>;
}

export function isMeRoute(metodo: string, path: string): boolean {
  return metodo === 'GET' && path === ME_PATH;
}

function enviar(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(JSON.stringify(body));
}

export async function handleMeRoute(req: IncomingMessage, res: ServerResponse, opts: MeRouteOptions): Promise<void> {
  try {
    const cabecalho = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
    const segredo = cookieValue(cabecalho, SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const hash = hashSessionSecret(segredo);
    const sessao = await opts.sessions.authenticate(hash, agora);
    if (sessao === null) return enviar(res, 401, { code: 'sessao_necessaria' });
    const ehProfissional = await opts.profissional.existe(sessao.userId);
    let extra: Record<string, string> = {};
    if (opts.renovar) {
      try {
        const r = await opts.renovar(hash, agora);
        const maxAge = r.renovada && r.fimMs !== null ? maxAgeSecondsFor(r.fimMs, agora) : 0;
        if (maxAge >= 1) extra = { 'Set-Cookie': sessionCookieHeader(segredo, maxAge) };
      } catch {
        // Renovar e conveniencia: a falha nao derruba a resposta (a sessao atual continua valendo).
      }
    }
    return enviar(res, 200, { papel: ehProfissional ? 'profissional' : 'cliente' }, extra);
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
