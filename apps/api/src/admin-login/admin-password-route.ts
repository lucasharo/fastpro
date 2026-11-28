// Entrada do admin por e-mail e senha (decisao do dono, 2026-11-27).
//   POST /v1/admin/auth/login   {email, password} -> 200 + cookie __Host-fp_admin; 401 igual para qualquer falha;
//                                                    429 acima do limite de tentativas
//   POST /v1/admin/auth/logout                    -> 204 e apaga o cookie
// Nao ha cadastro nem recuperacao por aqui. Origin obrigatorio (ADMIN_BASE_URL). Sem log de e-mail, senha ou cookie.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  checkDraftOrigin,
  cookieValue,
  loginAdmin,
  normalizeClientIp,
  siteOriginOf,
  type AdminLoginDeps,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

export const ADMIN_LOGIN_PATH = '/v1/admin/auth/login' as const;
export const ADMIN_LOGOUT_PATH = '/v1/admin/auth/logout' as const;
const CORPO_MAX_BYTES = 2048;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AdminPasswordRouteOptions extends AdminLoginDeps {
  readonly adminUrl: string;
  readonly clock: { nowMs(): number };
  readonly revogar: (secretHash: string, nowMs: number) => Promise<void>;
}

export function isAdminPasswordRoute(metodo: string, path: string): boolean {
  return metodo === 'POST' && (path === ADMIN_LOGIN_PATH || path === ADMIN_LOGOUT_PATH);
}

function enviar(res: ServerResponse, status: number, body?: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => {
      if (total > CORPO_MAX_BYTES) return resolve(null);
      try {
        const v: unknown = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        resolve(v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const APAGAR_COOKIE = `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function handleAdminPasswordRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AdminPasswordRouteOptions,
): Promise<void> {
  try {
    const origem = checkDraftOrigin(
      { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
      siteOriginOf(opts.adminUrl),
      true,
    );
    if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    const agora = opts.clock.nowMs();

    if (path === ADMIN_LOGOUT_PATH) {
      const segredo = cookieValue(cabecalho(req.headers.cookie), ADMIN_SESSION_COOKIE);
      if (segredo !== undefined) await opts.revogar(hashSessionSecret(segredo), agora);
      return enviar(res, 204, undefined, { 'Set-Cookie': APAGAR_COOKIE });
    }

    const corpo = await lerCorpo(req);
    if (corpo === null) return enviar(res, 400, { code: 'corpo_invalido' });
    const r = await loginAdmin(
      // IP do socket, nunca de cabecalho encaminhado (mesma regra das demais rotas).
      { email: corpo.email, password: corpo.password, ip: normalizeClientIp(req.socket.remoteAddress).value },
      { accounts: opts.accounts, limits: opts.limits, log: opts.log },
      agora,
    );
    return enviar(res, r.status, r.body, r.setCookie !== undefined ? { 'Set-Cookie': r.setCookie } : {});
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
