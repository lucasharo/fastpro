// Pedido de quem ja esta logado (2026-11-23).
//   GET  /v1/auth/me/draft-identity   cliente logado: { firstName | null } (nome do ultimo pedido, para a tela decidir)
//   POST /v1/auth/me/draft-identity   cliente logado: { first_name? } -> grava nome e e-mail da conta no rascunho do
//                                     navegador e ja marca o e-mail como confirmado (sem codigo).
// O e-mail vem SEMPRE da sessao (nunca do corpo). Posse do rascunho pelo cookie. Origin obrigatorio no POST.
// 401 sem sessao; 404 sem rascunho; 422 nome_necessario (cliente sem pedido anterior e sem nome no corpo).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SESSION_COOKIE_NAME,
  checkDraftOrigin,
  cookieValue,
  draftSecretFromCookie,
  normalizeIdentityEmail,
  siteOriginOf,
} from '@fastpro/domain';
import { hashSessionSecret } from '@fastpro/db';

export const DRAFT_SESSION_PATH = '/v1/auth/me/draft-identity' as const;
const CORPO_MAX_BYTES = 1024;
const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export interface DraftSessionRouteOptions {
  readonly siteUrl: string;
  readonly clock: { nowMs(): number };
  /** E-mail da conta e nome do ultimo pedido, a partir do hash da sessao; null sem sessao valida. */
  readonly identidade: (sessionHash: string, nowMs: number) => Promise<{ readonly email: string; readonly firstName: string | null } | null>;
  /** Grava no rascunho (hash do cookie do rascunho). Devolve o codigo da funcao do banco ('ok', ...). */
  readonly gravar: (input: {
    readonly draftHash: string;
    readonly sessionHash: string;
    readonly nowMs: number;
    readonly firstName: string;
    readonly email: string;
    readonly emailHmac: string;
  }) => Promise<string>;
  readonly emailHmac: (email: string) => string;
  readonly draftHash: (secret: string) => string;
}

export function isDraftSessionRoute(metodo: string, path: string): boolean {
  return path === DRAFT_SESSION_PATH && (metodo === 'GET' || metodo === 'POST');
}

function enviar(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CABECALHOS);
  res.end(JSON.stringify(body));
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= CORPO_MAX_BYTES) partes.push(c);
    });
    req.on('end', () => {
      if (total > CORPO_MAX_BYTES) return resolve(undefined);
      if (total === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

export async function handleDraftSessionRoute(req: IncomingMessage, res: ServerResponse, opts: DraftSessionRouteOptions): Promise<void> {
  try {
    const post = req.method === 'POST';
    if (post) {
      const origem = checkDraftOrigin(
        { origin: cabecalho(req.headers.origin), secFetchSite: cabecalho(req.headers['sec-fetch-site']) },
        siteOriginOf(opts.siteUrl),
        true,
      );
      if (!origem.ok) return enviar(res, 403, { code: 'origem_invalida' });
    }
    const cookies = cabecalho(req.headers.cookie);
    const segredo = cookieValue(cookies, SESSION_COOKIE_NAME);
    if (segredo === undefined) return enviar(res, 401, { code: 'sessao_necessaria' });
    const agora = opts.clock.nowMs();
    const sessionHash = hashSessionSecret(segredo);
    const ident = await opts.identidade(sessionHash, agora);
    if (ident === null) return enviar(res, 401, { code: 'sessao_necessaria' });
    if (!post) return enviar(res, 200, { firstName: ident.firstName });

    const corpo = await lerCorpo(req);
    if (corpo === undefined || corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return enviar(res, 400, { code: 'corpo_invalido' });
    }
    const dados = corpo as Record<string, unknown>;
    if (Object.keys(dados).some((k) => k !== 'first_name')) return enviar(res, 400, { code: 'corpo_invalido' });
    const doCorpo = typeof dados.first_name === 'string' ? dados.first_name.trim() : '';
    const nome = doCorpo !== '' ? doCorpo : (ident.firstName ?? '');
    if (nome.length < 2 || nome.length > 60) return enviar(res, 422, { code: 'nome_necessario' });

    const draftSecret = draftSecretFromCookie(cookies);
    if (draftSecret === null) return enviar(res, 404, { code: 'rascunho_ausente' });
    const email = normalizeIdentityEmail(ident.email);
    if (email === null) return enviar(res, 422, { code: 'email_invalido' });

    const r = await opts.gravar({
      draftHash: opts.draftHash(draftSecret),
      sessionHash,
      nowMs: agora,
      firstName: nome,
      email,
      emailHmac: opts.emailHmac(email),
    });
    if (r === 'ok') return enviar(res, 200, { status: 'ok' });
    if (r === 'sessao_invalida') return enviar(res, 401, { code: 'sessao_necessaria' });
    if (r === 'rascunho_ausente') return enviar(res, 404, { code: 'rascunho_ausente' });
    return enviar(res, 422, { code: r });
  } catch {
    if (!res.headersSent) enviar(res, 503, { code: 'indisponivel' });
  }
}

