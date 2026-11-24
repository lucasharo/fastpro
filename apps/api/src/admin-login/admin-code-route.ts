// Entrada do admin por codigo de 6 digitos no e-mail (decisao do dono, 2026-11-24).
//   POST /v1/admin/auth/code    {email}        -> 202 sempre (nao revela se o e-mail e da equipe)
//   POST /v1/admin/auth/verify  {email, code}  -> 204 + cookie __Host-fp_admin; 401 codigo invalido; 429 bloqueado
//   POST /v1/admin/auth/logout                 -> 204 e apaga o cookie
// Origin obrigatorio (ADMIN_BASE_URL). Nenhum log de e-mail, codigo ou cookie.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieHeader,
  checkDraftOrigin,
  cookieValue,
  normalizeAdminEmail,
  siteOriginOf,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

export const ADMIN_CODE_PATH = '/v1/admin/auth/code' as const;
export const ADMIN_VERIFY_PATH = '/v1/admin/auth/verify' as const;
export const ADMIN_LOGOUT_PATH = '/v1/admin/auth/logout' as const;
const CORPO_MAX_BYTES = 1024;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface AdminCodeRouteOptions {
  readonly adminUrl: string;
  readonly clock: { nowMs(): number };
  /** Emite o codigo (hash) para a equipe ativa; devolve true quando o e-mail e da equipe. */
  readonly emitir: (email: string, codeHash: string, nowMs: number) => Promise<boolean>;
  /** Envia o e-mail com o codigo. */
  readonly enviar: (email: string, code: string) => Promise<void>;
  /** Confere o codigo e abre a sessao. */
  readonly conferir: (input: {
    readonly email: string;
    readonly codeHash: string;
    readonly sessionId: string;
    readonly secretHash: string;
    readonly nowMs: number;
  }) => Promise<'ok' | 'invalido' | 'bloqueado'>;
  readonly revogar: (secretHash: string, nowMs: number) => Promise<void>;
  /** Codigo novo (padrao: 6 digitos aleatorios). Injetado nos testes. */
  readonly novoCodigo?: () => string;
}

export function isAdminCodeRoute(metodo: string, path: string): boolean {
  return metodo === 'POST' && (path === ADMIN_CODE_PATH || path === ADMIN_VERIFY_PATH || path === ADMIN_LOGOUT_PATH);
}

const hashCodigo = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex');

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
      if (total === 0) return resolve({});
      try {
        const v: unknown = JSON.parse(Buffer.concat(partes).toString('utf8'));
        resolve(v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const APAGAR_COOKIE = `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function handleAdminCodeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AdminCodeRouteOptions,
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
    const email = normalizeAdminEmail(corpo.email);

    if (path === ADMIN_CODE_PATH) {
      if (email === null) return enviar(res, 422, { code: 'email_invalido' });
      const code = (opts.novoCodigo ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0')))();
      const daEquipe = await opts.emitir(email, hashCodigo(code), agora);
      if (daEquipe) await opts.enviar(email, code);
      return enviar(res, 202, { status: 'enviado' });
    }

    // Verificacao.
    const code = typeof corpo.code === 'string' && /^[0-9]{6}$/.test(corpo.code) ? corpo.code : null;
    if (email === null || code === null) return enviar(res, 401, { code: 'codigo_invalido' });
    const segredo = randomBytes(32).toString('base64url');
    const r = await opts.conferir({
      email,
      codeHash: hashCodigo(code),
      sessionId: randomUUID(),
      secretHash: hashSessionSecret(segredo),
      nowMs: agora,
    });
    if (r === 'ok') return enviar(res, 204, undefined, { 'Set-Cookie': adminSessionCookieHeader(segredo) });
    if (r === 'bloqueado') return enviar(res, 429, { code: 'muitas_tentativas' });
    return enviar(res, 401, { code: 'codigo_invalido' });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}
